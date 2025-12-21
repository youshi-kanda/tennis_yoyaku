
import { Env } from '../types';
import { getUserMonitoringState } from './monitoringState';

export async function syncToDO(env: Env, userId: string, site: 'shinagawa' | 'minato') {
    try {
        const id = env.USER_AGENT.idFromName(`${userId}:${site}`);
        const stub = env.USER_AGENT.get(id);

        const newState = await getUserMonitoringState(userId, env.MONITORING);
        const siteTargets = newState.targets.filter(t => t.site === site);

        const settingsData = await env.USERS.get(`settings:${userId}`);
        const settings = settingsData ? JSON.parse(settingsData) : {};
        const credentials = settings[site];

        await stub.fetch(new Request('http://do/init', {
            method: 'POST',
            body: JSON.stringify({
                userId,
                site,
                targets: siteTargets,
                credentials
            })
        }));
        console.log(`[SyncDO] Synced ${userId}:${site}`);
    } catch (e: any) {
        console.error(`[SyncDO] Failed (${userId}:${site}):`, e);
    }
}
