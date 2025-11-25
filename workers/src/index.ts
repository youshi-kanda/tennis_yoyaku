import { generateJWT, verifyJWT, hashPassword, verifyPassword, authenticate } from './auth';
import {
  checkShinagawaAvailability,
  checkMinatoAvailability,
  makeShinagawaReservation,
  makeMinatoReservation,
  getShinagawaFacilities,
  getMinatoFacilities,
  loginToShinagawa,
  loginToMinato,
  type AvailabilityResult,
  type ReservationHistory,
} from './scraper';
import { getOrDetectReservationPeriod, type ReservationPeriodInfo } from './reservationPeriod';
import { isHoliday, getHolidaysForYear, type HolidayInfo } from './holidays';
import { encryptPassword, decryptPassword, isEncrypted } from './crypto';

// ===== メモリキャッシュ（KV使用量削減のため） =====
interface SessionCacheEntry {
  sessionId: string;
  expires: number;
}

interface MonitoringListCache {
  data: any[] | null;
  expires: number;
}

// セッションキャッシュ（5分間有効）
const sessionCache = new Map<string, SessionCacheEntry>();
const SESSION_CACHE_TTL = 5 * 60 * 1000; // 5分

// 監視リストキャッシュ（3分間有効）
const monitoringListCache: MonitoringListCache = {
  data: null,
  expires: 0
};
const MONITORING_LIST_CACHE_TTL = 3 * 60 * 1000; // 3分

// KV使用量メトリクス
let kvMetrics = {
  reads: 0,
  writes: 0,
  cacheHits: 0,
  cacheMisses: 0,
  writesSkipped: 0,
  resetAt: Date.now()
};

// ===== 深夜早朝時間帯判定（品川区の制約） =====
interface TimeRestrictions {
  canLogin: boolean;
  canReserve: boolean;
  shouldResetSession: boolean;
  reason?: string;
}

/**
 * 品川区の深夜早朝時間帯制約をチェック
 * @param now 現在時刻（UTC）
 * @returns 時間帯制約情報
 */
function checkTimeRestrictions(now: Date = new Date()): TimeRestrictions {
  // JST変換（UTC + 9時間）
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = jst.getHours();
  const minute = jst.getMinutes();
  
  // 24:00〜3:15: ログイン不可、既存セッションのみ予約可
  if (hour === 0 || hour === 1 || hour === 2 || (hour === 3 && minute < 15)) {
    return {
      canLogin: false,
      canReserve: true, // 既存セッションは予約可能
      shouldResetSession: false,
      reason: '深夜時間帯（24:00-3:15）: ログイン不可、既存セッションのみ予約可'
    };
  }
  
  // 3:15: セッションリセットタイミング
  if (hour === 3 && minute === 15) {
    return {
      canLogin: false,
      canReserve: false,
      shouldResetSession: true,
      reason: '3:15: セッションリセット時刻'
    };
  }
  
  // 3:15〜5:00: 新規予約不可
  if ((hour === 3 && minute > 15) || hour === 4) {
    return {
      canLogin: false,
      canReserve: false,
      shouldResetSession: false,
      reason: '早朝時間帯（3:15-5:00）: ログイン・予約不可'
    };
  }
  
  // その他の時間帯: 制限なし
  return {
    canLogin: true,
    canReserve: true,
    shouldResetSession: false
  };
}

export interface Env {
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  MONITORING: KVNamespace;
  RESERVATIONS: KVNamespace;
  ENVIRONMENT: string;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
}

export interface User {
  id: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  createdAt: number;
}

export interface MonitoringTarget {
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string; // 後方互換性（単一日付）
  dateMode?: 'single' | 'range' | 'continuous'; // 日付モード（新規）
  startDate?: string; // 期間指定開始日（新規）
  endDate?: string; // 期間指定終了日（新規）
  timeSlot: string; // 後方互換性のため残す（非推奨）
  timeSlots?: string[]; // 複数時間帯対応（新規）
  selectedWeekdays?: number[]; // 監視する曜日（0=日, 1=月, ..., 6=土）デフォルトは全曜日
  priority?: number; // 優先度（1-5、5が最優先）デフォルトは3
  includeHolidays?: boolean | 'only'; // 祝日の扱い: true=含める, false=除外, 'only'=祝日のみ
  status: 'active' | 'pending' | 'completed' | 'failed';
  autoReserve: boolean;
  lastCheck?: number;
  lastStatus?: string; // '×' or '○' or '取'
  detectedStatus?: '×' | '取' | '○'; // 検知したステータス（集中監視用）
  intensiveMonitoringUntil?: number; // 集中監視の終了時刻（タイムスタンプ）
  createdAt: number;
}

// ===== バッチ化されたデータ構造（KV最適化） =====
export interface UserMonitoringState {
  targets: MonitoringTarget[];
  updatedAt: number;
  version: number; // データバージョン管理
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ===== バッチ化ヘルパー関数（KV最適化） =====

/**
 * ユーザーの監視状態を取得（新形式: MONITORING:{userId}）
 * 後方互換性のため、旧形式(monitoring:all_targets)からの自動移行も行う
 */
async function getUserMonitoringState(userId: string, kv: KVNamespace): Promise<UserMonitoringState> {
  // 新形式で取得
  const newKey = `MONITORING:${userId}`;
  kvMetrics.reads++;
  const newData = await kv.get(newKey, 'json') as UserMonitoringState | null;
  
  if (newData) {
    return newData;
  }
  
  // 新形式がない場合、旧形式から移行（初回のみ）
  console.log(`[Migration] Loading old format for user ${userId}`);
  kvMetrics.reads++;
  const oldData = await kv.get('monitoring:all_targets', 'json') as MonitoringTarget[] | null;
  
  if (oldData) {
    const userTargets = oldData.filter(t => t.userId === userId);
    return {
      targets: userTargets,
      updatedAt: Date.now(),
      version: 1
    };
  }
  
  // データがない場合は空の状態を返す
  return {
    targets: [],
    updatedAt: Date.now(),
    version: 1
  };
}

/**
 * ユーザーの監視状態を保存（新形式のみ）
 */
async function saveUserMonitoringState(userId: string, state: UserMonitoringState, kv: KVNamespace): Promise<void> {
  const key = `MONITORING:${userId}`;
  state.updatedAt = Date.now();
  
  kvMetrics.writes++;
  await kv.put(key, JSON.stringify(state));
  console.log(`[KV Write] Saved monitoring state for user ${userId}, ${state.targets.length} targets`);
}

// ===== キャッシュヘルパー関数 =====
async function getCachedSession(userId: string, kv: KVNamespace): Promise<string | null> {
  const now = Date.now();
  const cacheKey = `session:${userId}`;
  
  // メモリキャッシュをチェック
  const cached = sessionCache.get(cacheKey);
  if (cached && cached.expires > now) {
    kvMetrics.cacheHits++;
    console.log(`[Cache HIT] Session for user ${userId}`);
    return cached.sessionId;
  }
  
  // キャッシュミス - KVから取得
  kvMetrics.cacheMisses++;
  console.log(`[Cache MISS] Session for user ${userId}, fetching from KV`);
  
  kvMetrics.reads++;
  const sessionId = await kv.get(`session:${userId}`);
  
  if (sessionId) {
    // キャッシュに保存
    sessionCache.set(cacheKey, {
      sessionId,
      expires: now + SESSION_CACHE_TTL
    });
  }
  
  return sessionId;
}

async function getCachedMonitoringList(kv: KVNamespace): Promise<any[]> {
  const now = Date.now();
  
  // メモリキャッシュをチェック
  if (monitoringListCache.data && monitoringListCache.expires > now) {
    kvMetrics.cacheHits++;
    console.log('[Cache HIT] Monitoring list');
    return monitoringListCache.data;
  }
  
  // キャッシュミス - KVから取得
  kvMetrics.cacheMisses++;
  console.log('[Cache MISS] Monitoring list, fetching from KV');
  
  kvMetrics.reads++;
  const data = (await kv.get('monitoring:list', 'json') as any[]) || [];
  
  // キャッシュに保存
  monitoringListCache.data = data;
  monitoringListCache.expires = now + MONITORING_LIST_CACHE_TTL;
  
  return data;
}

async function updateMonitoringTargetOptimized(
  target: MonitoringTarget,
  newStatus: string,
  kv: KVNamespace
): Promise<void> {
  const previousStatus = target.lastStatus;
  
  // ステータスに変更がある場合のみwrite
  if (previousStatus !== newStatus) {
    target.lastStatus = newStatus;
    target.lastCheck = Date.now();
    
    // 配列管理: 全ターゲットを取得して該当ターゲットを更新
    kvMetrics.reads++;
    const allTargets = await kv.get('monitoring:all_targets', 'json') as MonitoringTarget[] || [];
    const targetIndex = allTargets.findIndex((t: MonitoringTarget) => t.id === target.id);
    
    if (targetIndex !== -1) {
      allTargets[targetIndex] = target;
      kvMetrics.writes++;
      await kv.put('monitoring:all_targets', JSON.stringify(allTargets));
      console.log(`[Optimized Write] Status changed: ${previousStatus} → ${newStatus}`);
    } else {
      console.warn(`[Warning] Target ${target.id} not found in array`);
    }
    
    // 監視リストキャッシュを無効化
    monitoringListCache.data = null;
    monitoringListCache.expires = 0;
  } else {
    kvMetrics.writesSkipped++;
    console.log(`[Optimized Skip] No change (${newStatus}), write skipped`);
  }
}

function logKVMetrics() {
  const elapsed = (Date.now() - kvMetrics.resetAt) / 1000 / 60; // 分
  console.log('[KV Metrics]', {
    reads: kvMetrics.reads,
    writes: kvMetrics.writes,
    cacheHits: kvMetrics.cacheHits,
    cacheMisses: kvMetrics.cacheMisses,
    writesSkipped: kvMetrics.writesSkipped,
    cacheHitRate: kvMetrics.cacheHits / (kvMetrics.cacheHits + kvMetrics.cacheMisses),
    writeSkipRate: kvMetrics.writesSkipped / (kvMetrics.writes + kvMetrics.writesSkipped),
    elapsedMinutes: elapsed.toFixed(1)
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/api/auth/register') {
        return handleRegister(request, env);
      }

      if (path === '/api/auth/login') {
        return handleLogin(request, env);
      }

      if (path === '/api/monitoring/list') {
        return handleMonitoringList(request, env);
      }

      if (path === '/api/monitoring/create') {
        return handleMonitoringCreate(request, env);
      }

      if (path.startsWith('/api/monitoring/') && request.method === 'DELETE') {
        return handleMonitoringDelete(request, env, path);
      }

      if (path === '/api/reservations/history') {
        return handleReservationHistory(request, env);
      }

      if (path === '/api/settings' && request.method === 'GET') {
        return handleGetSettings(request, env);
      }

      if (path === '/api/settings' && request.method === 'POST') {
        return handleSaveSettings(request, env);
      }

      if (path === '/api/facilities/shinagawa') {
        return handleGetShinagawaFacilities(request, env);
      }

      if (path === '/api/facilities/minato') {
        return handleGetMinatoFacilities(request, env);
      }

      if (path === '/api/reservation-period') {
        return handleGetReservationPeriod(request, env);
      }

      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: Date.now() });
      }

      if (path === '/api/metrics/kv') {
        const elapsed = (Date.now() - kvMetrics.resetAt) / 1000 / 60;
        return jsonResponse({
          reads: kvMetrics.reads,
          writes: kvMetrics.writes,
          cacheHits: kvMetrics.cacheHits,
          cacheMisses: kvMetrics.cacheMisses,
          writesSkipped: kvMetrics.writesSkipped,
          cacheHitRate: kvMetrics.cacheHits / (kvMetrics.cacheHits + kvMetrics.cacheMisses) || 0,
          writeSkipRate: kvMetrics.writesSkipped / (kvMetrics.writes + kvMetrics.writesSkipped) || 0,
          elapsedMinutes: parseFloat(elapsed.toFixed(1)),
          resetAt: kvMetrics.resetAt
        });
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message || 'Internal server error' }, 500);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();
    const minutes = now.getMinutes();
    const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000); // JST変換
    
    console.log('[Cron] Started:', jstTime.toISOString(), `(JST: ${jstTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })})`);
    
    // ⏰ 深夜早朝時間帯チェック（品川区の制約）
    const timeRestrictions = checkTimeRestrictions(now);
    if (timeRestrictions.reason) {
      console.log(`[Cron] ⏰ ${timeRestrictions.reason}`);
    }
    
    // 3:15: セッションリセット処理
    if (timeRestrictions.shouldResetSession) {
      console.log('[Cron] 🔄 セッションリセット実行中...');
      try {
        // 全ユーザーのセッションをクリア
        await resetAllSessions(env);
        console.log('[Cron] ✅ セッションリセット完了');
      } catch (error) {
        console.error('[Cron] ❌ セッションリセット失敗:', error);
      }
      return; // リセット後は監視処理をスキップ
    }
    
    // 予約不可時間帯はスキップ
    if (!timeRestrictions.canReserve) {
      console.log('[Cron] ⏸️  予約不可時間帯のため監視スキップ');
      return;
    }
    
    // 集中監視モード判定: 10分刻み(10, 20, 30...)の前後2分間
    // 例: 10:08, 10:09, 10:10, 10:11, 10:12 は集中監視
    const isIntensiveMode = (minutes % 10 >= 8) || (minutes % 10 <= 2);
    
    if (isIntensiveMode) {
      console.log(`[Cron] 🔥 集中監視モード: 分=${minutes} (10分刻み前後2分間)`);
    } else {
      console.log(`[Cron] 📋 通常監視モード: 分=${minutes}`);
    }
    
    try {
      const targets = await getAllActiveTargets(env);
      console.log(`[Cron] Found ${targets.length} active monitoring targets`);
      
      // 集中監視対象をフィルタ（「取」検知済みのターゲット）
      const intensiveTargets = targets.filter(t => t.detectedStatus === '取' && t.intensiveMonitoringUntil && t.intensiveMonitoringUntil > Date.now());
      const normalTargets = targets.filter(t => !intensiveTargets.includes(t));
      
      console.log(`[Cron] 集中監視対象: ${intensiveTargets.length}件, 通常監視: ${normalTargets.length}件`);
      
      // 優先度順にソート（priorityが高い順、同じなら作成日時が古い順）
      const sortTargets = (targets: MonitoringTarget[]) => targets.sort((a, b) => {
        const priorityA = a.priority || 3;
        const priorityB = b.priority || 3;
        if (priorityB !== priorityA) {
          return priorityB - priorityA; // 優先度が高い順
        }
        return a.createdAt - b.createdAt; // 作成日時が古い順
      });
      
      const sortedIntensiveTargets = sortTargets(intensiveTargets);
      const sortedNormalTargets = sortTargets(normalTargets);
      
      // 集中監視対象を優先処理
      for (const target of sortedIntensiveTargets) {
        try {
          console.log(`[Cron] 🔥 集中監視チェック: ${target.facilityName} (${target.site})`);
          await checkAndNotify(target, env, true); // 集中監視フラグ
        } catch (error) {
          console.error(`[Cron] Error checking intensive target ${target.id}:`, error);
        }
      }
      
      // 通常監視対象を処理
      for (const target of sortedNormalTargets) {
        try {
          await checkAndNotify(target, env, false);
        } catch (error) {
          console.error(`[Cron] Error checking target ${target.id}:`, error);
        }
      }
      
      // KVメトリクスをログ出力
      logKVMetrics();
    } catch (error) {
      console.error('[Cron] Error:', error);
    }
  },
};

async function handleRegister(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string; adminKey?: string };
    const { email, password, adminKey } = body;

    if (!email || !password) {
      return jsonResponse({ error: 'Email and password are required' }, 400);
    }

    const existingUser = await env.USERS.get(`user:${email}`);
    if (existingUser) {
      return jsonResponse({ error: 'User already exists' }, 409);
    }

    const role = (adminKey === env.ADMIN_KEY) ? 'admin' : 'user';

    const user: User = {
      id: crypto.randomUUID(),
      email,
      password: await hashPassword(password),
      role,
      createdAt: Date.now(),
    };

    await env.USERS.put(`user:${email}`, JSON.stringify(user));
    await env.USERS.put(`user:id:${user.id}`, email);

    const token = await generateJWT(
      { userId: user.id, email: user.email, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );

    return jsonResponse({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Registration failed: ' + error.message }, 500);
  }
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string };
    const { email, password } = body;

    const userJson = await env.USERS.get(`user:${email}`);
    if (!userJson) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    const user: User = JSON.parse(userJson);

    const isValid = await verifyPassword(password, user.password);
    if (!isValid) {
      return jsonResponse({ error: 'Invalid credentials' }, 401);
    }

    const token = await generateJWT(
      { userId: user.id, email: user.email, role: user.role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
      env.JWT_SECRET
    );

    return jsonResponse({
      success: true,
      data: {
        user: { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt },
        token,
      },
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Login failed: ' + error.message }, 500);
  }
}

async function handleMonitoringList(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    // 新形式：ユーザー単位で取得（KV最適化）
    const state = await getUserMonitoringState(userId, env.MONITORING);
    const userTargets = state.targets.map((t: MonitoringTarget) => ({
      ...t,
      // facilityNameがない場合はfacilityIdで代替
      facilityName: t.facilityName || t.facilityId || '施設名未設定'
    }));

    return jsonResponse({
      success: true,
      data: userTargets,
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handleMonitoringCreate(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const body = await request.json() as {
      site: 'shinagawa' | 'minato';
      facilityId: string;
      facilityName: string;
      date?: string; // 後方互換性（単一日付）
      startDate?: string; // 期間指定開始日
      endDate?: string; // 期間指定終了日
      dateMode?: 'single' | 'range' | 'continuous'; // 日付モード
      timeSlot?: string; // 後方互換性
      timeSlots?: string[]; // 新規（複数時間帯）
      selectedWeekdays?: number[]; // 監視する曜日
      priority?: number; // 優先度（1-5）
      includeHolidays?: boolean | 'only'; // 祝日の扱い
      autoReserve: boolean;
    };

    // timeSlots優先、なければtimeSlotを使用（後方互換性）
    const timeSlots = body.timeSlots || (body.timeSlot ? [body.timeSlot] : []);
    if (timeSlots.length === 0) {
      return jsonResponse({ error: 'timeSlot or timeSlots is required' }, 400);
    }

    // セッション情報を取得（予約可能期間の判定に必要）
    kvMetrics.reads++;
    const sessionData = await env.SESSIONS.get(`session:${userId}:${body.site}`);
    const sessionId = sessionData ? JSON.parse(sessionData).sessionId : null;

    // 予約可能期間を動的取得
    const periodInfo = await getOrDetectReservationPeriod(body.site, sessionId, env.MONITORING);
    console.log(`[MonitoringCreate] ${body.site} の予約可能期間: ${periodInfo.maxDaysAhead}日 (source: ${periodInfo.source})`);

    // 日付の検証と設定（期間指定 or 単一日付 or 継続監視）
    let targetDate = body.date || '';
    let startDate = body.startDate;
    let endDate = body.endDate;

    // 継続監視モードの場合、終了日を動的設定
    if (body.dateMode === 'continuous') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const maxDate = new Date();
      maxDate.setDate(maxDate.getDate() + periodInfo.maxDaysAhead);
      
      startDate = tomorrow.toISOString().split('T')[0];
      endDate = maxDate.toISOString().split('T')[0];
      targetDate = startDate;
      
      console.log(`[MonitoringCreate] 継続監視モード: ${startDate} 〜 ${endDate} (${periodInfo.maxDaysAhead}日先まで)`);
    } else if (startDate && endDate) {
      // 期間指定の場合、dateは開始日を設定（後方互換性）
      targetDate = startDate;

      // 終了日が予約可能期間を超えていないかバリデーション
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const endDateObj = new Date(endDate);
      const maxAllowedDate = new Date(today);
      maxAllowedDate.setDate(maxAllowedDate.getDate() + periodInfo.maxDaysAhead);

      if (endDateObj > maxAllowedDate) {
        return jsonResponse({ 
          error: `終了日が予約可能期間を超えています。${body.site === 'shinagawa' ? '品川区' : '港区'}は${periodInfo.maxDaysAhead}日先まで予約可能です。`,
          periodInfo: {
            maxDaysAhead: periodInfo.maxDaysAhead,
            maxDate: maxAllowedDate.toISOString().split('T')[0],
            source: periodInfo.source
          }
        }, 400);
      }
    } else if (!body.date && !startDate && !endDate) {
      return jsonResponse({ error: 'date or startDate/endDate is required' }, 400);
    }

    const target: MonitoringTarget = {
      id: crypto.randomUUID(),
      userId,
      site: body.site,
      facilityId: body.facilityId,
      facilityName: body.facilityName,
      date: targetDate,
      dateMode: body.dateMode || 'single', // 日付モード
      startDate: startDate,
      endDate: endDate,
      timeSlot: timeSlots[0], // 後方互換性のため最初の時間帯を設定
      timeSlots: timeSlots, // 新規フィールド
      selectedWeekdays: body.selectedWeekdays, // 曜日フィルタ
      priority: body.priority || 3, // デフォルトは3（普通）
      includeHolidays: body.includeHolidays, // 祝日の扱い
      status: 'active',
      autoReserve: body.autoReserve,
      createdAt: Date.now(),
    };

    // 新形式：ユーザー単位で監視状態を保存（KV書き込み最適化）
    try {
      const state = await getUserMonitoringState(userId, env.MONITORING);
      state.targets.push(target);
      await saveUserMonitoringState(userId, state, env.MONITORING);
      
      console.log(`[MonitoringCreate] Successfully added target ${target.id} for user ${userId}`);
    } catch (err: any) {
      console.error(`[MonitoringCreate] KV write failed:`, err);
      if (err.message?.includes('429') || err.message?.includes('limit exceeded')) {
        throw new Error('KV write limit exceeded. Please try again later or upgrade to paid plan.');
      }
      throw err;
    }

    // 監視リストキャッシュを無効化（新しい監視が追加されたため）
    monitoringListCache.data = null;
    monitoringListCache.expires = 0;

    return jsonResponse({
      success: true,
      data: target,
    });
  } catch (error: any) {
    console.error('[MonitoringCreate] Error:', error);
    console.error('[MonitoringCreate] Stack:', error.stack);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack
    }, 500);
  }
}

async function handleMonitoringDelete(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    // パスから監視IDを取得 (/api/monitoring/:id)
    const parts = path.split('/');
    const targetId = parts[parts.length - 1];

    if (!targetId) {
      return jsonResponse({ error: 'Target ID is required' }, 400);
    }

    // 新形式：ユーザー単位で取得（KV最適化）
    const state = await getUserMonitoringState(userId, env.MONITORING);

    // 指定されたIDの監視を探す
    const targetIndex = state.targets.findIndex(t => t.id === targetId);

    if (targetIndex === -1) {
      return jsonResponse({ error: 'Monitoring target not found or unauthorized' }, 404);
    }

    // 監視を削除
    const deletedTarget = state.targets.splice(targetIndex, 1)[0];

    // 新形式で保存（リトライなし - KV書き込み上限対策）
    try {
      await saveUserMonitoringState(userId, state, env.MONITORING);
      console.log(`[MonitoringDelete] Successfully deleted target ${targetId}`);
    } catch (error: any) {
      console.error(`[MonitoringDelete] KV write failed:`, error);
      if (error.message?.includes('429') || error.message?.includes('limit exceeded')) {
        throw new Error('KV write limit exceeded. Please try again later or upgrade to paid plan.');
      }
      throw error;
    }

    // 監視リストキャッシュを無効化
    monitoringListCache.data = null;
    monitoringListCache.expires = 0;

    console.log(`[MonitoringDelete] Deleted monitoring: ${deletedTarget.facilityName} for user ${userId}`);

    return jsonResponse({
      success: true,
      message: 'Monitoring target deleted successfully',
      data: deletedTarget,
    });
  } catch (error: any) {
    console.error('[MonitoringDelete] Error:', error);
    console.error('[MonitoringDelete] Stack:', error.stack);
    return jsonResponse({ 
      error: error.message || 'Internal server error',
      details: error.stack
    }, 500);
  }
}

async function handleReservationHistory(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    // 配列管理されたデータを1回のget()で取得（list()不要）
    kvMetrics.reads++;
    const userHistories = await env.RESERVATIONS.get(`history:${userId}`, 'json') as ReservationHistory[] || [];

    return jsonResponse({
      success: true,
      data: userHistories.sort((a, b) => b.createdAt - a.createdAt),
    });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handleGetSettings(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const settingsData = await env.USERS.get(`settings:${userId}`);
    if (!settingsData) {
      return jsonResponse({ success: true, data: null });
    }

    const settings = JSON.parse(settingsData);
    
    // マイグレーション: 平文パスワードを暗号化
    let migrated = false;
    
    if (settings.shinagawa?.password && !isEncrypted(settings.shinagawa.password)) {
      console.log(`[Migration] Encrypting shinagawa password for user ${userId}`);
      settings.shinagawa.password = await encryptPassword(settings.shinagawa.password, env.ENCRYPTION_KEY);
      migrated = true;
    }
    
    if (settings.minato?.password && !isEncrypted(settings.minato.password)) {
      console.log(`[Migration] Encrypting minato password for user ${userId}`);
      settings.minato.password = await encryptPassword(settings.minato.password, env.ENCRYPTION_KEY);
      migrated = true;
    }
    
    // マイグレーションが発生した場合、KVに保存
    if (migrated) {
      await env.USERS.put(`settings:${userId}`, JSON.stringify(settings));
      console.log(`[Migration] Settings updated for user ${userId}`);
    }
    
    return jsonResponse({ success: true, data: settings });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handleSaveSettings(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const body = await request.json() as {
      shinagawaUserId?: string;
      shinagawaPassword?: string;
      minatoUserId?: string;
      minatoPassword?: string;
      reservationLimits?: {
        perWeek?: number;  // 週あたりの予約上限
        perMonth?: number; // 月あたりの予約上限
      };
    };

    // 既存の設定を取得（マージするため）
    kvMetrics.reads++;
    const existingSettingsData = await env.USERS.get(`settings:${userId}`);
    const existingSettings = existingSettingsData ? JSON.parse(existingSettingsData) : {};

    // 新しい設定を既存の設定にマージ
    const updatedSettings: any = { ...existingSettings };

    // 品川区の設定を更新（指定された場合のみ）
    if (body.shinagawaUserId !== undefined || body.shinagawaPassword !== undefined) {
      updatedSettings.shinagawa = {
        username: body.shinagawaUserId || existingSettings.shinagawa?.username || '',
        // パスワードを暗号化して保存
        password: body.shinagawaPassword 
          ? await encryptPassword(body.shinagawaPassword, env.ENCRYPTION_KEY)
          : existingSettings.shinagawa?.password || '',
      };
    }

    // 港区の設定を更新（指定された場合のみ）
    if (body.minatoUserId !== undefined || body.minatoPassword !== undefined) {
      updatedSettings.minato = {
        username: body.minatoUserId || existingSettings.minato?.username || '',
        // パスワードを暗号化して保存
        password: body.minatoPassword 
          ? await encryptPassword(body.minatoPassword, env.ENCRYPTION_KEY)
          : existingSettings.minato?.password || '',
      };
    }

    // 予約上限の設定を更新（指定された場合のみ）
    if (body.reservationLimits !== undefined) {
      updatedSettings.reservationLimits = body.reservationLimits;
    }

    kvMetrics.writes++;
    await env.USERS.put(`settings:${userId}`, JSON.stringify(updatedSettings));

    return jsonResponse({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handleGetShinagawaFacilities(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;
    console.log('[Facilities] Fetching Shinagawa facilities for user:', userId);

    // 認証情報を取得
    const settingsData = await env.USERS.get(`settings:${userId}`);
    if (!settingsData) {
      console.log('[Facilities] No settings found for user:', userId);
      return jsonResponse({ error: 'Credentials not found. Please save your settings first.' }, 400);
    }

    const settings = JSON.parse(settingsData);
    console.log('[Facilities] Settings loaded, has shinagawa:', !!settings.shinagawa);
    if (!settings.shinagawa) {
      return jsonResponse({ error: 'Shinagawa credentials not found' }, 400);
    }

    // ログインしてsessionIdを取得
    console.log('[Facilities] Attempting login to Shinagawa...');
    // パスワードを復号化（平文パスワードの場合はそのまま使用）
    let decryptedPassword = settings.shinagawa.password;
    if (isEncrypted(settings.shinagawa.password)) {
      try {
        decryptedPassword = await decryptPassword(settings.shinagawa.password, env.ENCRYPTION_KEY);
      } catch (error) {
        console.error('[Facilities] Failed to decrypt password:', error);
        return jsonResponse({ error: 'Failed to decrypt password' }, 500);
      }
    }
    const sessionId = await loginToShinagawa(settings.shinagawa.username, decryptedPassword);
    console.log('[Facilities] Login result, sessionId:', sessionId ? 'obtained' : 'failed');
    if (!sessionId) {
      return jsonResponse({ error: 'Failed to login to Shinagawa' }, 500);
    }

    console.log('[Facilities] Fetching facilities with sessionId...');
    const facilities = await getShinagawaFacilities(sessionId, env.MONITORING);
    console.log('[Facilities] Facilities count:', facilities.length);

    return jsonResponse({ success: true, data: facilities });
  } catch (error: any) {
    console.error('[Facilities] Error:', error);
    return jsonResponse({ error: error.message || 'Failed to fetch facilities' }, 500);
  }
}

async function handleGetMinatoFacilities(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    // 認証情報を取得
    const settingsData = await env.USERS.get(`settings:${userId}`);
    if (!settingsData) {
      return jsonResponse({ error: 'Credentials not found. Please save your settings first.' }, 400);
    }

    const settings = JSON.parse(settingsData);
    if (!settings.minato) {
      return jsonResponse({ error: 'Minato credentials not found' }, 400);
    }

    // ログインしてsessionIdを取得
    // パスワードを復号化（平文パスワードの場合はそのまま使用）
    let decryptedPassword = settings.minato.password;
    if (isEncrypted(settings.minato.password)) {
      try {
        decryptedPassword = await decryptPassword(settings.minato.password, env.ENCRYPTION_KEY);
      } catch (error) {
        console.error('[Facilities] Failed to decrypt password:', error);
        return jsonResponse({ error: 'Failed to decrypt password' }, 500);
      }
    }
    const sessionId = await loginToMinato(settings.minato.username, decryptedPassword);
    if (!sessionId) {
      return jsonResponse({ error: 'Failed to login to Minato' }, 500);
    }

    const facilities = await getMinatoFacilities(sessionId, env.MONITORING);

    return jsonResponse({ success: true, data: facilities });
  } catch (error: any) {
    console.error('Get Minato facilities error:', error);
    return jsonResponse({ error: error.message || 'Failed to fetch facilities' }, 500);
  }
}

async function handleGetReservationPeriod(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const url = new URL(request.url);
    const site = url.searchParams.get('site') as 'shinagawa' | 'minato';
    
    if (!site || (site !== 'shinagawa' && site !== 'minato')) {
      return jsonResponse({ error: 'Invalid or missing site parameter (shinagawa or minato)' }, 400);
    }

    // セッション情報を取得（オプション）
    kvMetrics.reads++;
    const sessionData = await env.SESSIONS.get(`session:${userId}:${site}`);
    const sessionId = sessionData ? JSON.parse(sessionData).sessionId : null;

    // 予約可能期間を動的取得
    const periodInfo = await getOrDetectReservationPeriod(site, sessionId, env.MONITORING);

    return jsonResponse({ 
      success: true, 
      data: periodInfo
    });
  } catch (error: any) {
    console.error('Get reservation period error:', error);
    return jsonResponse({ error: error.message || 'Failed to fetch reservation period' }, 500);
  }
}

/**
 * 全ユーザーのセッションをリセット（3:15処理用）
 */
async function resetAllSessions(env: Env): Promise<void> {
  console.log('[Reset] セッション全削除開始...');
  
  try {
    // SESSIONSのすべてのキーを取得
    const sessionKeys = await env.SESSIONS.list({ prefix: 'session:' });
    
    console.log(`[Reset] ${sessionKeys.keys.length}件のセッションを削除中...`);
    
    // すべてのセッションを削除
    for (const key of sessionKeys.keys) {
      await env.SESSIONS.delete(key.name);
      console.log(`[Reset] 削除: ${key.name}`);
    }
    
    // メモリキャッシュもクリア
    sessionCache.clear();
    
    console.log('[Reset] ✅ セッション全削除完了');
  } catch (error) {
    console.error('[Reset] ❌ セッション削除エラー:', error);
    throw error;
  }
}

async function getAllActiveTargets(env: Env): Promise<MonitoringTarget[]> {
  // キャッシュされた監視リストを使用
  const cachedList = await getCachedMonitoringList(env.MONITORING);
  
  // キャッシュにデータがある場合はそれを使用
  if (cachedList && cachedList.length > 0) {
    return cachedList.filter((t: MonitoringTarget) => t.status === 'active');
  }
  
  // キャッシュミス時 - 配列管理されたデータを1回のget()で取得（list()不要）
  kvMetrics.reads++;
  const allTargets = await env.MONITORING.get('monitoring:all_targets', 'json') as MonitoringTarget[] || [];
  const activeTargets = allTargets.filter((t: MonitoringTarget) => t.status === 'active');
  
  // 取得したデータをキャッシュに保存
  monitoringListCache.data = activeTargets;
  monitoringListCache.expires = Date.now() + MONITORING_LIST_CACHE_TTL;
  
  return activeTargets;
}

/**
 * ユーザーの成功した予約履歴を取得（キャンセル済み除く）
 */
async function getUserReservations(userId: string, env: Env): Promise<ReservationHistory[]> {
  // 配列管理されたデータを1回のget()で取得（list()不要）
  kvMetrics.reads++;
  const userHistories = await env.RESERVATIONS.get(`history:${userId}`, 'json') as ReservationHistory[] || [];
  return userHistories.filter((h: ReservationHistory) => h.status === 'success');
}

async function checkAndNotify(target: MonitoringTarget, env: Env, isIntensiveMode: boolean = false): Promise<void> {
  const modeLabel = isIntensiveMode ? '🔥 集中' : '📋 通常';
  console.log(`[Check] ${modeLabel} Target ${target.id}: ${target.site} - ${target.facilityName}`);

  try {
    // ユーザーの予約履歴を取得（キャンセル済み除く）
    const existingReservations = await getUserReservations(target.userId, env);
    
    // 認証情報を取得
    const settingsData = await env.USERS.get(`settings:${target.userId}`);
    if (!settingsData) {
      console.error(`[Check] No credentials found for user ${target.userId}`);
      return;
    }
    const settings = JSON.parse(settingsData);
    const siteSettings = target.site === 'shinagawa' ? settings.shinagawa : settings.minato;
    
    // パスワードを復号化（平文パスワードの場合はそのまま使用）
    let decryptedPassword = siteSettings.password;
    if (isEncrypted(siteSettings.password)) {
      try {
        decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
      } catch (error) {
        console.error(`[Check] Failed to decrypt password for user ${target.userId}:`, error);
        return;
      }
    }
    
    const credentials = {
      username: siteSettings.username,
      password: decryptedPassword
    };

    // 年ごとの祝日キャッシュを準備
    const holidaysCacheByYear = new Map<number, HolidayInfo[]>();
    const getHolidaysForDate = (dateStr: string): HolidayInfo[] => {
      const year = new Date(dateStr).getFullYear();
      if (!holidaysCacheByYear.has(year)) {
        holidaysCacheByYear.set(year, getHolidaysForYear(year));
      }
      return holidaysCacheByYear.get(year)!;
    };

    // チェックする日付のリストを生成
    const datesToCheck: string[] = [];
    if (target.startDate && target.endDate) {
      // 期間指定の場合、開始日から終了日まで全日付を生成
      const start = new Date(target.startDate);
      const end = new Date(target.endDate);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        // 祝日判定
        const holidaysCache = getHolidaysForDate(dateStr);
        const isHolidayDate = isHoliday(dateStr, holidaysCache);
        
        // 祝日フィルタリング
        if (target.includeHolidays === 'only') {
          // 祝日のみ監視
          if (!isHolidayDate) {
            console.log(`[Check] Skip ${dateStr}: not a holiday (includeHolidays=only)`);
            continue;
          }
        } else if (target.includeHolidays === false) {
          // 祝日を除外
          if (isHolidayDate) {
            console.log(`[Check] Skip ${dateStr}: holiday excluded (includeHolidays=false)`);
            continue;
          }
        }
        // includeHolidays === true の場合は祝日も含める（何もしない）
        
        // 曜日フィルタリング（祝日のみモードでは不要）
        if (target.includeHolidays !== 'only') {
          if (target.selectedWeekdays && target.selectedWeekdays.length > 0) {
            const dayOfWeek = d.getDay(); // 0=日, 1=月, ..., 6=土
            if (!target.selectedWeekdays.includes(dayOfWeek)) {
              console.log(`[Check] Skip ${dateStr}: weekday ${dayOfWeek} not selected`);
              continue; // 選択されていない曜日はスキップ
            }
          }
        }
        
        datesToCheck.push(dateStr);
      }
    } else {
      // 単一日付の場合
      const dateStr = target.date;
      const d = new Date(dateStr);
      
      // 祝日判定
      const holidaysCache = getHolidaysForDate(dateStr);
      const isHolidayDate = isHoliday(dateStr, holidaysCache);
      
      // 祝日フィルタリング
      let shouldCheck = true;
      if (target.includeHolidays === 'only') {
        shouldCheck = isHolidayDate;
        if (!shouldCheck) {
          console.log(`[Check] Skip ${dateStr}: not a holiday (includeHolidays=only)`);
        }
      } else if (target.includeHolidays === false) {
        shouldCheck = !isHolidayDate;
        if (!shouldCheck) {
          console.log(`[Check] Skip ${dateStr}: holiday excluded (includeHolidays=false)`);
        }
      }
      
      // 曜日フィルタリング（祝日のみモードでは不要）
      if (shouldCheck && target.includeHolidays !== 'only') {
        const dayOfWeek = d.getDay();
        if (target.selectedWeekdays && target.selectedWeekdays.length > 0 && !target.selectedWeekdays.includes(dayOfWeek)) {
          shouldCheck = false;
          console.log(`[Check] Skip ${dateStr}: weekday ${dayOfWeek} not selected`);
        }
      }
      
      if (shouldCheck) {
        datesToCheck.push(dateStr);
      }
    }
    
    console.log(`[Check] Dates to check after filtering: ${datesToCheck.length} days`);

    // チェックする時間帯のリスト
    const timeSlotsToCheck = target.timeSlots || [target.timeSlot];

    // 各日付・時間帯の組み合わせをチェック
    for (const date of datesToCheck) {
      for (const timeSlot of timeSlotsToCheck) {
        let result: AvailabilityResult;

        if (target.site === 'shinagawa') {
          result = await checkShinagawaAvailability(
            target.facilityId,
            date,
            timeSlot,
            credentials,
            existingReservations
          );
        } else {
          result = await checkMinatoAvailability(
            target.facilityId,
            date,
            timeSlot,
            credentials,
            existingReservations
          );
        }

        // 🔥 「取」ステータスを検知した場合（集中監視モードに移行）
        if (result.currentStatus === '取' && target.detectedStatus !== '取') {
          console.log(`[Alert] 🔥「取」検知: ${date} ${timeSlot} - 集中監視モード開始`);
          
          // 次の10分刻み時刻を計算
          const now = new Date();
          const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
          const currentMinutes = jstNow.getMinutes();
          const currentSeconds = jstNow.getSeconds();
          
          // 次の10分刻み（10:10, 10:20, 10:30...）を計算
          let nextTenMinuteMark = Math.ceil((currentMinutes + 1) / 10) * 10;
          if (nextTenMinuteMark === 60) nextTenMinuteMark = 0;
          
          const targetTime = new Date(jstNow);
          targetTime.setMinutes(nextTenMinuteMark, 0, 0); // 秒とミリ秒を0にリセット
          if (nextTenMinuteMark === 0) {
            targetTime.setHours(targetTime.getHours() + 1); // 次の時間の00分
          }
          
          // 集中監視終了時刻: 目標時刻の+2分後まで
          const intensiveUntil = new Date(targetTime.getTime() + 2 * 60 * 1000);
          
          console.log(`[Alert] 集中監視: 現在 ${jstNow.toLocaleTimeString('ja-JP')}, 目標 ${targetTime.toLocaleTimeString('ja-JP')}, 終了 ${intensiveUntil.toLocaleTimeString('ja-JP')}`);
          
          // ターゲットを更新（集中監視モードに設定）
          target.detectedStatus = '取';
          target.intensiveMonitoringUntil = intensiveUntil.getTime() - 9 * 60 * 60 * 1000; // UTC変換
          
          await updateMonitoringTargetOptimized(target, 'intensive_mode_activated', env.MONITORING);
          
          // プッシュ通知送信
          await sendPushNotification(target.userId, {
            title: '🔥「取」検知！集中監視開始',
            body: `${target.facilityName} ${date} ${timeSlot}\n${targetTime.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}に「○」に変わる可能性があります`,
            data: { targetId: target.id, type: 'status_tori_detected' }
          }, env);
        }
        
        // 空きが見つかった場合
        if (result.currentStatus === '○') {
          console.log(`[Alert] ✅ Available: ${date} ${timeSlot}`);
          
          // 「取」から「○」に変わった場合は集中監視終了
          if (target.detectedStatus === '取') {
            console.log(`[Alert] 🎉「取」→「○」変化検知！集中監視成功`);
            target.detectedStatus = '○';
            target.intensiveMonitoringUntil = undefined;
          }

          // 自動予約が有効な場合は予約を試みる
          if (target.autoReserve) {
            // 一時的にtargetの日付と時間帯を変更して予約
            const tempTarget = { ...target, date, timeSlot };
            await attemptReservation(tempTarget, env);
          }
        }
        
        // 集中監視期間が過ぎた場合はリセット
        if (target.intensiveMonitoringUntil && target.intensiveMonitoringUntil < Date.now()) {
          console.log(`[Alert] 集中監視期間終了: ${target.facilityName}`);
          target.detectedStatus = undefined;
          target.intensiveMonitoringUntil = undefined;
          await updateMonitoringTargetOptimized(target, 'intensive_mode_ended', env.MONITORING);
        }
      }
    }

    // 最適化された書き込み（ステータス変更時のみwrite）
    if (!target.detectedStatus && !target.intensiveMonitoringUntil) {
      await updateMonitoringTargetOptimized(target, 'checked', env.MONITORING);
    }

  } catch (error) {
    console.error(`[Check] Error for target ${target.id}:`, error);
  }
}

async function checkReservationLimits(userId: string, env: Env): Promise<{ canReserve: boolean; reason?: string }> {
  // ユーザー設定から上限を取得
  const settingsData = await env.USERS.get(`settings:${userId}`);
  if (!settingsData) {
    return { canReserve: true }; // 設定がない場合は制限なし
  }

  const settings = JSON.parse(settingsData);
  const limits = settings.reservationLimits;
  if (!limits || (!limits.perWeek && !limits.perMonth)) {
    return { canReserve: true }; // 上限設定がない場合は制限なし
  }

  // 予約履歴を取得（成功した予約のみ）
  const userHistories = await env.RESERVATIONS.get(`history:${userId}`, 'json') as ReservationHistory[] || [];
  const successfulReservations = userHistories.filter(h => h.status === 'success');

  const now = Date.now();
  const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

  // 週の予約数チェック
  if (limits.perWeek) {
    const weeklyCount = successfulReservations.filter(h => h.createdAt > oneWeekAgo).length;
    if (weeklyCount >= limits.perWeek) {
      return { canReserve: false, reason: `週の予約上限（${limits.perWeek}回）に達しています` };
    }
  }

  // 月の予約数チェック
  if (limits.perMonth) {
    const monthlyCount = successfulReservations.filter(h => h.createdAt > oneMonthAgo).length;
    if (monthlyCount >= limits.perMonth) {
      return { canReserve: false, reason: `月の予約上限（${limits.perMonth}回）に達しています` };
    }
  }

  return { canReserve: true };
}

async function attemptReservation(target: MonitoringTarget, env: Env): Promise<void> {
  console.log(`[Reserve] Attempting reservation for target ${target.id}`);

  try {
    // 予約上限チェック
    const limitCheck = await checkReservationLimits(target.userId, env);
    if (!limitCheck.canReserve) {
      console.log(`[Reserve] Skipped: ${limitCheck.reason}`);
      return; // 監視は継続するが予約はスキップ
    }

    // ユーザーの認証情報を取得
    const settingsData = await env.USERS.get(`settings:${target.userId}`);
    if (!settingsData) {
      console.error(`[Reserve] No credentials found for user ${target.userId}`);
      return;
    }
    const settings = JSON.parse(settingsData);
    const siteSettings = target.site === 'shinagawa' ? settings.shinagawa : settings.minato;
    
    // パスワードを復号化（平文パスワードの場合はそのまま使用）
    let decryptedPassword = siteSettings.password;
    if (isEncrypted(siteSettings.password)) {
      try {
        decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
      } catch (error) {
        console.error(`[Reserve] Failed to decrypt password for user ${target.userId}:`, error);
        return;
      }
    }
    
    const credentials = {
      username: siteSettings.username,
      password: decryptedPassword
    };

    let result;
    if (target.site === 'shinagawa') {
      result = await makeShinagawaReservation(
        target.facilityId,
        target.date,
        target.timeSlot,
        credentials
      );
    } else {
      result = await makeMinatoReservation(
        target.facilityId,
        target.date,
        target.timeSlot,
        credentials
      );
    }

    // 履歴に保存（配列管理）
    const history: ReservationHistory = {
      id: crypto.randomUUID(),
      userId: target.userId,
      targetId: target.id,
      site: target.site,
      facilityId: target.facilityId,
      facilityName: target.facilityName,
      date: target.date,
      timeSlot: target.timeSlot,
      status: result.success ? 'success' : 'failed',
      message: 'message' in result ? result.message : (result.error || ''),
      createdAt: Date.now(),
    };

    // ユーザーの予約履歴配列を取得して追加
    const userHistories = await env.RESERVATIONS.get(`history:${target.userId}`, 'json') as ReservationHistory[] || [];
    userHistories.push(history);
    await env.RESERVATIONS.put(`history:${target.userId}`, JSON.stringify(userHistories));

    // 成功した場合は監視を完了状態に（配列管理）
    if (result.success) {
      target.status = 'completed';
      
      const allTargets = await env.MONITORING.get('monitoring:all_targets', 'json') as MonitoringTarget[] || [];
      const targetIndex = allTargets.findIndex((t: MonitoringTarget) => t.id === target.id);
      if (targetIndex !== -1) {
        allTargets[targetIndex] = target;
        await env.MONITORING.put('monitoring:all_targets', JSON.stringify(allTargets));
      }
    }

    const resultMessage = 'message' in result ? result.message : (result.error || 'Unknown error');
    console.log(`[Reserve] Result: ${result.success ? 'SUCCESS' : 'FAILED'} - ${resultMessage}`);
  } catch (error) {
    console.error(`[Reserve] Error:`, error);
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
