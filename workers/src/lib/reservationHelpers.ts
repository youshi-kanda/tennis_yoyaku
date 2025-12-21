
import { Env, MonitoringTarget } from '../types';
import { ReservationHistory } from '../scraper/types';

/**
 * ユーザーの予約履歴を取得
 */
export async function getUserReservations(userId: string, env: Env): Promise<ReservationHistory[]> {
    const history = await env.RESERVATIONS.get(`history:${userId}`, 'json');
    return (history as ReservationHistory[]) || [];
}
