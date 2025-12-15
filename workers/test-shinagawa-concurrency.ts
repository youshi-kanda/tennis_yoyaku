
import { KVLock } from './src/lib/kvLock';
import { SmartBackoff } from './src/lib/backoff';
import * as assert from 'assert';

// --- Mocks ---

class MockKV {
    private store = new Map<string, any>();
    async get(key: string, type?: 'json') {
        const val = this.store.get(key);
        if (!val) return null;
        if (typeof val === 'object' && type !== 'json') return JSON.stringify(val);
        // Emulate expiration logic? Not strictly needed for this test if we control time
        return val;
    }
    async put(key: string, val: any) { this.store.set(key, val); }
    async delete(key: string) { this.store.delete(key); }
}

const mockEnv: any = {
    SESSIONS: new MockKV(),
    ENCRYPTION_KEY: 'test-key'
};

// Mock Login Function (Global counter to verify call count)
let loginCallCount = 0;
async function mockLoginToShinagawa() {
    console.log(`[MockLogin] Starting login process... (Count: ${loginCallCount + 1})`);
    loginCallCount++;
    await new Promise(r => setTimeout(r, 1000)); // Simulate 1s network delay
    console.log(`[MockLogin] Login finished.`);
    return { cookie: `JSESSIONID=new_session_${Date.now()}` };
}

// Copy-paste SafeSessionWrapper (modified version) for testing
// In a real project, we would export it or use a proper test runner adjustments,
// but for this ad-hoc script, we inject the logic to verify the *algorithm*.

class SafeSessionWrapper {
    private env: any;
    private userId: string;
    private site: 'shinagawa' | 'minato';

    constructor(env: any, userId: string, site: 'shinagawa' | 'minato') {
        this.env = env;
        this.userId = userId;
        this.site = site;
    }

    async getSession(forceRefresh = false): Promise<string> {
        const sessionKey = `session:${this.userId}:${this.site}`;

        if (!forceRefresh) {
            const cached = await this.env.SESSIONS.get(sessionKey);
            if (cached) {
                const data = JSON.parse(cached);
                if (data.sessionId && (Date.now() - (data.lastUsed || 0) < 30 * 60 * 1000)) {
                    return data.sessionId;
                }
            }
        }

        return await this.runWithLock(`login:${this.userId}:${this.site}`, async () => {
            // Double Check Logic (The Critical Fix)
            const doubleCheck = await this.env.SESSIONS.get(sessionKey);
            if (doubleCheck) {
                const data = JSON.parse(doubleCheck);
                const now = Date.now();
                const age = now - (data.lastUsed || 0);

                if (!forceRefresh && data.sessionId && age < 30 * 60 * 1000) {
                    console.log(`[SafeSession] Reuse (Standard)`);
                    return data.sessionId;
                }

                // The Fix: Use fresh session even on forceRefresh
                if (forceRefresh && data.sessionId && age < 60 * 1000) {
                    console.log(`[SafeSession] Reuse (ForceRefresh but Fresh)`);
                    return data.sessionId;
                }
            }

            console.log(`[SafeSession] Login required (Force: ${forceRefresh})`);
            const session = await mockLoginToShinagawa();

            const sessionData = {
                sessionId: session.cookie,
                lastUsed: Date.now()
            };
            await this.env.SESSIONS.put(sessionKey, JSON.stringify(sessionData));
            return session.cookie;
        });
    }

    async runWithLock<T>(key: string, task: () => Promise<T>): Promise<T> {
        // Simple InMemory Lock for simulation
        // In real code this uses KVLock
        // We simulate lock contention by checking a global Map
        // But since this is a single process node script, we can use a mutex simulation
        // Actually we want to simulate async interleaving.

        const lockKey = `lock:${key}`;
        while (globalLockMap.has(lockKey)) {
            await new Promise(r => setTimeout(r, 50));
        }
        globalLockMap.set(lockKey, true);
        try {
            return await task();
        } finally {
            globalLockMap.delete(lockKey);
        }
    }
}
const globalLockMap = new Map<string, boolean>();


async function runTest() {
    console.log('=== Starting Concurrency Test ===');
    const userIds = ['user1'];

    // Scenario: Expired Session. 5 workers try to "Force Refresh" simultaneously.
    // This simulates the behavior in checkAndNotify when SHINAGAWA_SESSION_EXPIRED is caught.

    // 1. Setup expired session
    await mockEnv.SESSIONS.put('session:user1:shinagawa', JSON.stringify({
        sessionId: 'old_session',
        lastUsed: Date.now() - 1000 * 60 * 60 // 1 hour old
    }));

    loginCallCount = 0;
    const workers = [];
    const numWorkers = 5;

    console.log(`Simulating ${numWorkers} concurrent workers triggering Force Refresh...`);

    for (let i = 0; i < numWorkers; i++) {
        workers.push((async () => {
            const wrapper = new SafeSessionWrapper(mockEnv, 'user1', 'shinagawa');
            // Simulate checkAndNotify catching error and calling getSession(true)
            const sid = await wrapper.getSession(true);
            console.log(`Worker ${i} got session: ${sid}`);
            return sid;
        })());
    }

    const results = await Promise.all(workers);

    console.log('=== Test Results ===');
    console.log(`Total Login Calls: ${loginCallCount}`);

    if (loginCallCount === 1) {
        console.log('✅ SUCCESS: Login called exactly once.');
    } else {
        console.error(`❌ FAILURE: Login called ${loginCallCount} times. Should be 1.`);
        process.exit(1);
    }

    // Verify all workers got the same session?
    const firstSid = results[0];
    const allSame = results.every(s => s === firstSid);
    if (results.length === numWorkers && allSame) {
        console.log('✅ SUCCESS: All workers received the same session ID.');
    } else {
        console.error('❌ FAILURE: Session ID mismatch.');
        console.log(results);
    }
}

runTest();
