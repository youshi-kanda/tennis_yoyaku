export class KVLock {
    private kv: KVNamespace;
    private key: string;
    private lockId: string;
    private ttl: number; // seconds

    constructor(kv: KVNamespace, key: string, ttl: number = 60) {
        this.kv = kv;
        this.key = `lock:${key}`;
        this.lockId = crypto.randomUUID();
        this.ttl = ttl;
    }

    /**
     * 共有ロックを取得する
     * @param retries リトライ回数 (デフォルト: 5)
     * @param retryDelayMs リトライ間隔 (デフォルト: 1000ms)
     * @returns ロック取得に成功した場合はtrue
     */
    async acquire(retries: number = 5, retryDelayMs: number = 1000): Promise<boolean> {
        for (let i = 0; i < retries; i++) {
            // 既存のロックを確認
            const currentLock = await this.kv.get(this.key);

            if (!currentLock) {
                // ロックが存在しない場合、作成を試みる
                // 注意: Cloudflare KVは結果整合性のため、厳密なAtomic操作ではないが、
                // 短時間のロックであれば実用的には十分機能する
                await this.kv.put(this.key, this.lockId, { expirationTtl: this.ttl });

                // 書き込み確認（Double Check）
                const verifyLock = await this.kv.get(this.key);
                if (verifyLock === this.lockId) {
                    // console.log(`[Lock] Acquired: ${this.key} (${this.lockId})`);
                    return true;
                }
            }

            // ロックが取得できなかった場合、待機
            if (i < retries - 1) {
                const jitter = Math.random() * 500;
                await new Promise(resolve => setTimeout(resolve, retryDelayMs + jitter));
            }
        }

        console.warn(`[Lock] Failed to acquire lock: ${this.key}`);
        return false;
    }

    /**
     * ロックを解放する
     */
    async release(): Promise<void> {
        const currentLock = await this.kv.get(this.key);
        if (currentLock === this.lockId) {
            await this.kv.delete(this.key);
            // console.log(`[Lock] Released: ${this.key}`);
        }
    }
}
