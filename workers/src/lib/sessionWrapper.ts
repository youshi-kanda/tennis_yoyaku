
import { Env } from '../types';
import { KVLock } from './kvLock';
import { SessionData, ShinagawaSession } from '../scraper/types';
import { loginToShinagawa } from '../scraper/shinagawa';
import { isEncrypted, decryptPassword } from '../crypto';

export async function runWithLock<T>(env: Env, key: string, task: () => Promise<T>): Promise<T> {
    const lock = new KVLock(env.SESSIONS, `lock:${key}`, 60); // 60s TTL
    if (await lock.acquire()) {
        try {
            return await task();
        } finally {
            await lock.release();
        }
    } else {
        console.warn(`[Lock] Could not acquire lock for ${key}, skipping task.`);
        throw new Error(`Could not acquire lock for ${key}`);
    }
}

export class SafeSessionWrapper {
    private env: Env;
    private userId: string;
    private site: 'shinagawa' | 'minato';

    constructor(env: Env, userId: string, site: 'shinagawa' | 'minato') {
        this.env = env;
        this.userId = userId;
        this.site = site;
    }

    async getSession(forceRefresh = false): Promise<string> {
        const sessionKey = `session:${this.userId}:${this.site}`;

        // 1. Check Memory/KV Cache
        if (!forceRefresh) {
            const cached = await this.env.SESSIONS.get(sessionKey);
            if (cached) {
                const data = JSON.parse(cached);
                if (data.sessionId && (Date.now() - (data.lastUsed || 0) < 30 * 60 * 1000)) {
                    return data.sessionId;
                }
            }
        }

        // 2. Refresh with Lock
        return await runWithLock(this.env, `login:${this.userId}:${this.site}`, async () => {
            // Double check inside lock
            const doubleCheck = await this.env.SESSIONS.get(sessionKey);
            if (doubleCheck) {
                const data = JSON.parse(doubleCheck);
                const now = Date.now();
                const age = now - (data.lastUsed || 0);

                if (!forceRefresh && data.sessionId && age < 30 * 60 * 1000) {
                    return data.sessionId;
                }

                if (forceRefresh && data.sessionId && age < 60 * 1000) {
                    console.log(`[SafeSession] ⚡️ Fresh session found (${Math.floor(age / 1000)}s ago), skipping login.`);
                    return data.sessionId;
                }
            }

            console.log(`[SafeSession] 🔄 Logging in for ${this.userId} (${this.site})...`);

            const settingsData = await this.env.USERS.get(`settings:${this.userId}`);
            if (!settingsData) throw new Error('User settings not found');
            const settings = JSON.parse(settingsData);
            const creds = settings[this.site];
            if (!creds || !creds.username || !creds.password) throw new Error('Credentials missing');

            let password = creds.password;
            if (isEncrypted(password)) {
                password = await decryptPassword(password, this.env.ENCRYPTION_KEY);
            }

            let session;
            if (this.site === 'shinagawa') {
                session = await loginToShinagawa(creds.username, password);
            } else {
                console.warn(`[SafeSession] Minato requires manual login. Skipping auto-login.`);
                throw new Error('MINATO_LOGIN_REQUIRED');
            }

            if (!session || !session.cookie) {
                throw new Error('Login failed (Account might be locked or credentials invalid)');
            }

            const sessionData: SessionData = {
                sessionId: session.cookie,
                site: this.site,
                loginTime: Date.now(),
                lastUsed: Date.now(),
                isValid: true,
                userId: this.userId,
                shinagawaContext: (this.site === 'shinagawa') ? (session as ShinagawaSession) : undefined
            };
            await this.env.SESSIONS.put(sessionKey, JSON.stringify(sessionData), { expirationTtl: 86400 });
            console.log(`[SafeSession] ✅ Login success for ${this.userId}`);
            return session.cookie;
        });
    }
}
