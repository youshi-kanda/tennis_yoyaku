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
  type SiteCredentials,
} from './scraper';
import { getOrDetectReservationPeriod, type ReservationPeriodInfo } from './reservationPeriod';
import { isHoliday, getHolidaysForYear, type HolidayInfo } from './holidays';
import { encryptPassword, decryptPassword, isEncrypted } from './crypto';
import { sendPushNotification, savePushSubscription, deletePushSubscription } from './pushNotification';

// ===== サブリクエスト計測（有料プラン: 制限なし） =====
let subrequestCount = 0;

// オリジナルのfetchを保存（モジュールロード時点で退避）
const originalFetch = globalThis.fetch;

// fetchをラップしてカウント（型安全・メトリクス用）
globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  subrequestCount++;
  
  const input = args[0];
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  console.log(`[Subrequest ${subrequestCount}] ${url}`);
  
  return originalFetch(...args);
};

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
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
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
  reservationStrategy?: 'all' | 'priority_first'; // 予約戦略: 'all'=全取得, 'priority_first'=優先度1枚のみ（デフォルトは'all'）
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

      if (path === '/api/monitoring/create-batch') {
        return handleMonitoringCreateBatch(request, env);
      }

      if (path.startsWith('/api/monitoring/') && request.method === 'DELETE') {
        return handleMonitoringDelete(request, env, path);
      }

      if (path.startsWith('/api/monitoring/') && request.method === 'PATCH') {
        return handleMonitoringUpdate(request, env, path);
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

      if (path === '/api/push/subscribe' && request.method === 'POST') {
        return handlePushSubscribe(request, env);
      }

      if (path === '/api/push/unsubscribe' && request.method === 'POST') {
        return handlePushUnsubscribe(request, env);
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
    const hours = now.getHours();
    const jstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000); // JST変換
    const jstHours = jstTime.getHours();
    const jstMinutes = jstTime.getMinutes();
    
    console.log('[Cron] Started:', jstTime.toISOString(), `(JST: ${jstTime.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })})`);
    
    // 🌅 5:00一斉処理（毎日5:00:00に実行）
    if (jstHours === 5 && jstMinutes === 0) {
      console.log('[Cron] 🌅 5:00一斉処理開始');
      try {
        await handle5AMBatchReservation(env);
        console.log('[Cron] ✅ 5:00一斉処理完了');
        
        // 📊 サブリクエスト数をログ出力
        console.log(`\n📊 [Subrequest Metrics] (5:00一斉処理)`);
        console.log(`   Total: ${subrequestCount}`);
        subrequestCount = 0;
      } catch (error) {
        console.error('[Cron] ❌ 5:00一斉処理失敗:', error);
        console.log(`\n📊 [Subrequest Metrics] (エラー発生)`);
        console.log(`   Total: ${subrequestCount}`);
        subrequestCount = 0;
      }
      return; // 5:00処理後は通常監視をスキップ
    }
    
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
        
        // 📊 サブリクエスト数をログ出力
        console.log(`\n📊 [Subrequest Metrics] (セッションリセット)`);
        console.log(`   Total: ${subrequestCount}`);
        subrequestCount = 0;
      } catch (error) {
        console.error('[Cron] ❌ セッションリセット失敗:', error);
        console.log(`\n📊 [Subrequest Metrics] (エラー発生)`);
        console.log(`   Total: ${subrequestCount}`);
        subrequestCount = 0;
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
      
      // 🔄 予約可能期間を事前取得（サイトごとに1回のみ、キャッシュ活用）
      const periodCache = new Map<string, ReservationPeriodInfo>();
      const sitesNeeded = new Set<string>();
      
      // 継続監視モードのターゲットがあるサイトを特定
      targets.forEach(t => {
        if (t.dateMode === 'continuous') {
          sitesNeeded.add(t.site);
        }
      });
      
      // サイトごとに予約可能期間を取得
      for (const site of sitesNeeded) {
        // 任意のユーザーのセッション情報を取得（site判定用）
        const sampleTarget = targets.find(t => t.site === site);
        if (sampleTarget) {
          const sessionData = await env.SESSIONS.get(`session:${sampleTarget.userId}:${site}`);
          const sessionId = sessionData ? JSON.parse(sessionData).sessionId : null;
          
          const periodInfo = await getOrDetectReservationPeriod(site as 'shinagawa' | 'minato', sessionId, env.MONITORING);
          periodCache.set(site, periodInfo);
          console.log(`[Cron] ${site} 予約可能期間: ${periodInfo.maxDaysAhead}日 (${periodInfo.source})`);
        }
      }
      
      // グローバルキャッシュとして設定（checkAndNotify内で使用）
      (globalThis as any).reservationPeriodCache = periodCache;
      
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
      
      // 📊 サブリクエスト数をログ出力
      console.log(`\n📊 [Subrequest Metrics]`);
      console.log(`   Total: ${subrequestCount}/${SUBREQUEST_LIMIT}`);
      if (subrequestCount > SUBREQUEST_LIMIT) {
        console.error(`   ❌ 無料プラン制限超過: ${subrequestCount - SUBREQUEST_LIMIT}リクエスト over`);
        console.error(`   💡 対策: 実装最適化 or Workers Paid ($5/月) へアップグレード`);
      } else {
        console.log(`   ✅ 無料プラン制限内: 残り${SUBREQUEST_LIMIT - subrequestCount}リクエスト`);
      }
      
      // カウンターリセット（次回Cron実行用）
      subrequestCount = 0;
    } catch (error) {
      console.error('[Cron] Error:', error);
      
      // エラー時もサブリクエスト数を出力
      console.log(`\n📊 [Subrequest Metrics] (エラー発生)`);
      console.log(`   Total: ${subrequestCount}`);
      subrequestCount = 0;
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

    // 🔥 重複チェック（最終検証）
    const state = await getUserMonitoringState(userId, env.MONITORING);
    
    // 重複判定ヘルパー関数
    const isDuplicateDate = (existing: MonitoringTarget, newTarget: any): boolean => {
      if (existing.startDate && existing.endDate && newTarget.startDate && newTarget.endDate) {
        const existingStart = new Date(existing.startDate);
        const existingEnd = new Date(existing.endDate);
        const newStart = new Date(newTarget.startDate);
        const newEnd = new Date(newTarget.endDate);
        // 期間重複チェック
        return (newStart <= existingEnd && newEnd >= existingStart);
      }
      // 単一日付の場合
      return existing.date === newTarget.date;
    };

    const hasTimeSlotOverlap = (existingSlots: string[], newSlots: string[]): boolean => {
      return existingSlots.some(slot => newSlots.includes(slot));
    };

    // 重複チェック実行
    const isDuplicate = state.targets.some(existing => 
      existing.facilityId === body.facilityId &&
      existing.site === body.site &&
      existing.status === 'active' && // activeな監視のみチェック
      isDuplicateDate(existing, { date: targetDate, startDate, endDate }) &&
      hasTimeSlotOverlap(existing.timeSlots || [existing.timeSlot], timeSlots)
    );

    if (isDuplicate) {
      const existingTarget = state.targets.find(e => 
        e.facilityId === body.facilityId &&
        e.site === body.site &&
        e.status === 'active' &&
        isDuplicateDate(e, { date: targetDate, startDate, endDate })
      );

      console.log(`[MonitoringCreate] Duplicate detected for user ${userId}:`, {
        facilityId: body.facilityId,
        site: body.site,
        existing: existingTarget?.id
      });

      return jsonResponse({
        error: 'duplicate',
        message: '同じ監視設定が既に存在します。重複する監視は登録されません。',
        existing: {
          id: existingTarget?.id,
          facilityName: existingTarget?.facilityName,
          date: existingTarget?.date,
          startDate: existingTarget?.startDate,
          endDate: existingTarget?.endDate,
          timeSlots: existingTarget?.timeSlots,
        }
      }, 409); // 409 Conflict
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
      state.targets.push(target);
      await saveUserMonitoringState(userId, state, env.MONITORING);
      
      console.log(`[MonitoringCreate] Successfully added target ${target.id} for user ${userId}`);
    } catch (err: any) {
      console.error(`[MonitoringCreate] KV write failed:`, err);
      if (err.message?.includes('429') || err.message?.includes('limit exceeded')) {
        throw new Error('KV write limit exceeded. Please try again later.');
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

async function handleMonitoringCreateBatch(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const body = await request.json() as {
      targets: Array<{
        site: 'shinagawa' | 'minato';
        facilityId: string;
        facilityName: string;
        date?: string;
        startDate?: string;
        endDate?: string;
        dateMode?: 'single' | 'range' | 'continuous';
        timeSlot?: string;
        timeSlots?: string[];
        selectedWeekdays?: number[];
        priority?: number;
        includeHolidays?: boolean | 'only';
        autoReserve: boolean;
      }>;
    };

    if (!body.targets || body.targets.length === 0) {
      return jsonResponse({ error: 'targets array is required and must not be empty' }, 400);
    }

    console.log(`[MonitoringCreateBatch] Processing ${body.targets.length} targets for user ${userId}`);

    // 予約可能期間を事前取得（サイトごとに1回のみ）
    const periodCache = new Map<string, ReservationPeriodInfo>();
    const sitesNeeded = new Set<string>(body.targets.map(t => t.site));

    for (const site of sitesNeeded) {
      // セッション情報を取得
      kvMetrics.reads++;
      const sessionData = await env.SESSIONS.get(`session:${userId}:${site}`);
      const sessionId = sessionData ? JSON.parse(sessionData).sessionId : null;

      // 予約可能期間を取得
      const periodInfo = await getOrDetectReservationPeriod(site, sessionId, env.MONITORING);
      periodCache.set(site, periodInfo);
      console.log(`[MonitoringCreateBatch] ${site} の予約可能期間: ${periodInfo.maxDaysAhead}日 (source: ${periodInfo.source})`);
    }

    // ユーザーの監視状態を取得
    const state = await getUserMonitoringState(userId, env.MONITORING);

    // 新しい監視ターゲットを作成
    const newTargets: MonitoringTarget[] = [];
    const errors: Array<{ index: number; facilityName: string; error: string }> = [];

    for (let i = 0; i < body.targets.length; i++) {
      const targetData = body.targets[i];

      try {
        // timeSlots優先、なければtimeSlotを使用
        const timeSlots = targetData.timeSlots || (targetData.timeSlot ? [targetData.timeSlot] : []);
        if (timeSlots.length === 0) {
          errors.push({ index: i, facilityName: targetData.facilityName, error: 'timeSlot or timeSlots is required' });
          continue;
        }

        // 予約可能期間を取得
        const periodInfo = periodCache.get(targetData.site)!;

        // 日付の検証と設定
        let targetDate = targetData.date || '';
        let startDate = targetData.startDate;
        let endDate = targetData.endDate;

        // 継続監視モードの場合、終了日を動的設定
        if (targetData.dateMode === 'continuous') {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const maxDate = new Date();
          maxDate.setDate(maxDate.getDate() + periodInfo.maxDaysAhead);

          startDate = tomorrow.toISOString().split('T')[0];
          endDate = maxDate.toISOString().split('T')[0];
          targetDate = startDate;
        } else if (startDate && endDate) {
          targetDate = startDate;

          // 終了日が予約可能期間を超えていないかバリデーション
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const endDateObj = new Date(endDate);
          const maxAllowedDate = new Date(today);
          maxAllowedDate.setDate(maxAllowedDate.getDate() + periodInfo.maxDaysAhead);

          if (endDateObj > maxAllowedDate) {
            errors.push({
              index: i,
              facilityName: targetData.facilityName,
              error: `終了日が予約可能期間を超えています。${targetData.site === 'shinagawa' ? '品川区' : '港区'}は${periodInfo.maxDaysAhead}日先まで予約可能です。`
            });
            continue;
          }
        } else if (!targetData.date && !startDate && !endDate) {
          errors.push({ index: i, facilityName: targetData.facilityName, error: 'date or startDate/endDate is required' });
          continue;
        }

        // 重複チェック
        const isDuplicateDate = (existing: MonitoringTarget, newTarget: any): boolean => {
          if (existing.startDate && existing.endDate && newTarget.startDate && newTarget.endDate) {
            const existingStart = new Date(existing.startDate);
            const existingEnd = new Date(existing.endDate);
            const newStart = new Date(newTarget.startDate);
            const newEnd = new Date(newTarget.endDate);
            return (newStart <= existingEnd && newEnd >= existingStart);
          }
          return existing.date === newTarget.date;
        };

        const hasTimeSlotOverlap = (existingSlots: string[], newSlots: string[]): boolean => {
          return existingSlots.some(slot => newSlots.includes(slot));
        };

        const isDuplicate = state.targets.some(existing =>
          existing.facilityId === targetData.facilityId &&
          existing.site === targetData.site &&
          existing.status === 'active' &&
          isDuplicateDate(existing, { date: targetDate, startDate, endDate }) &&
          hasTimeSlotOverlap(existing.timeSlots || [existing.timeSlot], timeSlots)
        );

        if (isDuplicate) {
          console.log(`[MonitoringCreateBatch] Duplicate detected for facility ${targetData.facilityName}, skipping`);
          errors.push({ index: i, facilityName: targetData.facilityName, error: 'duplicate - already exists' });
          continue;
        }

        // 新しい監視ターゲットを作成
        const target: MonitoringTarget = {
          id: crypto.randomUUID(),
          userId,
          site: targetData.site,
          facilityId: targetData.facilityId,
          facilityName: targetData.facilityName,
          date: targetDate,
          dateMode: targetData.dateMode || 'single',
          startDate: startDate,
          endDate: endDate,
          timeSlot: timeSlots[0],
          timeSlots: timeSlots,
          selectedWeekdays: targetData.selectedWeekdays,
          priority: targetData.priority || 3,
          includeHolidays: targetData.includeHolidays,
          status: 'active',
          autoReserve: targetData.autoReserve,
          createdAt: Date.now(),
        };

        newTargets.push(target);
      } catch (error: any) {
        console.error(`[MonitoringCreateBatch] Error processing target ${i}:`, error);
        errors.push({ index: i, facilityName: targetData.facilityName, error: error.message });
      }
    }

    // 新しいターゲットを追加
    state.targets.push(...newTargets);

    // 1回だけKV書き込み
    try {
      await saveUserMonitoringState(userId, state, env.MONITORING);
      console.log(`[MonitoringCreateBatch] Successfully saved ${newTargets.length} targets for user ${userId}`);
    } catch (err: any) {
      console.error(`[MonitoringCreateBatch] KV write failed:`, err);
      if (err.message?.includes('429') || err.message?.includes('limit exceeded')) {
        throw new Error('KV write limit exceeded. Please try again later.');
      }
      throw err;
    }

    // 監視リストキャッシュを無効化
    monitoringListCache.data = null;
    monitoringListCache.expires = 0;

    return jsonResponse({
      success: true,
      data: {
        created: newTargets.length,
        total: body.targets.length,
        targets: newTargets,
        errors: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error: any) {
    console.error('[MonitoringCreateBatch] Error:', error);
    console.error('[MonitoringCreateBatch] Stack:', error.stack);
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
        throw new Error('KV write limit exceeded. Please try again later.');
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

async function handleMonitoringUpdate(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    // パスから監視IDを取得 (/api/monitoring/:id)
    const parts = path.split('/');
    const targetId = parts[parts.length - 1];

    if (!targetId) {
      return jsonResponse({ error: 'Target ID is required' }, 400);
    }

    const body = await request.json();

    // 新形式：ユーザー単位で取得（KV最適化）
    const state = await getUserMonitoringState(userId, env.MONITORING);

    // 指定されたIDの監視を探す
    const targetIndex = state.targets.findIndex(t => t.id === targetId);

    if (targetIndex === -1) {
      return jsonResponse({ error: 'Monitoring target not found or unauthorized' }, 404);
    }

    const target = state.targets[targetIndex];

    // 更新可能なフィールドのみを許可
    const allowedUpdates = [
      'status', 
      'timeSlots', 
      'selectedWeekdays', 
      'includeHolidays',
      'dateMode',
      'date',
      'startDate',
      'endDate',
      'autoReserve'
    ];

    let hasChanges = false;
    for (const key of allowedUpdates) {
      if (body[key] !== undefined) {
        (target as any)[key] = body[key];
        hasChanges = true;
      }
    }

    if (!hasChanges) {
      return jsonResponse({ error: 'No valid updates provided' }, 400);
    }

    target.updatedAt = Date.now();

    // 新形式で保存（リトライなし - KV書き込み上限対策）
    try {
      await saveUserMonitoringState(userId, state, env.MONITORING);
      console.log(`[MonitoringUpdate] Successfully updated target ${targetId}`);
    } catch (error: any) {
      console.error(`[MonitoringUpdate] KV write failed:`, error);
      if (error.message?.includes('429') || error.message?.includes('limit exceeded')) {
        throw new Error('KV write limit exceeded. Please try again later.');
      }
      throw error;
    }

    // 監視リストキャッシュを無効化
    monitoringListCache.data = null;
    monitoringListCache.expires = 0;

    console.log(`[MonitoringUpdate] Updated monitoring: ${target.facilityName} for user ${userId}`, body);

    return jsonResponse({
      success: true,
      message: 'Monitoring target updated successfully',
      data: target,
    });
  } catch (error: any) {
    console.error('[MonitoringUpdate] Error:', error);
    console.error('[MonitoringUpdate] Stack:', error.stack);
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
      // 旧形式（後方互換性）
      shinagawaUserId?: string;
      shinagawaPassword?: string;
      minatoUserId?: string;
      minatoPassword?: string;
      // 新形式
      shinagawa?: {
        username: string;
        password: string;
      };
      shinagawaSessionId?: string;
      minato?: {
        username: string;
        password: string;
      };
      minatoSessionId?: string;
      reservationLimits?: {
        perWeek?: number;
        perMonth?: number;
      };
    };

    // 既存の設定を取得（マージするため）
    kvMetrics.reads++;
    const existingSettingsData = await env.USERS.get(`settings:${userId}`);
    const existingSettings = existingSettingsData ? JSON.parse(existingSettingsData) : {};

    // 新しい設定を既存の設定にマージ
    const updatedSettings: any = { ...existingSettings };

    // 品川区の設定を更新（指定された場合のみ）
    if (body.shinagawa || body.shinagawaUserId !== undefined || body.shinagawaPassword !== undefined || body.shinagawaSessionId !== undefined) {
      updatedSettings.shinagawa = updatedSettings.shinagawa || {};
      
      // 新形式の処理
      if (body.shinagawa) {
        if (body.shinagawa.username) {
          updatedSettings.shinagawa.username = body.shinagawa.username;
        }
        if (body.shinagawa.password && body.shinagawa.password !== '••••••••') {
          updatedSettings.shinagawa.password = await encryptPassword(body.shinagawa.password, env.ENCRYPTION_KEY);
        }
      }
      
      // 旧形式（後方互換性）
      if (body.shinagawaUserId !== undefined) {
        updatedSettings.shinagawa.username = body.shinagawaUserId;
      }
      if (body.shinagawaPassword !== undefined && body.shinagawaPassword !== '••••••••') {
        updatedSettings.shinagawa.password = await encryptPassword(body.shinagawaPassword, env.ENCRYPTION_KEY);
      }
      
      // セッションID（推奨方式）
      if (body.shinagawaSessionId !== undefined) {
        updatedSettings.shinagawa.sessionId = body.shinagawaSessionId;
        updatedSettings.shinagawa.lastUpdated = Date.now();
        updatedSettings.shinagawa.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        console.log('[SaveSettings] Shinagawa session saved');
      }
    }

    // 港区の設定を更新（指定された場合のみ）
    if (body.minato || body.minatoUserId !== undefined || body.minatoPassword !== undefined || body.minatoSessionId !== undefined) {
      updatedSettings.minato = updatedSettings.minato || {};
      
      // 新形式の処理
      if (body.minato) {
        if (body.minato.username) {
          updatedSettings.minato.username = body.minato.username;
        }
        if (body.minato.password && body.minato.password !== '••••••••') {
          updatedSettings.minato.password = await encryptPassword(body.minato.password, env.ENCRYPTION_KEY);
        }
      }
      
      // 旧形式（後方互換性）
      if (body.minatoUserId !== undefined) {
        updatedSettings.minato.username = body.minatoUserId;
      }
      if (body.minatoPassword !== undefined && body.minatoPassword !== '••••••••') {
        updatedSettings.minato.password = await encryptPassword(body.minatoPassword, env.ENCRYPTION_KEY);
      }
      
      // セッションID（推奨方式）
      if (body.minatoSessionId !== undefined) {
        updatedSettings.minato.sessionId = body.minatoSessionId;
        updatedSettings.minato.lastUpdated = Date.now();
        updatedSettings.minato.expiresAt = Date.now() + 24 * 60 * 60 * 1000;
        console.log('[SaveSettings] Minato session saved');
      }
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

async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    const body = await request.json() as {
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
    };

    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return jsonResponse({ error: 'Invalid subscription data' }, 400);
    }

    await savePushSubscription(userId, body, env);
    console.log('[Push] Subscription saved for user:', userId);

    return jsonResponse({ success: true, message: 'Push subscription saved' });
  } catch (error: any) {
    console.error('[Push] Subscribe error:', error);
    return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
  }
}

async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
  try {
    const payload = await authenticate(request, env.JWT_SECRET);
    const userId = payload.userId;

    await deletePushSubscription(userId, env);
    console.log('[Push] Subscription deleted for user:', userId);

    return jsonResponse({ success: true, message: 'Push subscription removed' });
  } catch (error: any) {
    console.error('[Push] Unsubscribe error:', error);
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

    // パスワードを復号化
    console.log('[Facilities] Decrypting password...');
    let decryptedPassword = settings.shinagawa.password;
    if (isEncrypted(settings.shinagawa.password)) {
      try {
        decryptedPassword = await decryptPassword(settings.shinagawa.password, env.ENCRYPTION_KEY);
      } catch (error) {
        console.error('[Facilities] Failed to decrypt password:', error);
        return jsonResponse({ error: 'Failed to decrypt password' }, 500);
      }
    }

    // 認証情報を準備
    const credentials = {
      username: settings.shinagawa.username,
      password: decryptedPassword,
    };

    console.log('[Facilities] Fetching facilities with credentials...');
    const facilities = await getShinagawaFacilities(credentials, env.MONITORING, userId);
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
    console.log('[Facilities] Fetching Minato facilities for user:', userId);

    // 認証情報を取得
    const settingsData = await env.USERS.get(`settings:${userId}`);
    if (!settingsData) {
      console.log('[Facilities] No settings found for user:', userId);
      return jsonResponse({ error: 'Credentials not found. Please save your settings first.' }, 400);
    }

    const settings = JSON.parse(settingsData);
    console.log('[Facilities] Settings loaded, has minato:', !!settings.minato);
    if (!settings.minato) {
      return jsonResponse({ error: 'Minato credentials not found' }, 400);
    }

    let sessionId: string | null = null;

    // 優先順位1: 保存されたセッションIDを使用
    if (settings.minato.sessionId) {
      console.log('[Facilities] Using stored sessionId for Minato');
      sessionId = settings.minato.sessionId;
    } 
    // 優先順位2: ID/パスワードでログイン
    else if (settings.minato.username && settings.minato.password) {
      console.log('[Facilities] Logging in with credentials for Minato');
      // パスワードを復号化
      let decryptedPassword = settings.minato.password;
      if (isEncrypted(settings.minato.password)) {
        try {
          decryptedPassword = await decryptPassword(settings.minato.password, env.ENCRYPTION_KEY);
        } catch (error) {
          console.error('[Facilities] Failed to decrypt password:', error);
          return jsonResponse({ error: 'Failed to decrypt password' }, 500);
        }
      }
      sessionId = await loginToMinato(settings.minato.username, decryptedPassword);
      if (!sessionId) {
        return jsonResponse({ error: 'Failed to login to Minato' }, 500);
      }
    } else {
      return jsonResponse({ error: 'No Minato credentials or sessionId found' }, 400);
    }

    console.log('[Facilities] Fetching facilities with sessionId...');
    const facilities = await getMinatoFacilities(sessionId, env.MONITORING, userId);
    console.log('[Facilities] Facilities count:', facilities.length);

    return jsonResponse({ success: true, data: facilities });
  } catch (error: any) {
    console.error('[Facilities] Error:', error);
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

/**
 * 5:00一斉処理: 溜まった対象枠（×→○）を一斉に予約
 */
async function handle5AMBatchReservation(env: Env): Promise<void> {
  console.log('[5AM] 🌅 5:00一斉処理開始');
  
  try {
    // すべてのアクティブなターゲットを取得
    const allTargets = await getAllActiveTargets(env);
    console.log(`[5AM] アクティブなターゲット: ${allTargets.length}件`);
    
    if (allTargets.length === 0) {
      console.log('[5AM] 処理対象なし');
      return;
    }
    
    // 優先度順にソート（priorityが高い順、同じなら作成日時が古い順）
    const sortedTargets = allTargets.sort((a, b) => {
      const priorityA = a.priority || 3;
      const priorityB = b.priority || 3;
      if (priorityB !== priorityA) {
        return priorityB - priorityA; // 優先度が高い順
      }
      return a.createdAt - b.createdAt; // 作成日時が古い順
    });
    
    console.log(`[5AM] 優先度順にソート完了: 最高優先度=${sortedTargets[0].priority || 3}`);
    
    // 各ターゲットをチェック・予約
    let reservedCount = 0;
    let failedCount = 0;
    
    for (const target of sortedTargets) {
      try {
        console.log(`[5AM] チェック: ${target.facilityName} (${target.site}) priority=${target.priority || 3}`);
        
        // 空き状況をチェックして即座に予約
        await checkAndNotify(target, env, false);
        
        reservedCount++;
      } catch (error) {
        console.error(`[5AM] ❌ エラー: ${target.facilityName}`, error);
        failedCount++;
      }
    }
    
    console.log(`[5AM] ✅ 処理完了: 成功=${reservedCount}件, 失敗=${failedCount}件`);
    
  } catch (error) {
    console.error('[5AM] ❌ 5:00一斉処理エラー:', error);
    throw error;
  }
}

async function getAllActiveTargets(env: Env): Promise<MonitoringTarget[]> {
  // キャッシュされた監視リストを使用
  const cachedList = await getCachedMonitoringList(env.MONITORING);
  
  // キャッシュにデータがある場合はそれを使用（pausedを除外）
  if (cachedList && cachedList.length > 0) {
    return cachedList.filter((t: MonitoringTarget) => t.status === 'active');
  }
  
  // キャッシュミス時 - 新形式のKVから全ユーザーの監視設定を取得
  console.log('[getAllActiveTargets] キャッシュミス - KVから取得');
  kvMetrics.reads++;
  kvMetrics.cacheMisses++;
  
  // 新形式: MONITORING:{userId} から全ユーザーの監視設定を取得
  const listResult = await env.MONITORING.list({ prefix: 'MONITORING:' });
  const allTargets: MonitoringTarget[] = [];
  
  for (const key of listResult.keys) {
    kvMetrics.reads++;
    const state = await env.MONITORING.get(key.name, 'json') as UserMonitoringState | null;
    if (state && state.targets) {
      allTargets.push(...state.targets);
    }
  }
  
  // status が 'active' のみを返す（'paused' は除外）
  const activeTargets = allTargets.filter((t: MonitoringTarget) => t.status === 'active');
  console.log(`[getAllActiveTargets] 取得完了: ${allTargets.length}件中${activeTargets.length}件がアクティブ（paused除外済み）`);
  
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
      console.error(`[Check] No settings found for user ${target.userId}`);
      return;
    }
    const settings = JSON.parse(settingsData);
    const siteSettings = target.site === 'shinagawa' ? settings.shinagawa : settings.minato;
    
    if (!siteSettings) {
      console.error(`[Check] No ${target.site} settings found for user ${target.userId}`);
      return;
    }
    
    // ID/パスワードチェック
    if (!siteSettings.username || !siteSettings.password) {
      console.error(`[Check] No credentials found for ${target.site}, user ${target.userId}`);
      // プッシュ通知を送信（認証情報未設定）
      await sendPushNotification(target.userId, {
        title: `${target.site === 'shinagawa' ? '品川区' : '港区'}の認証情報が未設定です`,
        body: '設定画面でID・パスワードを保存してください',
      }, env);
      return;
    }
    
    // 認証情報の復号化
    const decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
    const credentials: SiteCredentials = {
      username: siteSettings.username,
      password: decryptedPassword,
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

    // 🔄 継続監視モードの場合、予約可能期間を動的取得して期間を再計算
    let actualStartDate = target.startDate;
    let actualEndDate = target.endDate;
    
    if (target.dateMode === 'continuous') {
      // グローバルキャッシュから予約可能期間を取得（Cron開始時に取得済み）
      const periodCache = (globalThis as any).reservationPeriodCache as Map<string, ReservationPeriodInfo> | undefined;
      let periodInfo: ReservationPeriodInfo;
      
      if (periodCache && periodCache.has(target.site)) {
        // キャッシュヒット
        periodInfo = periodCache.get(target.site)!;
        console.log(`[Check] 継続監視: 予約可能期間=${periodInfo.maxDaysAhead}日 (キャッシュ)`);
      } else {
        // キャッシュミス（フォールバック: 個別取得）
        const sessionData = await env.SESSIONS.get(`session:${target.userId}:${target.site}`);
        const sessionId = sessionData ? JSON.parse(sessionData).sessionId : null;
        periodInfo = await getOrDetectReservationPeriod(target.site, sessionId, env.MONITORING);
        console.log(`[Check] 継続監視: 予約可能期間=${periodInfo.maxDaysAhead}日 (個別取得: ${periodInfo.source})`);
      }
      
      // 明日から予約可能期間まで動的計算
      const tomorrow = new Date();
      tomorrow.setHours(0, 0, 0, 0);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const maxDate = new Date();
      maxDate.setHours(0, 0, 0, 0);
      maxDate.setDate(maxDate.getDate() + periodInfo.maxDaysAhead);
      
      actualStartDate = tomorrow.toISOString().split('T')[0];
      actualEndDate = maxDate.toISOString().split('T')[0];
      
      console.log(`[Check] 継続監視: 動的範囲=${actualStartDate} 〜 ${actualEndDate} (${periodInfo.maxDaysAhead}日)`);
    }

    // チェックする日付のリストを生成
    const datesToCheck: string[] = [];
    if (actualStartDate && actualEndDate) {
      // 期間指定の場合、開始日から終了日まで全日付を生成
      const start = new Date(actualStartDate);
      const end = new Date(actualEndDate);
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
    
    // ✅ 全日チェック: 空きを見逃さないため、毎回全日程をチェック
    const datesToCheckThisRun = datesToCheck;
    
    console.log(`[Check] 📅 チェック対象: ${datesToCheckThisRun.length}日分`);
    if (datesToCheckThisRun.length > 0) {
      const preview = datesToCheckThisRun.length > 3 
        ? `${datesToCheckThisRun.slice(0, 3).join(', ')} ... +${datesToCheckThisRun.length - 3}日`
        : datesToCheckThisRun.join(', ');
      console.log(`[Check] 📅 今回チェック: ${preview}`);
    }

    // チェックする時間帯のリスト
    const timeSlotsToCheck = target.timeSlots || [target.timeSlot];

    // 予約戦略の取得（デフォルトは'all'）
    const strategy = target.reservationStrategy || 'all';
    
    // 空き枠を収集（priority_firstの場合に使用）
    const availableSlots: Array<{date: string; timeSlot: string}> = [];

    // 🔥 集中監視モード: 「取」検知後の高頻度チェック
    const now = Date.now();
    const isIntensiveMode = target.detectedStatus === '取' && target.intensiveMonitoringUntil;
    
    if (isIntensiveMode) {
      const jstNow = new Date(now + 9 * 60 * 60 * 1000);
      const targetTime = new Date((target.intensiveMonitoringUntil! + 9 * 60 * 60 * 1000) - 2 * 60 * 1000); // 目標時刻-2分
      const checkUntil = new Date((target.intensiveMonitoringUntil! + 9 * 60 * 60 * 1000) + 2 * 60 * 1000); // 目標時刻+2分
      
      // 集中監視期間中（目標時刻の前後2分）
      if (jstNow >= targetTime && jstNow <= checkUntil) {
        console.log(`[IntensiveCheck] 🔥 集中監視モード実行中: ${target.facilityName}`);
        console.log(`[IntensiveCheck] 目標時刻: ${new Date(target.intensiveMonitoringUntil! + 9 * 60 * 60 * 1000).toLocaleTimeString('ja-JP')}`);
        
        // 1分間に3回チェック（20秒間隔）
        for (let checkCount = 0; checkCount < 3; checkCount++) {
          console.log(`[IntensiveCheck] チェック ${checkCount + 1}/3 実行中...`);
          
          // 対象日時の空き状況をチェック
          for (const timeSlot of timeSlotsToCheck) {
            let result: AvailabilityResult;
            
            try {
              if (target.site === 'shinagawa') {
                result = await checkShinagawaAvailability(
                  target.facilityId,
                  target.date,
                  timeSlot,
                  credentials,
                  existingReservations
                );
              } else {
                result = await checkMinatoAvailability(
                  target.facilityId,
                  target.date,
                  timeSlot,
                  credentials,
                  existingReservations
                );
              }
              
              console.log(`[IntensiveCheck] ${timeSlot}: ${result.currentStatus}`);
              
              // 「○」に変わった！
              if (result.currentStatus === '○') {
                console.log(`[IntensiveCheck] 🎉 「取」→「○」検知！即座に予約実行`);
                
                // 集中監視モード終了
                target.detectedStatus = '○';
                target.intensiveMonitoringUntil = undefined;
                await updateMonitoringTargetOptimized(target, 'intensive_success', env.MONITORING);
                
                // 即座に予約
                const tempTarget = { ...target, date: target.date, timeSlot };
                await attemptReservation(tempTarget, env);
                
                // プッシュ通知
                await sendPushNotification(target.userId, {
                  title: '🎉 予約成功！',
                  body: `${target.facilityName} ${target.date} ${timeSlot}\n集中監視で「取」→「○」を検知し予約しました`,
                  data: { targetId: target.id, type: 'intensive_success' }
                }, env);
                
                // 集中監視成功、このターゲットの処理を終了
                return;
              }
              
            } catch (error: any) {
              console.error(`[IntensiveCheck] エラー: ${error.message}`);
            }
          }
          
          // 最後のチェック以外は20秒待機
          if (checkCount < 2) {
            console.log(`[IntensiveCheck] 20秒待機中... (${checkCount + 1}/2)`);
            await new Promise(resolve => setTimeout(resolve, 20000));
          }
        }
        
        console.log(`[IntensiveCheck] 3回チェック完了。まだ「○」にならず。次のCronで再チェック。`);
        
        // 集中監視期間中は通常チェックをスキップ
        return;
      }
    }

    // 🚀 並列処理で高速化: 今回の3日分のチェックを同時実行
    const checkPromises: Promise<{date: string; timeSlot: string; result: AvailabilityResult}>[] = [];
    
    for (const date of datesToCheckThisRun) {
      for (const timeSlot of timeSlotsToCheck) {
        const promise = (async () => {
          let result: AvailabilityResult;

          try {
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
          } catch (error: any) {
            // ログイン失敗をキャッチしてプッシュ通知
            if (error.message.includes('Login failed')) {
              console.error(`[Check] Login failed for ${target.site}: ${error.message}`);
              await sendPushNotification(target.userId, {
                title: `${target.site === 'shinagawa' ? '品川区' : '港区'}のログインに失敗しました`,
                body: 'ID・パスワードを確認してください',
              }, env);
            }
            throw error;
          }
          
          return { date, timeSlot, result };
        })();
        
        checkPromises.push(promise);
      }
    }
    
    // 並列数を制限してバッチ処理（無料プランのCPU時間制限対策）
    const BATCH_SIZE = 5; // 5件ずつ処理
    const checkResults: Array<{ date: string; timeSlot: string; result: any }> = [];
    
    console.log(`[Check] 🚀 並列実行: ${checkPromises.length}件の空き状況チェック（バッチサイズ: ${BATCH_SIZE}）`);
    
    for (let i = 0; i < checkPromises.length; i += BATCH_SIZE) {
      const batch = checkPromises.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch);
      checkResults.push(...batchResults);
      console.log(`[Check] 📦 バッチ ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(checkPromises.length / BATCH_SIZE)} 完了 (${batchResults.length}件)`);
    }
    
    console.log(`[Check] ✅ 並列実行完了: ${checkResults.length}件処理`);
    
    // 結果を処理
    for (const { date, timeSlot, result } of checkResults) {

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

          // 予約戦略に応じて処理
          if (target.autoReserve) {
            if (strategy === 'priority_first') {
              // モードB: 空き枠を収集（後でまとめて優先度順に1枚だけ予約）
              availableSlots.push({ date, timeSlot });
              console.log(`[Alert] 📌 空き枠収集: ${date} ${timeSlot} (priority_first モード)`);
            } else {
              // モードA: 即座に予約（全取得）
              const tempTarget = { ...target, date, timeSlot };
              await attemptReservation(tempTarget, env);
            }
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
    
    // モードB（priority_first）: 収集した空き枠から優先度の高い1枚のみ予約
    if (strategy === 'priority_first' && availableSlots.length > 0 && target.autoReserve) {
      console.log(`[Alert] 🎯 priority_firstモード: ${availableSlots.length}枚の空きから1枚選択`);
      
      // 最初の枠（最も早い日付・時間帯）を選択
      const selectedSlot = availableSlots[0];
      console.log(`[Alert] ✅ 選択: ${selectedSlot.date} ${selectedSlot.timeSlot}`);
      
      const tempTarget = { ...target, date: selectedSlot.date, timeSlot: selectedSlot.timeSlot };
      await attemptReservation(tempTarget, env);
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
      console.error(`[Reserve] No settings found for user ${target.userId}`);
      return;
    }
    const settings = JSON.parse(settingsData);
    const siteSettings = target.site === 'shinagawa' ? settings.shinagawa : settings.minato;
    
    if (!siteSettings) {
      console.error(`[Reserve] No ${target.site} settings for user ${target.userId}`);
      return;
    }
    
    // セッションIDを取得（優先順位1: 保存されたセッションID、優先順位2: ID/パスワードでログイン）
    let sessionId = siteSettings.sessionId;
    
    if (!sessionId && siteSettings.username && siteSettings.password) {
      console.log(`[Reserve] No sessionId, attempting login for ${target.site}`);
      
      // パスワードを復号化
      let decryptedPassword = siteSettings.password;
      if (isEncrypted(siteSettings.password)) {
        try {
          decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
        } catch (error) {
          console.error('[Reserve] Failed to decrypt password:', error);
          return;
        }
      }
      
      // ログインしてセッションIDを取得
      if (target.site === 'shinagawa') {
        sessionId = await loginToShinagawa(siteSettings.username, decryptedPassword);
      } else {
        sessionId = await loginToMinato(siteSettings.username, decryptedPassword);
      }
      
      if (!sessionId) {
        console.error(`[Reserve] Failed to login for ${target.site}`);
        await sendPushNotification(target.userId, {
          title: `${target.site === 'shinagawa' ? '品川区' : '港区'}のログインに失敗しました`,
          body: 'ID・パスワードまたはセッションIDを確認してください',
        }, env);
        return;
      }
    }
    
    if (!sessionId) {
      console.error(`[Reserve] No credentials available for ${target.site}, user ${target.userId}`);
      await sendPushNotification(target.userId, {
        title: `${target.site === 'shinagawa' ? '品川区' : '港区'}の認証情報が未設定です`,
        body: '設定画面でID・パスワードまたはセッションIDを設定してください',
      }, env);
      return;
    }

    let result;
    try {
      if (target.site === 'shinagawa') {
        result = await makeShinagawaReservation(
          target.facilityId,
          target.date,
          target.timeSlot,
          sessionId
        );
      } else {
        result = await makeMinatoReservation(
          target.facilityId,
          target.date,
          target.timeSlot,
          sessionId
        );
      }
      
      // ログイン失敗チェック
      if (!result.success && ('message' in result ? result.message?.includes('ログイン') : result.error?.includes('ログイン'))) {
        await sendPushNotification(target.userId, {
          title: `${target.site === 'shinagawa' ? '品川区' : '港区'}のログインに失敗しました`,
          body: 'ID・パスワードを確認してください',
        }, env);
      }
    } catch (error: any) {
      console.error(`[Reserve] Error: ${error.message}`);
      if (error.message.includes('Login failed')) {
        await sendPushNotification(target.userId, {
          title: `${target.site === 'shinagawa' ? '品川区' : '港区'}のログインに失敗しました`,
          body: 'ID・パスワードを確認してください',
        }, env);
      }
      return;
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

/**
 * セッション期限切れ通知を送信
 */
async function sendSessionExpiredNotification(userId: string, site: 'shinagawa' | 'minato', env: Env): Promise<void> {
  try {
    const siteName = site === 'shinagawa' ? '品川区' : '港区';
    const siteUrl = site === 'shinagawa' 
      ? 'https://www.cm9.eprs.jp/shinagawa/web/' 
      : 'https://web101.rsv.ws-scs.jp/web/';
    
    // プッシュ通知を送信
    await sendPushNotification(userId, {
      title: `${siteName}: セッション期限切れ`,
      body: `${siteName}の予約サイトに再ログインしてセッションを更新してください`,
      data: { 
        type: 'session_expired', 
        site,
        url: siteUrl
      }
    }, env);
    
    console.log(`[SessionExpired] Notification sent to user ${userId} for ${site}`);
  } catch (error) {
    console.error('[SessionExpired] Failed to send notification:', error);
  }
}

function jsonResponse(data: any, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
