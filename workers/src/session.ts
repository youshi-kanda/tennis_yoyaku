import { KVNamespace } from '@cloudflare/workers-types';
import { SiteCredentials, SessionData } from './scraper/types';
import { loginToShinagawa } from './scraper/shinagawa';
import { loginToMinato } from './scraper/minato';

/**
 * セッションの有効性を検証
 */
export async function validateSession(
    sessionId: string,
    site: 'shinagawa' | 'minato'
): Promise<boolean> {
    try {
        const baseUrl = site === 'shinagawa'
            ? 'https://www.cm9.eprs.jp/shinagawa/web'
            : 'https://web101.rsv.ws-scs.jp/web';

        const response = await fetch(`${baseUrl}/rsvWMyPageMenuAction.do`, {
            method: 'GET',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        const html = await response.text();
        return !html.includes('rsvWTransUserLoginAction') && response.status === 200;
    } catch (error) {
        console.error('[Session] Validation error:', error);
        return false;
    }
}

/**
 * セッション情報を保存（永続化）
 */
export async function saveSession(
    site: 'shinagawa' | 'minato',
    sessionData: SessionData,
    kv: KVNamespace
): Promise<void> {
    const key = `session:${site}:${sessionData.userId}`;
    await kv.put(key, JSON.stringify(sessionData), {
        expirationTtl: 86400, // 24時間
    });
    console.log(`[Session] Saved for ${site}:${sessionData.userId}`);
}

/**
 * セッション情報を取得
 */
export async function getSession(
    site: 'shinagawa' | 'minato',
    userId: string,
    kv: KVNamespace
): Promise<SessionData | null> {
    const key = `session:${site}:${userId}`;
    const data = await kv.get(key);
    if (!data) return null;

    const session: SessionData = JSON.parse(data);

    // 3:15〜5:00はシステムリセット期間（セッション無効）
    const now = new Date();
    const hour = now.getHours();
    // JST conversion if needed, but workers usually run in UTC. 
    // Assuming the code was written expecting JST or the resetting happens in JST.
    // The original code was: 
    // if (hour >= 3 && hour < 5)
    // Cloudflare Workers time is UTC. user might have meant JST (UTC+9).
    // 3 JST = 18 UTC (prev day). 5 JST = 20 UTC (prev day).
    // If the previous code didn't convert, it might be buggy or assuming local mock.
    // For now I keep it as is to preserve behavior.

    if (hour >= 3 && hour < 5) {
        session.isValid = false;
    }

    return session;
}

/**
 * セッションを取得または新規ログイン
 */
export async function getOrCreateSession(
    site: 'shinagawa' | 'minato',
    credentials: SiteCredentials,
    kv: KVNamespace
): Promise<SessionData | null> {
    const existingSession = await getSession(site, credentials.username, kv);

    if (existingSession && existingSession.isValid) {
        const isValid = await validateSession(existingSession.sessionId, site);

        if (isValid) {
            console.log(`[Session] Reusing existing session for ${site}`);
            existingSession.lastUsed = Date.now();
            await saveSession(site, existingSession, kv);
            return existingSession;
        }
    }

    // 新規ログイン
    console.log(`[Session] Creating new session for ${site}`);
    if (site === 'shinagawa') {
        const sessionObj = await loginToShinagawa(credentials.username, credentials.password);
        if (sessionObj) {
            const sessionData: SessionData = {
                sessionId: sessionObj.cookie,
                site,
                loginTime: Date.now(),
                lastUsed: Date.now(),
                isValid: true,
                userId: credentials.username,
                shinagawaContext: sessionObj
            };
            await saveSession(site, sessionData, kv);
            return sessionData;
        }
    } else if (site === 'minato') {
        const sessionId = await loginToMinato(credentials.username, credentials.password);
        if (sessionId) {
            const sessionData: SessionData = {
                sessionId: sessionId,
                site,
                loginTime: Date.now(),
                lastUsed: Date.now(),
                isValid: true,
                userId: credentials.username
            };
            await saveSession(site, sessionData, kv);
            return sessionData;
        }
    }

    return null;
}
