// Trigger Deployment
import {
  generateJWT, verifyJWT, hashPassword, verifyPassword, authenticate, requireAdmin
} from './auth';
import { KVLock } from './lib/kvLock';
import { SmartBackoff } from './lib/backoff';
// SmartBackoff removed - login failure tracking now handled by Durable Objects
import { corsHeaders, jsonResponse } from './utils/response';
import { kvMetrics } from './utils/metrics';
import { monitoringListCache, MONITORING_LIST_CACHE_TTL, sessionCache, SESSION_CACHE_TTL } from './utils/cache';
import { getUserMonitoringState, saveUserMonitoringState } from './lib/monitoringState';
import { syncToDO } from './lib/doSync';
import { handleLogin, handleRegister, handleChangePassword } from './handlers/auth';
import {
  handleMonitoringList,
  handleMonitoringCreate,
  handleMonitoringCreateBatch,
  handleMonitoringDelete,
  handleMonitoringUpdate
} from './handlers/monitoring';
import {
  handleAdminStats,
  handleAdminUsers,
  handleAdminMonitoringCheck,
  handleGetMaintenanceStatus,
  handleEnableMaintenance,
  handleDisableMaintenance,
  handleAdminMonitoring,
  handleAdminReservations,
  handleAdminMonitoringDetail,
  handleAdminDeleteMonitoring,
  handleAdminCreateUser,
  handleAdminDeleteUser,
  handleAdminTestNotification,
  handleAdminResetSessions,
  handleAdminClearCache,
  handleAdminMaintenanceStatus,
  handleAdminMaintenanceEnable,
  handleAdminMaintenanceDisable,
  handleAdminPauseAllMonitoring,
  handleAdminResumeAllMonitoring
} from './handlers/admin';
import {
  handlePushSubscribe,
  handlePushUnsubscribe,
  handleTestNotification,
  handleNotificationsHistory,
  handleGetShinagawaFacilities,
  handleGetMinatoFacilities,
  handleGetReservationPeriod,
  handleDebugDOStatus,
  handleGetSettings,
  handleSaveSettings,
  handleReservationHistory
} from './handlers/misc';
import {
  handle5AMBatchReservation,
  checkAndNotify,
  executeReservation
} from './logic/monitoringLogic';
import {
  checkShinagawaAvailability,
  checkShinagawaWeeklyAvailability,
  loginToShinagawa,
  SHINAGAWA_TIMESLOT_MAP,
  getShinagawaFacilities,
  getShinagawaTennisCourts,
  makeShinagawaReservation,
  SHINAGAWA_SESSION_EXPIRED,
} from './scraper/shinagawa';
import {
  checkMinatoAvailability,
  checkMinatoWeeklyAvailability,
  loginToMinato,
  MINATO_TIMESLOT_MAP,
  getMinatoFacilities,
  makeMinatoReservation,
  MINATO_SESSION_EXPIRED_MESSAGE,
} from './scraper/minato';
import {
  ShinagawaSession,
  AvailabilityResult,
  WeeklyAvailabilityResult,
  ReservationContext,
  SessionData,
  Facility,
  ReservationHistory,
  SiteCredentials
} from './scraper/types';
import { getOrCreateSession } from './session';
import { getOrDetectReservationPeriod, type ReservationPeriodInfo } from './reservationPeriod';
import { isHoliday, getHolidaysForYear, type HolidayInfo } from './holidays';
import { encryptPassword, decryptPassword, isEncrypted } from './crypto';
import { checkTimeRestrictions, TimeRestrictions } from './utils/time';

// -----------------------------------------------------------------------------
// Scheduled Task Handler (Cron Trigger)
// -----------------------------------------------------------------------------

// Legacy Cron handler removed - monitoring now handled by Durable Objects Alarm Loop

// refreshAllSessions removed - session management now handled by Durable Objects

// NOTE: Since rewriting the entire `scheduled` function is too large, we will focus on
// modifying the `checkShinagawa` and `checkMinato` calls to use `runWithLock`.

// Helper functions section will be handled separately



import {
  savePushSubscription,
  deletePushSubscription,
  sendPushNotification,
  getNotificationHistory,
  getUserSubscription,
} from './pushNotification';

// ===== サブリクエスト計測（有料プラン: 制限なし） =====
let subrequestCount = 0;

// オリジナルのfetchを保存（モジュールロード時点で退避）
const originalFetch = globalThis.fetch;

// fetchをラップしてカウント（型安全・メトリクス用）
globalThis.fetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
  subrequestCount++;

  // ログサイズ削減のためsubrequestログを無効化
  // const input = args[0];
  // const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  // console.log(`[Subrequest ${subrequestCount}] ${url}`);

  return originalFetch(...args);
};
// const MONITORING_LIST_CACHE_TTL = 3 * 60 * 1000; // 3分 -> Importing from utils/cache now

// KV使用量メトリクス（初回リクエスト時に初期化）

// メトリクス初期化関数
function initializeMetricsIfNeeded() {
  if (kvMetrics.resetAt === 0) {
    kvMetrics.resetAt = Date.now();
    console.log('[KV Metrics] Initialized at:', new Date(kvMetrics.resetAt).toISOString());
  }
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
  VERSION?: string;
  MAINTENANCE_MODE?: string; // メンテナンスモードフラグ: 'true' or 'false'
  MAINTENANCE_MESSAGE?: string; // メンテナンスモード時のメッセージ
  RESERVATION_QUEUE: Queue<ReservationMessage>; // Queue binding
  USER_AGENT: DurableObjectNamespace; // DO binding
}

export { UserAgent } from './do/UserAgent';

export interface ReservationMessage {
  target: MonitoringTarget;
  weeklyContext?: any;
}

export interface User {
  id: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  createdAt: number;
  updatedAt?: number;
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
  status: 'active' | 'pending' | 'completed' | 'failed' | 'detected' | 'paused';
  autoReserve: boolean;
  reservationStrategy?: 'all' | 'priority_first'; // 予約戦略: 'all'=全取得, 'priority_first'=優先度1枚のみ（デフォルトは'all'）
  lastCheck?: number;
  lastStatus?: string; // '×' or '○' or '取'
  detectedStatus?: '×' | '取' | '○'; // 検知したステータス（集中監視用）
  intensiveMonitoringUntil?: number; // 集中監視の終了時刻（タイムスタンプ）- 廃止予定
  nextIntensiveCheckTime?: number; // 次の集中監視時刻（10分単位）
  intensiveMonitoringDate?: string; // 集中監視対象の日付
  intensiveMonitoringTimeSlot?: string; // 集中監視対象の時間帯
  applicantCount?: number; // 利用人数（未指定時は品川2人、港4人）
  createdAt: number;
  updatedAt?: number;
  detectedAt?: number; // 空き枠検知時刻
  failedAt?: number; // 予約失敗時刻
  failureReason?: string; // 予約失敗理由
}

// ===== バッチ化されたデータ構造（KV最適化） =====
export interface UserMonitoringState {
  targets: MonitoringTarget[];
  updatedAt: number;
  version: number; // データバージョン管理
}



// Cloudflare Workers制限
const SUBREQUEST_LIMIT = 1000; // 有料プラン: 1,000リクエスト/実行

// ===== バッチ化ヘルパー関数（KV最適化） =====

/**
 * ユーザーの監視状態を取得（新形式: MONITORING:{userId}）
 * 後方互換性のため、旧形式(monitoring:all_targets)からの自動移行も行う
 */

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
    // メトリクス初期化（初回リクエスト時のみ）
    initializeMetricsIfNeeded();

    // -------------------------------------------------------------------------
    // SECURITY CHECK: Verify critical secrets are set
    // -------------------------------------------------------------------------
    // 本番環境でシークレットが設定されていない場合の明確なエラーメッセージ
    if ((!env.JWT_SECRET || !env.VAPID_PRIVATE_KEY) && env.ENVIRONMENT === 'production') {
      const missing = [];
      if (!env.JWT_SECRET) missing.push('JWT_SECRET');
      if (!env.VAPID_PRIVATE_KEY) missing.push('VAPID_PRIVATE_KEY');

      console.error(`[CRITICAL] Missing secrets: ${missing.join(', ')}`);
      return new Response(
        `Critical Configuration Error: Missing secrets (${missing.join(', ')}).\n` +
        `Please run: wrangler secret put <SECRET_NAME>`,
        { status: 500 }
      );
    }

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

      // 通知履歴取得
      if (path === '/api/notifications/history' && request.method === 'GET') {
        return handleNotificationsHistory(request, env);
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

      // 🔐 管理者専用API
      if (path === '/api/admin/stats') {
        return handleAdminStats(request, env);
      }

      if (path === '/api/admin/users') {
        return handleAdminUsers(request, env);
      }

      if (path === '/api/admin/monitoring') {
        return handleAdminMonitoring(request, env);
      }

      if (path === '/api/admin/monitoring/check' && request.method === 'POST') {
        return handleAdminMonitoringCheck(request, env);
      }

      // Maintenance API
      if (path === '/api/admin/maintenance/status') {
        return handleGetMaintenanceStatus(request, env);
      }
      if (path === '/api/admin/maintenance/enable' && request.method === 'POST') {
        return handleEnableMaintenance(request, env);
      }
      if (path === '/api/admin/maintenance/disable' && request.method === 'POST') {
        return handleDisableMaintenance(request, env);
      }

      if (path === '/api/admin/reservations') {
        return handleAdminReservations(request, env);
      }

      // 拡張監視管理API
      if (path === '/api/admin/monitoring/detail') {
        return handleAdminMonitoringDetail(request, env);
      }

      if (path.startsWith('/api/admin/monitoring/') && request.method === 'DELETE') {
        // format: /api/admin/monitoring/:userId or /api/admin/monitoring/:userId/:targetId
        return handleAdminDeleteMonitoring(request, env, path);
      }

      if (path === '/api/admin/users/create' && request.method === 'POST') {
        return handleAdminCreateUser(request, env);
      }

      if (path.startsWith('/api/admin/users/') && request.method === 'DELETE') {
        return handleAdminDeleteUser(request, env, path);
      }

      // 保守点検API
      // 保守点検API
      if (path === '/api/admin/test-notification' && request.method === 'POST') {
        return handleAdminTestNotification(request, env);
      }

      // ユーザー自身のテスト通知
      if (path === '/api/test-notification' && request.method === 'POST') {
        return handleTestNotification(request, env);
      }

      // DO Debug API
      if (path === '/api/debug/do-status') {
        return handleDebugDOStatus(request, env);
      }

      if (path === '/api/admin/reset-sessions' && request.method === 'POST') {
        return handleAdminResetSessions(request, env);
      }

      if (path === '/api/admin/clear-cache' && request.method === 'POST') {
        return handleAdminClearCache(request, env);
      }

      // メンテナンスモード管理API
      if (path === '/api/admin/maintenance/status' && request.method === 'GET') {
        return handleAdminMaintenanceStatus(request, env);
      }

      if (path === '/api/admin/maintenance/enable' && request.method === 'POST') {
        return handleAdminMaintenanceEnable(request, env);
      }

      if (path === '/api/admin/maintenance/disable' && request.method === 'POST') {
        return handleAdminMaintenanceDisable(request, env);
      }

      // 監視一括管理API
      if (path === '/api/admin/monitoring/pause-all' && request.method === 'POST') {
        return handleAdminPauseAllMonitoring(request, env);
      }

      if (path === '/api/admin/monitoring/resume-all' && request.method === 'POST') {
        return handleAdminResumeAllMonitoring(request, env);
      }

      // ユーザー向けAPI（メンテナンスモードチェック）
      if (path === '/api/user/change-password' && request.method === 'POST') {
        return handleChangePassword(request, env);
      }

      // DEBUG: Inspect Users
      if (url.pathname === '/debug/inspect-users' && url.searchParams.get('key') === 'temp-secret') {
        const list = await env.USERS.list({ prefix: 'user:' });
        const logs: string[] = [];
        logs.push('--- User Inspection ---');
        for (const key of list.keys) {
          if (key.name.includes(':id:')) continue;
          const email = key.name.replace('user:', '');
          const userData = await env.USERS.get(key.name, 'json') as any;
          if (!userData) continue;
          const userId = userData.id;
          logs.push(`User: ${email} (ID: ${userId})`);
          const settings = await env.USERS.get(`settings:${userId}`, 'json') as any;
          if (settings) {
            logs.push(`  Settings found.`);
            // Check DO Status directly
            const doId = env.USER_AGENT.idFromName(`${userId}:shinagawa`);
            logs.push(`  DO ID: ${doId.toString()}`);
            const stub = env.USER_AGENT.get(doId);
            try {
              const doRes = await stub.fetch(new Request('http://do/status'));
              const doState = await doRes.json() as any;
              logs.push(`  DO State (Shinagawa): Credentials=${doState.credentials ? 'Present' : 'MISSING'}`);
              if (doState.credentials) {
                logs.push(`    DO Username: ${doState.credentials.username}`);
              }
              const allTargets = doState.targets || [];
              const activeTargets = allTargets.filter((t: any) => t.status === 'active');
              logs.push(`    DO All Targets: ${allTargets.length}, Active: ${activeTargets.length}`);
              // Show all targets
              for (const t of allTargets) {
                logs.push(`      - [${t.status}] ${t.facilityName || t.facilityId} | ${t.date} | ${t.timeSlot}`);
              }
            } catch (e: any) {
              logs.push(`  DO State (Shinagawa): Error fetching status - ${e.message}`);
            }

            if (settings.shinagawa) {
              logs.push(`  Shinagawa KV: Username=${settings.shinagawa.username}, Password=${settings.shinagawa.password ? '(Present)' : '(Missing)'}`);
            } else if (settings.shinagawaUserId) {
              logs.push(`  Shinagawa (Legacy) KV: Username=${settings.shinagawaUserId}`);
            } else {
              logs.push(`  Shinagawa KV: NOT CONFIG`);
            }
          } else {
            logs.push(`  Settings: NOT FOUND`);
          }
          logs.push('');
        }
        return new Response(logs.join('\n'));
      }

      // DEBUG: Force Sync
      if (url.pathname === '/debug/force-sync' && url.searchParams.get('key') === 'temp-secret') {
        const list = await env.USERS.list({ prefix: 'user:' });
        const logs: string[] = [];
        logs.push('--- Force Sync ---');

        for (const key of list.keys) {
          if (key.name.includes(':id:')) continue;
          const email = key.name.replace('user:', '');
          const userData = await env.USERS.get(key.name, 'json') as any;
          if (!userData) continue;

          const userId = userData.id;
          logs.push(`Syncing User: ${email} (${userId})`);

          try {
            // Shinagawa
            await syncToDO(env, userId, 'shinagawa');
            logs.push(`  -> Shimagawa: Synced`);
          } catch (e: any) {
            logs.push(`  -> Shimagawa: ERROR ${e.message}`);
          }

          try {
            // Minato
            await syncToDO(env, userId, 'minato');
            logs.push(`  -> Minato: Synced`);
          } catch (e: any) {
            logs.push(`  -> Minato: ERROR ${e.message}`);
          }
          logs.push('');
        }
        return new Response(logs.join('\n'));
      }




      // DEBUG: Kill Zombie DO
      if (url.pathname === '/debug/kill-zombie' && url.searchParams.get('key') === 'temp-secret') {
        const targetId = url.searchParams.get('id');
        if (!targetId) return new Response('Missing id', { status: 400 });

        try {
          const id = env.USER_AGENT.idFromString(targetId);
          const stub = env.USER_AGENT.get(id);
          const res = await stub.fetch(new Request('http://do/reset', { method: 'POST' }));
          const data = await res.json();
          return new Response(`Killed ${targetId}: ${JSON.stringify(data)}`);
        } catch (e: any) {
          return new Response(`Error killing ${targetId}: ${e.message}`, { status: 500 });
        }
      }

      // DEBUG: Clear User Targets
      if (url.pathname === '/debug/clear-user-targets' && url.searchParams.get('key') === 'temp-secret') {
        const userId = url.searchParams.get('userId');
        const site = (url.searchParams.get('site') as 'shinagawa' | 'minato') || 'shinagawa';
        if (!userId) return new Response('Missing userId', { status: 400 });

        try {
          const id = env.USER_AGENT.idFromName(`${userId}:${site}`);
          const stub = env.USER_AGENT.get(id);
          const res = await stub.fetch(new Request('http://do/clear-targets', { method: 'POST' }));
          const data = await res.json();
          return new Response(`Cleared targets for ${userId}:${site}: ${JSON.stringify(data)}`);
        } catch (e: any) {
          return new Response(`Error: ${e.message}`, { status: 500 });
        }
      }

      // DEBUG: Create Test Target (for monitoring verification)
      if (url.pathname === '/debug/create-target' && url.searchParams.get('key') === 'temp-secret') {
        const userId = url.searchParams.get('userId') || 'b007d9e5-356c-4743-b274-92de3350bb15';
        const site = 'shinagawa';
        const facilityId = url.searchParams.get('facilityId') || '1';
        const facilityName = url.searchParams.get('facilityName') || 'しながわ区民公園';
        const date = url.searchParams.get('date') || '2025-01-29';
        const timeSlot = url.searchParams.get('timeSlot') || '19:00-21:00';

        const targetId = `target_${Date.now()}`;
        const target: MonitoringTarget = {
          id: targetId,
          userId,
          site,
          facilityId,
          facilityName,
          date,
          timeSlot,
          status: 'active',
          autoReserve: false, // Safety OFF
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Save to MONITORING KV (correct key format: MONITORING:${userId})
        const stateKey = `MONITORING:${userId}`;
        const existingData = await env.MONITORING.get(stateKey, 'json') as { targets: MonitoringTarget[] } | null;
        const targets = existingData ? existingData.targets : [];
        targets.push(target);
        await env.MONITORING.put(stateKey, JSON.stringify({ targets, updatedAt: Date.now(), version: 1 }));

        // Direct inject to DO (bypass syncToDO to ensure it works)
        const settingsData = await env.USERS.get(`settings:${userId}`);
        const settings = settingsData ? JSON.parse(settingsData) : {};
        const credentials = settings[site];

        const doId = env.USER_AGENT.idFromName(`${userId}:${site}`);
        const stub = env.USER_AGENT.get(doId);
        await stub.fetch(new Request('http://do/init', {
          method: 'POST',
          body: JSON.stringify({
            userId,
            site,
            targets: targets,  // All targets including new one
            credentials
          })
        }));

        return new Response(`Created target: ${JSON.stringify(target)}\nDirectly injected to DO with ${targets.length} targets.`);
      }

      // DEBUG: Force Check (Get availability result)
      if (url.pathname === '/debug/force-check' && url.searchParams.get('key') === 'temp-secret') {
        const userId = url.searchParams.get('userId') || 'b007d9e5-356c-4743-b274-92de3350bb15';
        const site = (url.searchParams.get('site') as 'shinagawa' | 'minato') || 'shinagawa';

        try {
          const id = env.USER_AGENT.idFromName(`${userId}:${site}`);
          const stub = env.USER_AGENT.get(id);
          const res = await stub.fetch(new Request('http://do/force-check'));
          const data = await res.json();
          return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
        } catch (e: any) {
          return new Response(`Error: ${e.message}`, { status: 500 });
        }
      }

      return jsonResponse({ error: 'Not found' }, 404);
    } catch (error: any) {
      console.error('Error:', error);
      return jsonResponse({ error: error.message || 'Internal server error' }, 500);
    }
  },

  // Empty scheduled handler to suppress "Handler does not export a scheduled() function" errors
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // 🤫 Do nothing. Legacy Cron is disabled.
  },

  // ============================================================================
  // Legacy Cron System Removed
  // All monitoring now handled by Durable Objects Alarm Loop
  // ============================================================================

  async queue(batch: MessageBatch<ReservationMessage>, env: Env): Promise<void> {
    console.log(`[Queue] Received batch of ${batch.messages.length} messages`);

    for (const msg of batch.messages) {
      const { target, weeklyContext } = msg.body;
      console.log(`[Queue] Processing reservation for ${target.facilityName} (${target.date} ${target.timeSlot})`);

      try {
        await executeReservation(target, env, weeklyContext);
        msg.ack();
      } catch (error: any) {
        console.error(`[Queue] Failed to process message ${msg.id}:`, error);

        // リトライ可能か判定（例: ログイン失敗ならリトライ、満室ならリトライ不要）
        const isRetryable = error.message.includes('Login failed') || error.message.includes('network error');

        if (isRetryable) {
          msg.retry(); // Queueのバックオフ設定に従ってリトライ
          console.log(`[Queue] Message ${msg.id} marked for retry`);
        } else {
          console.error(`[Queue] Message ${msg.id} failed permanently: ${error.message}`);
          // 通知を送るなど（executeReservation内でも送っているが）
        }
      }
    }
  }
};
