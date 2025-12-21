
// ===== 深夜早朝時間帯判定（品川区の制約） =====

export interface TimeRestrictions {
    canLogin: boolean;
    canReserve: boolean;
    shouldResetSession: boolean;
    reason?: string;
}

/**
 * 品川区の深夜早朝時間帯制約をチェック
 * @param now 現在時刻（UTC）
 * @returns 時間帯制約情報
 */
export function checkTimeRestrictions(now: Date = new Date()): TimeRestrictions {
    // JSTに変換（UTC+9）
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const hour = jstNow.getUTCHours();
    const minute = jstNow.getUTCMinutes();

    // 0:00 - 0:10 はシステムメンテナンスでアクセス不可
    // 実際は 23:55頃から不安定になるため、余裕を持って判定
    // Cloudflare WorkersはUTC動作なので、JST 0:00 = UTC 15:00 (前日)
    if (hour === 0 && minute < 15) {
        return {
            canLogin: false,
            canReserve: false,
            shouldResetSession: true,
            reason: 'System Maintenance (0:00-0:15)',
        };
    }

    // 3:00 - 5:00 はログイン不可（品川区の仕様）
    // セッション有効期限も切れるため、この時間帯にリセット推奨
    if (hour >= 3 && hour < 5) {
        return {
            canLogin: false,
            canReserve: false,
            shouldResetSession: true,
            reason: 'Night Restriction (3:00-5:00)',
        };
    }

    // 予約開始直前（8:30-9:00等）はログイン殺到するため、
    // 既存セッションがある場合は再利用を優先
    // ここでは判定のみ返す（呼び出し元で制御）

    return {
        canLogin: true,
        canReserve: true,
        shouldResetSession: false,
    };
}
