
import { Env, MonitoringTarget } from '../types';
import { authenticate } from '../auth';
import { getUserMonitoringState, saveUserMonitoringState } from '../lib/monitoringState';
import { jsonResponse } from '../utils/response';
import { kvMetrics } from '../utils/metrics';
import { monitoringListCache } from '../utils/cache';
import { syncToDO } from '../lib/doSync';
import { getOrDetectReservationPeriod, ReservationPeriodInfo } from '../reservationPeriod';
import { getShinagawaFacilities } from '../scraper/shinagawa';
import { getMinatoFacilities } from '../scraper/minato';

export async function handleMonitoringList(request: Request, env: Env): Promise<Response> {
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

export async function handleMonitoringCreate(request: Request, env: Env): Promise<Response> {
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

        // 施設情報を取得して時間帯をバリデーション
        try {
            kvMetrics.reads++;
            const settingsData = await env.USERS.get(`settings:${userId}`);
            if (settingsData) {
                const settings = JSON.parse(settingsData);
                const credentials = settings[body.site];

                if (credentials) {
                    const facilities = await (body.site === 'shinagawa'
                        ? getShinagawaFacilities(credentials, env.MONITORING, userId)
                        : getMinatoFacilities(sessionId || '', env.MONITORING, userId));

                    const facility = facilities.find(f => f.facilityId === body.facilityId);

                    if (facility?.availableTimeSlots) {
                        // 指定された時間帯が施設で利用可能かチェック
                        const invalidTimeSlots = timeSlots.filter(ts => {
                            const timeStart = ts.split('-')[0] || ts; // "09:00-11:00" → "09:00" or "09:00"
                            return !facility.availableTimeSlots!.includes(timeStart);
                        });

                        if (invalidTimeSlots.length > 0) {
                            return jsonResponse({
                                error: `指定された時間帯は施設で利用できません: ${invalidTimeSlots.join(', ')}`,
                                availableTimeSlots: facility.availableTimeSlots,
                                facilityName: facility.facilityName
                            }, 400);
                        }

                        console.log(`[MonitoringCreate] 時間帯バリデーション成功: ${timeSlots.join(', ')}`);
                    }
                }
            }
        } catch (error: any) {
            console.error(`[MonitoringCreate] 施設情報取得エラー（バリデーションスキップ）: ${error.message}`);
            // エラーでも続行（バリデーションなしで作成）
        }

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

        const hasWeekdayOverlap = (existingWeekdays: number[] | undefined, newWeekdays: number[] | undefined): boolean => {
            // 両方とも未設定（undefined）の場合は重複とみなす
            if (existingWeekdays === undefined && newWeekdays === undefined) return true;

            // 片方だけ未定義の場合は重複とみなす（全曜日設定 vs 曜日指定）
            if (existingWeekdays === undefined || newWeekdays === undefined) return true;

            // 空配列チェック：空配列は「曜日未選択」を意味するので重複しない
            if (existingWeekdays.length === 0 || newWeekdays.length === 0) return false;

            // 両方に値がある場合：共通の曜日があるかチェック
            return existingWeekdays.some(day => newWeekdays.includes(day));
        };

        // 重複チェック実行
        const isDuplicate = state.targets.some(existing =>
            existing.facilityId === body.facilityId &&
            existing.site === body.site &&
            existing.status === 'active' && // activeな監視のみチェック
            isDuplicateDate(existing, { date: targetDate, startDate, endDate }) &&
            hasTimeSlotOverlap(existing.timeSlots || [existing.timeSlot], timeSlots) &&
            hasWeekdayOverlap(existing.selectedWeekdays, body.selectedWeekdays) // 曜日重複チェック追加
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

        // 🚀 Sync to Durable Object
        try {
            const id = env.USER_AGENT.idFromName(`${userId}:${body.site}`);
            const stub = env.USER_AGENT.get(id);

            // Get latest state (including the new target)
            // Note: In a real consistent system, we might want to let DO handle the state of truth,
            // but for now we sync KV -> DO.
            const newState = await getUserMonitoringState(userId, env.MONITORING);

            // Filter targets for this site
            const siteTargets = newState.targets.filter(t => t.site === body.site);

            // Get credentials
            const settingsData = await env.USERS.get(`settings:${userId}`);
            const settings = settingsData ? JSON.parse(settingsData) : {};
            const credentials = settings[body.site];

            await stub.fetch(new Request('http://do/init', {
                method: 'POST',
                body: JSON.stringify({
                    userId,
                    site: body.site,
                    targets: siteTargets,
                    credentials
                })
            }));
            console.log(`[MonitoringCreate] Synced to DO (${body.site})`);
        } catch (e: any) {
            console.error(`[MonitoringCreate] Failed to sync DO: ${e.message}`);
            // Don't fail the request, but log critical error
        }

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

export async function handleMonitoringCreateBatch(request: Request, env: Env): Promise<Response> {
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
            const periodInfo = await getOrDetectReservationPeriod(site as 'shinagawa' | 'minato', sessionId, env.MONITORING);
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

                const hasWeekdayOverlap = (existingWeekdays: number[] | undefined, newWeekdays: number[] | undefined): boolean => {
                    // 両方とも未設定（undefined）の場合は重複とみなす
                    if (existingWeekdays === undefined && newWeekdays === undefined) return true;

                    // 片方だけ未定義の場合は重複とみなす（全曜日設定 vs 曜日指定）
                    if (existingWeekdays === undefined || newWeekdays === undefined) return true;

                    // 空配列チェック：空配列は「曜日未選択」を意味するので重複しない
                    if (existingWeekdays.length === 0 || newWeekdays.length === 0) return false;

                    // 両方に値がある場合：共通の曜日があるかチェック
                    return existingWeekdays.some(day => newWeekdays.includes(day));
                };

                const isDuplicate = state.targets.some(existing =>
                    existing.facilityId === targetData.facilityId &&
                    existing.site === targetData.site &&
                    existing.status === 'active' &&
                    isDuplicateDate(existing, { date: targetDate, startDate, endDate }) &&
                    hasTimeSlotOverlap(existing.timeSlots || [existing.timeSlot], timeSlots) &&
                    hasWeekdayOverlap(existing.selectedWeekdays, targetData.selectedWeekdays) // 曜日重複チェック追加
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

        monitoringListCache.data = null;
        monitoringListCache.expires = 0;

        // Sync all affected sites
        const uniqueSites = new Set(newTargets.map(t => t.site));
        for (const site of uniqueSites) {
            await syncToDO(env, userId, site);
        }

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

export async function handleMonitoringDelete(request: Request, env: Env, path: string): Promise<Response> {
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

        monitoringListCache.data = null;
        monitoringListCache.expires = 0;

        // Sync to DO
        await syncToDO(env, userId, deletedTarget.site);

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

export async function handleMonitoringUpdate(request: Request, env: Env, path: string): Promise<Response> {
    try {
        const payload = await authenticate(request, env.JWT_SECRET);
        const userId = payload.userId;

        // パスから監視IDを取得 (/api/monitoring/:id)
        const parts = path.split('/');
        const targetId = parts[parts.length - 1];

        if (!targetId) {
            return jsonResponse({ error: 'Target ID is required' }, 400);
        }

        const body = await request.json() as any;

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
            if (body && typeof body === 'object' && key in body) {
                (target as any)[key] = (body as any)[key];
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

        monitoringListCache.data = null;
        monitoringListCache.expires = 0;

        // Sync to DO
        await syncToDO(env, userId, target.site);

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

export async function handleMonitoringResume(request: Request, env: Env): Promise<Response> {
    try {
        const payload = await authenticate(request, env.JWT_SECRET);
        const userId = payload.userId;

        console.log(`[MonitoringResume] Manual resume requested for user ${userId}`);

        // Resume Shinagawa UserAgent
        try {
            const id = env.USER_AGENT.idFromName(`${userId}:shinagawa`);
            const stub = env.USER_AGENT.get(id);
            await stub.fetch(new Request('http://do/resume', { method: 'POST' }));
            console.log(`[MonitoringResume] Resumed Shinagawa DO for ${userId}`);
        } catch (e: any) {
            console.error(`[MonitoringResume] Failed to resume Shinagawa DO: ${e.message}`);
        }
        
        // Resume Minato UserAgent (Optional, but good for completeness)
        try {
            const id = env.USER_AGENT.idFromName(`${userId}:minato`);
            const stub = env.USER_AGENT.get(id);
            await stub.fetch(new Request('http://do/resume', { method: 'POST' }));
            console.log(`[MonitoringResume] Resumed Minato DO for ${userId}`);
        } catch (e: any) {
             // Ignore if not exists or fails, Minato might not be active
        }

        return jsonResponse({
            success: true,
            message: 'Monitoring resumed successfully'
        });

    } catch (error: any) {
        return jsonResponse({ error: 'Internal server error: ' + error.message }, 500);
    }
}
