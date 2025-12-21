import { Env } from '../index';
import { ReservationHistory } from '../scraper/types';

export interface LimitCheckResult {
    canReserve: boolean;
    reason?: string;
}

/**
 * Checks if the user has reached their reservation limits (weekly/monthly).
 */
export async function checkReservationLimits(userId: string, env: Env): Promise<LimitCheckResult> {
    const settingsData = await env.USERS.get(`settings:${userId}`);
    if (!settingsData) return { canReserve: true };

    const settings = JSON.parse(settingsData);
    const limits = settings.reservationLimits;

    // If no limits defined, allow
    if (!limits || (!limits.perWeek && !limits.perMonth)) return { canReserve: true };

    // Fetch history
    // Note: This relies on the history being stored in KV 'history:{userId}'
    const userHistories = await env.RESERVATIONS.get(`history:${userId}`, 'json') as ReservationHistory[] || [];

    // Filter only successful reservations
    const successfulReservations = userHistories.filter(h => h.status === 'success');

    const now = Date.now();
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    if (limits.perWeek) {
        const weeklyCount = successfulReservations.filter(h => h.createdAt > oneWeekAgo).length;
        if (weeklyCount >= limits.perWeek) {
            return { canReserve: false, reason: `週の予約上限（${limits.perWeek}回）に達しています` };
        }
    }

    if (limits.perMonth) {
        const monthlyCount = successfulReservations.filter(h => h.createdAt > oneMonthAgo).length;
        if (monthlyCount >= limits.perMonth) {
            return { canReserve: false, reason: `月の予約上限（${limits.perMonth}回）に達しています` };
        }
    }

    return { canReserve: true };
}
