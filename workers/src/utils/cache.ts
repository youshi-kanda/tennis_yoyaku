
export interface MonitoringListCache {
    data: any[] | null;
    expires: number;
    version: number | null;
}

export const monitoringListCache: MonitoringListCache = {
    data: null,
    expires: 0,
    version: null
};

export const SESSION_CACHE_TTL = 30 * 60 * 1000; // 30分
export const MONITORING_LIST_CACHE_TTL = 3 * 60 * 1000; // 3分

export interface SessionCacheEntry {
    sessionId: string;
    expires: number;
}

export const sessionCache = new Map<string, SessionCacheEntry>();
