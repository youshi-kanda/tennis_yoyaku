// 共通型定義

export interface SiteCredentials {
    username: string;
    password: string;
}

export interface AvailabilityResult {
    available: boolean;
    facilityId: string;
    facilityName: string;
    date: string;
    timeSlot: string;
    previousStatus?: string;
    currentStatus: string;
    changedToAvailable: boolean;
}

/**
 * 予約に必要なコンテキスト情報（週間カレンダーから抽出）
 */
export interface ReservationContext {
    selectBldCd?: string;      // 建物コード
    selectBldName?: string;    // 建物名
    selectInstCd?: string;     // 施設コード
    selectInstName?: string;   // 施設名
    selectPpsClsCd?: string;   // 目的分類コード
    selectPpsCd?: string;      // 目的コード
    viewDays?: string[];       // 7日分の日付（viewDay1〜viewDay7）
    displayNo?: string;        // 画面ID
    [key: string]: any;        // その他のフォームフィールド
}

/**
 * 週単位の空き状況結果
 * キー: "YYYY-MM-DD_HH:MM" 形式（例: "2026-01-14_09:00"）
 * 値: ステータス（"○", "×", "取", "△", "受付期間外"）
 */
export interface WeeklyAvailabilityResult {
    facilityId: string;
    facilityName: string;
    weekStartDate: string;  // 週の開始日（検索基準日）
    availability: Map<string, string>;  // "YYYY-MM-DD_HH:MM" -> status
    fetchedAt: number;
    reservationContext?: ReservationContext;  // 予約に必要なコンテキスト情報
}

export interface SessionData {
    sessionId: string;
    site: 'shinagawa' | 'minato';
    loginTime: number;
    lastUsed: number;
    isValid: boolean;
    userId: string;
    shinagawaContext?: ShinagawaSession;
}

export interface Facility {
    facilityId: string;
    facilityName: string;
    category: string;
    isTennisCourt: boolean;
    buildingId?: string;  // 館ID (例: "1010")
    buildingName?: string; // 館名 (例: "しながわ中央公園")
    areaCode?: string;     // 地区コード (例: "1400")
    areaName?: string;     // 地区名 (例: "品川地区")
    site?: 'shinagawa' | 'minato';  // 自治体
    availableTimeSlots?: string[];  // 利用可能時間帯 (例: ["09:00", "11:00", "13:00"])
}

export interface ReservationHistory {
    id: string;
    userId: string;
    targetId: string;
    site: 'shinagawa' | 'minato';
    facilityId: string;
    facilityName: string;
    date: string;
    timeSlot: string;
    status: 'success' | 'failed' | 'cancelled';
    message?: string;
    createdAt: number;
}

/**
 * 品川区サイトにログインしてセッションを確立
 */
export interface ShinagawaSession {
    cookie: string;
    loginJKey: string;
    displayNo: string;
    errorParams: Record<string, string>;
    searchFormParams?: Record<string, string>; // 検索フォーム（rsvWOpeInstSrchVacantAction.do）の初期値
}
