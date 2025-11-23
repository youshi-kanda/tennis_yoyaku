// 予約システムの設定定数

/**
 * 各自治体の予約可能期間（デフォルト値）
 * 動的取得に失敗した場合のフォールバックとして使用
 */
export const RESERVATION_RULES = {
  shinagawa: {
    maxDaysAhead: 90, // 3ヶ月先まで（デフォルト）
    displayText: '3ヶ月先まで',
    name: '品川区',
  },
  minato: {
    maxDaysAhead: 90, // 3ヶ月先まで（デフォルト）
    displayText: '3ヶ月先まで',
    name: '港区',
  },
} as const;

export type SiteType = keyof typeof RESERVATION_RULES;

/**
 * 時間帯の定義
 */
export const TIME_SLOTS = [
  { id: '09:00-11:00', label: '09:00-11:00（午前早め）' },
  { id: '11:00-13:00', label: '11:00-13:00（午前遅め）' },
  { id: '13:00-15:00', label: '13:00-15:00（午後早め）' },
  { id: '15:00-17:00', label: '15:00-17:00（午後遅め）' },
  { id: '17:00-19:00', label: '17:00-19:00（夕方）' },
  { id: '19:00-21:00', label: '19:00-21:00（夜間）' },
] as const;

/**
 * 曜日の定義
 */
export const WEEKDAYS = [
  { id: 0, label: '日', fullLabel: '日曜日' },
  { id: 1, label: '月', fullLabel: '月曜日' },
  { id: 2, label: '火', fullLabel: '火曜日' },
  { id: 3, label: '水', fullLabel: '水曜日' },
  { id: 4, label: '木', fullLabel: '木曜日' },
  { id: 5, label: '金', fullLabel: '金曜日' },
  { id: 6, label: '土', fullLabel: '土曜日' },
] as const;
