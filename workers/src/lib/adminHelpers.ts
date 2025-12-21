
import { Env, MonitoringTarget, UserMonitoringState } from '../types';
import { sessionCache } from '../utils/cache';

/**
 * すべてのアクティブな監視ターゲットを取得
 * (管理画面や一斉処理で使用)
 */
export async function getAllActiveTargets(env: Env): Promise<MonitoringTarget[]> {
    const allTargets: MonitoringTarget[] = [];
    const list = await env.MONITORING.list({ prefix: 'MONITORING:' });

    // Note: listing keys creates subrequests. 
    // Optimization: Parallel fetch? Workers limit is 6 concurrent?
    // Use Promise.all with chunks if massive. For now serial/parallel is okay.

    const promises = list.keys.map(key => env.MONITORING.get(key.name, 'json'));
    const results = await Promise.all(promises);

    for (const state of results) {
        if (state) {
            const monitoringState = state as UserMonitoringState;
            if (monitoringState.targets) {
                allTargets.push(...monitoringState.targets);
            }
        }
    }

    return allTargets;
}

/**
 * 監視設定バージョンをインクリメント
 * (キャッシュ無効化などのシグナルとして使用)
 */
export async function incrementMonitoringVersion(env: Env): Promise<void> {
    const current = await env.MONITORING.get('MONITORING_VERSION');
    const next = (parseInt(current || '0') + 1).toString();
    await env.MONITORING.put('MONITORING_VERSION', next);
}

/**
 * 全ユーザーのセッションをリセット
 */
export async function resetAllSessions(env: Env): Promise<number> {
    console.log('[Reset] セッション全削除開始...');
    let deletedCount = 0;

    try {
        // SESSIONSのすべてのキーを取得
        const sessionKeys = await env.SESSIONS.list({ prefix: 'session:' });

        console.log(`[Reset] ${sessionKeys.keys.length}件のセッションを削除中...`);

        // すべてのセッションを削除
        for (const key of sessionKeys.keys) {
            await env.SESSIONS.delete(key.name);
            deletedCount++;
        }

        // メモリキャッシュもクリア
        sessionCache.clear();

        console.log('[Reset] ✅ セッション全削除完了');
        return deletedCount;
    } catch (error) {
        console.error('[Reset] ❌ セッション削除エラー:', error);
        throw error;
    }
}
