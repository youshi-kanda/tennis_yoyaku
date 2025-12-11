
export interface BackoffState {
    failCount: number;
    lastFailure: number; // timestamp
    nextAllowedRetry: number; // timestamp
}

export class SmartBackoff {
    private kv: KVNamespace;
    private prefix: string;

    constructor(kv: KVNamespace, prefix: string = 'backoff:') {
        this.kv = kv;
        this.prefix = prefix;
    }

    /**
     * 失敗を記録し、次の試行可能時間を計算する
     * @param key 識別子 (例: userId:site)
     * @param baseDelayMs 初期待機時間 (デフォルト: 1分)
     * @param maxDelayMs 最大待機時間 (デフォルト: 6時間)
     */
    async recordFailure(key: string, baseDelayMs: number = 60 * 1000, maxDelayMs: number = 6 * 60 * 60 * 1000): Promise<BackoffState> {
        const kvKey = `${this.prefix}${key}`;
        const currentData = await this.kv.get(kvKey);
        let state: BackoffState = currentData ? JSON.parse(currentData) : { failCount: 0, lastFailure: 0, nextAllowedRetry: 0 };

        state.failCount++;
        state.lastFailure = Date.now();

        // 指数バックオフ計算 (base * 2^(failCount-1))
        // 1回目失敗: 1分
        // 2回目失敗: 2分
        // 3回目失敗: 4分
        // 4回目失敗: 8分
        // ...
        const delay = Math.min(baseDelayMs * Math.pow(2, state.failCount - 1), maxDelayMs);

        // Jitter (ゆらぎ) を追加 (±10%) して同時アクセスを回避
        const jitter = delay * 0.1 * (Math.random() * 2 - 1);
        const actualDelay = delay + jitter;

        state.nextAllowedRetry = state.lastFailure + actualDelay;

        // KVに保存 (TTLは最大待機時間の2倍程度あれば十分)
        await this.kv.put(kvKey, JSON.stringify(state), { expirationTtl: Math.ceil(maxDelayMs / 1000) * 2 });

        return state;
    }

    /**
     * 成功を記録（バックオフ状態をリセット）
     */
    async recordSuccess(key: string): Promise<void> {
        const kvKey = `${this.prefix}${key}`;
        await this.kv.delete(kvKey);
    }

    /**
     * 現在リトライ可能かどうかをチェック
     */
    async checkCanRetry(key: string): Promise<{ canRetry: boolean; waitSeconds: number }> {
        const kvKey = `${this.prefix}${key}`;
        const data = await this.kv.get(kvKey);

        if (!data) {
            return { canRetry: true, waitSeconds: 0 };
        }

        const state: BackoffState = JSON.parse(data);
        const now = Date.now();

        if (now >= state.nextAllowedRetry) {
            return { canRetry: true, waitSeconds: 0 };
        }

        const waitSeconds = Math.ceil((state.nextAllowedRetry - now) / 1000);
        return { canRetry: false, waitSeconds };
    }
}
