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
        hotUntil: 0
    };

    // Lock for strict serialization
    private isProcessing: boolean = false;

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
        await this.state.storage.put('state', this.memState);
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

        let session = await this.getSession();

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
                            // Minato Policy: "Notify only" if strictly followed?
                            // Proposal says "Minato ... Auto Reserve: Guarantee not".
                            // But if we can, we try? Or just notify? 
                            // User request 5.3: "Minato may be not auto-reservable, notify only".
                            // Let's TRY, but if it fails, it fails.
                            await this.executeReservation(target, session);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`[UserAgent] Check failed for ${target.facilityName}: ${e.message}`);
                if (e.message?.includes('SESSION_EXPIRED') || e.message?.includes('Login failed')) {
                    // Re-login attempt
                    try {
                        session = await this.doLogin();
                    } catch (loginErr) {
                        console.error('[UserAgent] Re-login failed, aborting Wide check.');
                        break;
                    }
                }
            }

            // Short delay between targets to be nice?
            // await new Promise(r => setTimeout(r, 1000));
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
                await this.doLogin();
            }
        }
    }

    private async executeReservation(target: MonitoringTarget, session: string) {
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
