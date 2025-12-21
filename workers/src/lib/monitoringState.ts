
import { KVNamespace } from '@cloudflare/workers-types';
import { UserMonitoringState, MonitoringTarget } from '../types';
import { kvMetrics } from '../utils/metrics';

export async function getUserMonitoringState(userId: string, kv: KVNamespace): Promise<UserMonitoringState> {
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
export async function saveUserMonitoringState(userId: string, state: UserMonitoringState, kv: KVNamespace): Promise<void> {
    const key = `MONITORING:${userId}`;
    state.updatedAt = Date.now();

    kvMetrics.writes++;
    await kv.put(key, JSON.stringify(state));
    console.log(`[KV Write] Saved monitoring state for user ${userId}, ${state.targets.length} targets`);
}
