import { DurableObject } from 'cloudflare:workers';
import type { Env, MonitoringTarget } from '../index';
import {
    checkShinagawaAvailability,
    loginToShinagawa,
    makeShinagawaReservation,
    SHINAGAWA_SESSION_EXPIRED
} from '../scraper/shinagawa';
import {
    checkMinatoAvailability,
    loginToMinato,
    makeMinatoReservation,
    MINATO_SESSION_EXPIRED_MESSAGE
} from '../scraper/minato';
import { SiteCredentials, Facility } from '../scraper/types';
import { decryptPassword, isEncrypted } from '../crypto';

interface UserAgentState {
    userId: string;
    site: 'shinagawa' | 'minato';
    targets: MonitoringTarget[];
    credentials?: SiteCredentials;
    sessionCookie?: string;
    isHotMonitoring: boolean;
    hotUntil: number;
    hotTargetId?: string;

    // Safety Guards State
    safety: SafetyConfig;
    rateLimitBuckets: Record<string, number>; // epochSec -> count
    breakerOpenUntil: number; // 0 = closed, >0 = open until timestamp
}

export interface SafetyConfig {
    executeReservation: boolean; // Operational switch
    mockRequests: boolean;       // Mock mode
    allowedTargets: AllowedTarget[]; // Whitelist
}

export interface AllowedTarget {
    facilityId: string;
    date: string;
    timeSlot: string;
    expiresAt: number;
}

export class UserAgent extends DurableObject<Env> {
    private state: DurableObjectState;
    env: Env;

    // In-memory state for speed (synced with storage on critical updates)
    private memState: UserAgentState = {
        userId: '',
        site: 'shinagawa', // default
        targets: [],
        isHotMonitoring: false,
        hotUntil: 0,
        safety: {
            executeReservation: false,
            mockRequests: false,
            allowedTargets: []
        },
        rateLimitBuckets: {},
        breakerOpenUntil: 0
    };

    // Lock for strict serialization
    private isProcessing: boolean = false;

    // Reservation Metrics (Task 3: Phase 2)
    private reservationMetrics = {
        confirmPostCount: 0,
        completePostCount: 0,
        lastResetTime: Date.now()
    };

    constructor(state: DurableObjectState, env: Env) {
        super(state, env);
        this.state = state;
        this.env = env;

        // Restore state from storage
        this.state.blockConcurrencyWhile(async () => {
            const stored = await this.state.storage.get<UserAgentState>('state');
            if (stored) {
                this.memState = { ...this.memState, ...stored };
            }
        });
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        try {
            if (path === '/init') {
                return await this.handleInit(request);
            }
            if (path === '/status') {
                return Response.json(this.memState);
            }
            if (path === '/force-check') {
                // Manually trigger a check (Wide)
                await this.checkWide();
                return Response.json({ status: 'ok' });
            }
            if (path === '/safety-config' && request.method === 'POST') {
                const body = await request.json() as Partial<SafetyConfig>;
                if (body.executeReservation !== undefined) this.memState.safety.executeReservation = body.executeReservation;
                if (body.mockRequests !== undefined) this.memState.safety.mockRequests = body.mockRequests;
                // AllowedTargets update? usually we add/remove. For now, full replace or simple add?
                // Let's assume full replacement for debug simplicity or add specific endpoint.
                // For safety, let's just support simple boolean flags switch here for now.
                // Or if body has allowedTargets, replace it.
                if (body.allowedTargets !== undefined) this.memState.safety.allowedTargets = body.allowedTargets;

                await this.saveState();
                return Response.json({ status: 'ok', safety: this.memState.safety });
            }

            return new Response('Not Found', { status: 404 });
        } catch (e: any) {
            console.error(`[UserAgent] Error: ${e.message}`);
            return new Response(e.message, { status: 500 });
        }
    }

    async alarm(): Promise<void> {
        if (this.isProcessing) {
            console.warn('[UserAgent] Alarm skipped (Busy)');
            // Retry soon
            await this.state.storage.setAlarm(Date.now() + 1000);
            return;
        }

        this.isProcessing = true;
        try {
            const now = Date.now();

            if (this.memState.isHotMonitoring) {
                if (now > this.memState.hotUntil) {
                    console.log('[UserAgent] 🔥 Hot Monitoring Finished (Time limit)');
                    this.memState.isHotMonitoring = false;
                    this.memState.hotTargetId = undefined;
                    await this.saveState();
                    // Resume Wide monitoring interval
                    await this.state.storage.setAlarm(Date.now() + 60 * 1000);
                } else {
                    // Execute Hot Check
                    await this.checkHot();
                    // Schedule next burst (1s)
                    await this.state.storage.setAlarm(Date.now() + 1000);
                }
            } else {
                // Wide Monitoring
                await this.checkWide();
                // Schedule next Wide check (1 min)
                await this.state.storage.setAlarm(Date.now() + 60 * 1000);
            }

            // Task 3: Output hourly metrics
            const metricsNow = Date.now();
            if (metricsNow - this.reservationMetrics.lastResetTime > 3600000) { // 1 hour
                console.log(`${this.getLogPrefix()} [Metrics] confirmPOST=${this.reservationMetrics.confirmPostCount} completePOST=${this.reservationMetrics.completePostCount}`);
                this.reservationMetrics = { confirmPostCount: 0, completePostCount: 0, lastResetTime: metricsNow };
            }
        } catch (e) {
            console.error('[UserAgent] Alarm Error:', e);
            // Retry safely in 1 min if error
            await this.state.storage.setAlarm(Date.now() + 60 * 1000);
        } finally {
            this.isProcessing = false;
        }
    }

    // --- Handlers ---

    private async handleInit(request: Request): Promise<Response> {
        const data = await request.json() as {
            userId: string;
            site: 'shinagawa' | 'minato';
            targets: MonitoringTarget[];
            credentials: SiteCredentials;
        };

        this.memState.userId = data.userId;
        this.memState.site = data.site;
        this.memState.targets = data.targets;
        this.memState.credentials = data.credentials;

        // Decrypt password if needed for immediate use? 
        // We acturally store credentials as is (encrypted) and decrypt when using.
        // Wait, for DO, it's better to keep them memory-safe. 
        // If passed encrypted from Worker, store encrypted.

        await this.saveState();

        // Start Alarm if active targets exist
        const hasActive = this.memState.targets.some(t => t.status === 'active');
        if (hasActive) {
            const currentAlarm = await this.state.storage.getAlarm();
            if (!currentAlarm) {
                await this.state.storage.setAlarm(Date.now() + 1000); // Start immediately
            }
        } else {
            await this.state.storage.deleteAlarm();
        }

        return Response.json({ status: 'ok', id: this.state.id.toString() });
    }

    private async saveState() {
        // Clean up expired buckets and allowedTargets before saving
        const now = Date.now();
        const currentSec = Math.floor(now / 1000).toString();

        // Rolling Window Cleanup (keep only last 60s)
        const keptBuckets: Record<string, number> = {};
        for (let i = 0; i < 60; i++) {
            const sec = (Math.floor(now / 1000) - i).toString();
            if (this.memState.rateLimitBuckets[sec]) {
                keptBuckets[sec] = this.memState.rateLimitBuckets[sec];
            }
        }
        this.memState.rateLimitBuckets = keptBuckets;

        // Cleanup expired allow list
        this.memState.safety.allowedTargets = this.memState.safety.allowedTargets.filter(t => t.expiresAt > now);

        await this.state.storage.put('state', this.memState);
    }

    // --- Safety Guards ---

    /**
     * SafeFetch Wrapper
     * Implements: Rate Limit, Circuit Breaker, Mocking, Block List
     */
    private async safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
        const now = Date.now();

        // 1. Circuit Breaker Check
        if (this.memState.breakerOpenUntil > now) {
            console.warn(`[SafeFetch] 🛡️ Circuit Breaker OPEN (Until ${new Date(this.memState.breakerOpenUntil).toISOString()})`);
            throw new Error('Circuit Breaker OPEN: Network blocked due to rate limit');
        } else if (this.memState.breakerOpenUntil > 0) {
            // Auto Close
            console.log('[SafeFetch] 🛡️ Circuit Breaker CLOSED (Recovery)');
            this.memState.breakerOpenUntil = 0;
            await this.saveState();
        }

        // 2. Rate Limiting (Rolling Window)
        const currentSec = Math.floor(now / 1000).toString();
        this.memState.rateLimitBuckets[currentSec] = (this.memState.rateLimitBuckets[currentSec] || 0) + 1;

        let totalReqs = 0;
        for (let i = 0; i < 60; i++) {
            const sec = (Math.floor(now / 1000) - i).toString();
            totalReqs += (this.memState.rateLimitBuckets[sec] || 0);
        }

        if (totalReqs > 60) {
            console.error(`[SafeFetch] 🚨 Rate Limit Exceeded (${totalReqs}/60s). Opening Circuit Breaker.`);
            this.memState.breakerOpenUntil = now + 5 * 60 * 1000; // 5 min cooldown
            await this.saveState();
            throw new Error('Rate Limit Exceeded: Circuit Breaker Opened');
        }

        // 3. Absolute Guard for Reservation POSTs
        const urlStr = input.toString();
        // Check strict reservation endpoints
        const isReservationAction = urlStr.includes('ReservedCompleteAction.do') || urlStr.includes('ReservedConfirmAction.do');

        // Task 3: Track reservation POST metrics
        if (urlStr.includes('ReservedConfirmAction')) this.reservationMetrics.confirmPostCount++;
        if (urlStr.includes('ReservedCompleteAction')) this.reservationMetrics.completePostCount++;

        if (isReservationAction) {
            // a. ENV Lock
            // Note: In Cloudflare Workers, environmental variables are accessed via `this.env`.
            // User confirmed "EXECUTE_RESERVATION" env var.
            const envAllowed = (this.env as any).EXECUTE_RESERVATION === 'true';

            // b. State Lock
            const stateAllowed = this.memState.safety.executeReservation;

            if (!envAllowed || !stateAllowed) {
                console.warn(`[SafeFetch] 🛡️ BLOCKED Reservation POST (Env=${envAllowed}, State=${stateAllowed})`);
                throw new Error('SAFETY_BLOCK: Reservation not allowed by configuration');
            }
        }

        // 4. Mock Control
        if (this.memState.safety.mockRequests) {
            console.log(`[SafeFetch] 🎭 MOCK Request: ${urlStr}`);

            // Context-Aware Mock Responses
            let mockBody = '<html><body>Mock Response</body></html>';
            if (urlStr.includes('login') || urlStr.includes('Login')) {
                // Return login-like form to prevent scraper crash
                mockBody = '<html><body><form name="loginForm"></form>Success</body></html>';
            } else if (urlStr.includes('InstSrchVacant')) {
                // Return "No Availability" to be safe
                mockBody = '<html><body><!-- No available cells --></body></html>';
            }

            return new Response(mockBody, {
                status: 200,
                headers: { 'Content-Type': 'text/html; charset=Shift_JIS' }
            });
        }

        // 5. Real Request (Using ORIGINAL global fetch if needed, but here we call super fetch? No, global fetch)
        // Since we replaced globalThis.fetch with this function, we must ensure we don't recurse infinitely.
        // The pattern used in execute/check methods is:
        // const original = globalThis.fetch; globalThis.fetch = safeFetch; ... globalThis.fetch = original;
        // So here, we cannot call globalThis.fetch because it points to US!
        // We need 'originalFetch' to be accessible or passed.
        // OR, we rely on the fact that `UserAgent` extends `DurableObject`? No.

        // Correction: The plan says "const originalFetch = globalThis.fetch; ... finally ...".
        // BUT inside `safeFetch`, we need to call the REAL fetch.
        // Since `safeFetch` is a method, it doesn't know `originalFetch` unless we store it or pass it.
        // BETTER APPROACH: Store originalFetch in a static or instance variable when swapping?
        // OR: Just use `super.fetch`? No, DO fetch handler is different.

        // Solution: We will assume `this.originalFetch` is set before swapping, or we pass it?
        // Actually, the cleanest way in single-threaded JS is to have `private originalFetch?: typeof fetch`.

        if (this.originalFetcher) {
            return this.originalFetcher(input, init);
        }

        // Fallback if not set (should not happen if used correctly)
        // Check if globalThis.fetch is NOT this function to avoid recursion
        if (globalThis.fetch !== this.safeFetch.bind(this)) {
            return globalThis.fetch(input, init);
        }

        throw new Error('SafeFetch: Original fetcher not available');
    }

    private originalFetcher?: typeof fetch;

    // Helper: Log Prefix (Task 2: Phase 2)
    private getLogPrefix(): string {
        return `[UserAgent:${this.memState.userId}:${this.memState.site}]`;
    }


    // --- Logic ---

    private async getSession(): Promise<string> {
        if (this.memState.sessionCookie) {
            // Validate expiration? 
            // For now, assume valid. If fails, we catch error and re-login.
            return this.memState.sessionCookie;
        }
        return await this.doLogin();
    }

    private async doLogin(): Promise<string> {
        if (!this.memState.credentials) throw new Error('No credentials');

        console.log(`[UserAgent:${this.memState.site}] Logging in...`);
        let password = this.memState.credentials.password;
        if (isEncrypted(password)) {
            password = await decryptPassword(password, this.env.ENCRYPTION_KEY);
        }

        let cookie: string | null = null;
        if (this.memState.site === 'shinagawa') {
            const session = await loginToShinagawa(this.memState.credentials.username, password);
            cookie = session?.cookie || null;
        } else {
            // Minato: Manual only policy?
            // If we really want to separate logic, for Minato we might just skip login
            // OR allow login if NO reCAPTCHA is active (unlikely).
            // Proposal says: "Minato ... reCAPTCHA ... stop or notify".
            // We can TRY login, if fail due to captcha, we stop.
            // Minato scraper loginToMinato handles normal login.
            cookie = await loginToMinato(this.memState.credentials.username, password);
        }

        if (!cookie) {
            throw new Error('Login failed');
        }

        this.memState.sessionCookie = cookie;
        await this.saveState();
        return cookie;
    }

    private async checkWide() {
        console.log(`[UserAgent:${this.memState.site}] 🌍 Check Wide (${this.memState.targets.length} targets)`);

        // Filter active targets
        const activeTargets = this.memState.targets.filter(t => t.status === 'active');
        if (activeTargets.length === 0) return;


        // Inject SafeFetch
        this.originalFetcher = globalThis.fetch;
        globalThis.fetch = this.safeFetch.bind(this);

        let session: string;

        try {
            session = await this.getSession();

            for (const target of activeTargets) {
                // Strict Serialization: 1 target at a time
                try {
                    if (this.memState.site === 'shinagawa') {
                        // Check Logic
                        const result = await checkShinagawaAvailability(
                            target.facilityId, target.date, target.timeSlot,
                            this.memState.credentials!, undefined,
                            { cookie: session } as any // ShinagawaSession mock
                        );

                        if (result.available) {
                            if (result.currentStatus === '取') {
                                // 🔥 Signal Detected!
                                console.log(`[UserAgent] 🔥 Signal '取' detected! Switching to HOT.`);
                                this.memState.isHotMonitoring = true;
                                this.memState.hotTargetId = target.id;
                                this.memState.hotUntil = Date.now() + 15000; // 15s burst
                                await this.saveState();

                                // Trigger Hot immediately
                                await this.checkHot();
                                return; // Exit Wide loop to prioritize Hot
                            } else if (result.currentStatus === '○') {
                                // Available -> Reserve
                                if (target.autoReserve) {
                                    await this.executeReservation(target, session);
                                } else {
                                    // Notify user
                                    console.log('[UserAgent] Notify: Available but autoReserve=false');
                                }
                            }
                        }

                    } else {
                        // Minato
                        const result = await checkMinatoAvailability(
                            target.facilityId, target.date, target.timeSlot,
                            this.memState.credentials!, undefined, session
                        );

                        if (result.available) {
                            if (target.autoReserve) {
                                await this.executeReservation(target, session);
                            }
                        }
                    }
                } catch (e: any) {
                    console.warn(`[UserAgent] Check failed for ${target.facilityName}: ${e.message}`);
                    if (e.message?.includes('SESSION_EXPIRED') || e.message?.includes('Login failed')) {
                        // Re-login attempt (Recursion warning? doLogin uses fetch too! Need to ensure doLogin uses safeFetch or original?)
                        // Since globalThis is swapped, doLogin WILL use safeFetch. Secure.
                        try {
                            // Temporarily restore original for login if we consider login "safe" or part of flow?
                            // No, all network should go through SafeFetch for Rate Limit.
                            session = await this.doLogin();
                        } catch (loginErr) {
                            console.error('[UserAgent] Re-login failed, aborting Wide check.');
                            break;
                        }
                    } else if (e.message?.includes('Circuit Breaker')) {
                        throw e; // Stop everything
                    }
                }
            }
        } finally {
            // Restore Fetch
            if (this.originalFetcher) {
                globalThis.fetch = this.originalFetcher;
                this.originalFetcher = undefined;
            }
        }
    }

    private async checkHot() {
        // Hot monitoring focuses on SINGLE target
        const target = this.memState.targets.find(t => t.id === this.memState.hotTargetId);
        if (!target) {
            this.memState.isHotMonitoring = false;
            return;
        }

        console.log(`[UserAgent] 🔥 Hot Check for ${target.facilityName} ${target.timeSlot}`);

        try {
            // Inject SafeFetch
            this.originalFetcher = globalThis.fetch;
            globalThis.fetch = this.safeFetch.bind(this);

            let session = await this.getSession();
            // Shinagawa Only logic usually
            if (this.memState.site === 'shinagawa') {
                const result = await checkShinagawaAvailability(
                    target.facilityId, target.date, target.timeSlot,
                    this.memState.credentials!, undefined,
                    { cookie: session } as any
                );

                if (result.available && (result.currentStatus === '○' || result.currentStatus === '△')) {
                    console.log('[UserAgent] 🔥 Hot Hit! Booking...');
                    await this.executeReservation(target, session);
                    // Stop Hot
                    this.memState.isHotMonitoring = false;
                    this.memState.hotTargetId = undefined;
                    await this.saveState();
                }
            }
        } catch (e: any) {
            console.error(`[UserAgent] Hot check error: ${e.message}`);
            // If session expired, we might lose the chance, but try re-login fast
            if (e.message?.includes('SESSION_EXPIRED')) {
                try { await this.doLogin(); } catch { }
            }
        } finally {
            // Restore
            if (this.originalFetcher) {
                globalThis.fetch = this.originalFetcher;
                this.originalFetcher = undefined;
            }
        }
    }

    private async executeReservation(target: MonitoringTarget, session: string) {
        // 3. AllowedTargets Whitelist Check
        const isAllowed = this.memState.safety.allowedTargets.some(t =>
            t.facilityId === target.facilityId &&
            t.date === target.date &&
            t.timeSlot === target.timeSlot
        );

        if (!isAllowed) {
            console.warn(`[UserAgent] 🛡️ BLOCKED: Target not in allowedTargets whitelist (${target.facilityName} ${target.date})`);
            return;
        }

        console.log(`[UserAgent] 🚀 Executing Reservation for ${target.facilityName}`);

        try {
            if (this.memState.site === 'shinagawa') {
                const result = await makeShinagawaReservation(
                    target.facilityId, target.date, target.timeSlot,
                    { cookie: session } as any,
                    { applicantCount: target.applicantCount },
                    undefined, // weeklyContext
                    false // dryRun
                );
                if (result.success) {
                    console.log('[UserAgent] ✅ Reservation Success!');
                    // Update target status, notify...
                    // For now, log. We should probably callback to Worker or update KV.
                } else {
                    console.error(`[UserAgent] ❌ Reservation Failed: ${result.message}`);
                }
            } else {
                const result = await makeMinatoReservation(
                    target.facilityId, target.date, target.timeSlot,
                    session,
                    { applicantCount: target.applicantCount },
                    false
                );
                if (result.success) {
                    console.log('[UserAgent] ✅ Minato Reservation Success!');
                } else {
                    console.error(`[UserAgent] ❌ Minato Reservation Failed: ${result.error}`);
                }
            }
        } catch (e) {
            console.error('[UserAgent] Reservation Exception:', e);
        }
    }
}
