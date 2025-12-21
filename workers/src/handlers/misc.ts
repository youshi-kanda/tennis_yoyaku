
import { Env, MonitoringTarget } from '../types';
import { authenticate } from '../auth';
import { jsonResponse } from '../utils/response';
import {
    savePushSubscription,
    deletePushSubscription,
    sendPushNotification,
    getNotificationHistory,
    getUserSubscription,
} from '../pushNotification';
import { getShinagawaFacilities } from '../scraper/shinagawa';
import { getMinatoFacilities, loginToMinato } from '../scraper/minato';
import { decryptPassword, isEncrypted, encryptPassword } from '../crypto';
import { getOrDetectReservationPeriod } from '../reservationPeriod';
import { kvMetrics } from '../utils/metrics';

// =============================================================================
// Push Notification Handlers
// =============================================================================

export async function handlePushSubscribe(request: Request, env: Env): Promise<Response> {
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
            console.warn('[Push] Invalid subscription data received:', JSON.stringify(body));
            return jsonResponse({ error: 'Invalid subscription data', received: body }, 400);
        }

        await savePushSubscription(userId, body, env);
        console.log('[Push] Subscription saved for user:', userId);

        return jsonResponse({ success: true, message: 'Push subscription saved' });
    } catch (error: any) {
        console.error('[Push] Subscribe error:', error);
        return jsonResponse({ error: 'Unauthorized: ' + error.message }, 401);
    }
}

export async function handlePushUnsubscribe(request: Request, env: Env): Promise<Response> {
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

export async function handleTestNotification(request: Request, env: Env): Promise<Response> {
    try {
        const payload = await authenticate(request, env.JWT_SECRET);
        const userId = payload.userId;

        // Check subscription first
        const subscription = await getUserSubscription(userId, env);
        if (!subscription) {
            return jsonResponse({
                success: false,
                error: 'No push subscription found.',
                message: '通知設定が見つかりません。「プッシュ通知の修復・同期」をお試しください。',
            }, 400);
        }

        // 自分自身への通知のみ許可
        const success = await sendPushNotification(userId, {
            title: '🔔 テスト通知',
            body: 'プッシュ通知設定は正常です！この通知が届けばiOSでも問題なく動作しています。',
            data: {
                type: 'test_notification',
                timestamp: Date.now(),
            }
        }, env);

        if (success) {
            return jsonResponse({
                success: true,
                message: 'Test notification sent successfully',
            });
        } else {
            return jsonResponse({
                success: false,
                error: 'Failed to send notification.',
                message: '通知の送信に失敗しました。「プッシュ通知を解除」して再度「有効」にしてください。',
            }, 400);
        }
    } catch (error: any) {
        if (error.message === 'Unauthorized') {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        return jsonResponse({ error: error.message }, 500);
    }
}

export async function handleNotificationsHistory(request: Request, env: Env): Promise<Response> {
    try {
        const payload = await authenticate(request, env.JWT_SECRET);
        const userId = payload.userId;

        const history = await getNotificationHistory(userId, env);

        return jsonResponse({
            success: true,
            data: history
        });
    } catch (error: any) {
        if (error.message === 'Unauthorized') {
            return jsonResponse({ error: 'Unauthorized' }, 401);
        }
        return jsonResponse({ error: error.message }, 500);
    }
}

// =============================================================================
// Facility Handlers
// =============================================================================

export async function handleGetShinagawaFacilities(request: Request, env: Env): Promise<Response> {
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

export async function handleGetMinatoFacilities(request: Request, env: Env): Promise<Response> {
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
        const facilities = await getMinatoFacilities(sessionId || '', env.MONITORING, userId);
        console.log('[Facilities] Facilities count:', facilities.length);

        return jsonResponse({ success: true, data: facilities });
    } catch (error: any) {
        console.error('[Facilities] Error:', error);
        return jsonResponse({ error: error.message || 'Failed to fetch facilities' }, 500);
    }
}

// =============================================================================
// Helper Handlers
// =============================================================================

export async function handleGetReservationPeriod(request: Request, env: Env): Promise<Response> {
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

// =============================================================================
// Debug Handlers
// =============================================================================

export async function handleDebugDOStatus(request: Request, env: Env): Promise<Response> {
    try {
        // 1. JWT Authentication
        const payload = await authenticate(request, env.JWT_SECRET);
        const userId = payload.userId;

        // 2. Extra Security: Admin Token Check
        // This strictly limits access to holders of the specific Admin Key
        const adminToken = request.headers.get('X-Admin-Token');
        if (adminToken !== env.ADMIN_KEY) {
            console.warn(`[DebugAPI] Blocked unauthorized access attempt for ${userId} (Invalid Token)`);
            return jsonResponse({ error: 'Requires X-Admin-Token' }, 403);
        }

        const url = new URL(request.url);
        const site = url.searchParams.get('site') as 'shinagawa' | 'minato';

        if (!site) return jsonResponse({ error: 'site param required' }, 400);

        const id = env.USER_AGENT.idFromName(`${userId}:${site}`);
        const stub = env.USER_AGENT.get(id);

        // 3. Audit Log
        console.log(`[DebugAPI] Accessed by ${userId} for ${site}. Method: ${request.method}`);

        if (request.method === 'POST') {
            // Update Safety Config
            const body = await request.json();
            const res = await stub.fetch(new Request('http://do/safety-config', {
                method: 'POST',
                body: JSON.stringify(body)
            }));
            const data = await res.json();
            console.log(`[DebugAPI] Safety Config Updated for ${userId}:${site}`, body);
            return jsonResponse({
                success: true,
                safety: data,
                maintenanceMode: env.MAINTENANCE_MODE === 'true'
            });
        } else {
            // Get Status
            const res = await stub.fetch(new Request('http://do/status'));
            const data = await res.json();
            return jsonResponse({
                success: true,
                doStatus: data,
                maintenanceMode: env.MAINTENANCE_MODE === 'true'
            });
        }
    } catch (error: any) {
        return jsonResponse({ error: error.message }, 500);
    }
}

export async function handleGetSettings(request: Request, env: Env): Promise<Response> {
    const payload = await authenticate(request, env.JWT_SECRET);
    const settings = await env.USERS.get(`settings:${payload.userId}`, 'json');
    return jsonResponse(settings || {});
}

export async function handleSaveSettings(request: Request, env: Env): Promise<Response> {
    const payload = await authenticate(request, env.JWT_SECRET);
    const newSettings = await request.json() as any;

    try {
        const existingSettings = await env.USERS.get(`settings:${payload.userId}`, 'json') as any || {};

        // Check Shinagawa Password Encryption
        if (newSettings.shinagawa && newSettings.shinagawa.password) {
            if (!isEncrypted(newSettings.shinagawa.password)) {
                newSettings.shinagawa.password = await encryptPassword(newSettings.shinagawa.password, env.ENCRYPTION_KEY);
            }
        } else if (existingSettings.shinagawa && existingSettings.shinagawa.password && newSettings.shinagawa) {
            newSettings.shinagawa.password = existingSettings.shinagawa.password;
        }

        // Check Minato Password Encryption
        if (newSettings.minato && newSettings.minato.password) {
            if (!isEncrypted(newSettings.minato.password)) {
                newSettings.minato.password = await encryptPassword(newSettings.minato.password, env.ENCRYPTION_KEY);
            }
        } else if (existingSettings.minato && existingSettings.minato.password && newSettings.minato) {
            newSettings.minato.password = existingSettings.minato.password;
        }

        await env.USERS.put(`settings:${payload.userId}`, JSON.stringify(newSettings));
        return jsonResponse({ success: true });
    } catch (error: any) {
        return jsonResponse({ error: error.message }, 500);
    }
}

export async function handleReservationHistory(request: Request, env: Env): Promise<Response> {
    const payload = await authenticate(request, env.JWT_SECRET);
    const history = await env.RESERVATIONS.get(`history:${payload.userId}`, 'json');
    return jsonResponse(history || []);
}
