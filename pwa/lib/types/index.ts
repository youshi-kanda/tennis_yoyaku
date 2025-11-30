// ユーザー関連
export interface User {
  id: string;
  email: string;
  role: 'user' | 'admin';
  createdAt: number;
  settings: UserSettings;
}

export interface UserSettings {
  shinagawa: SiteCredentials;
  minato: SiteCredentials;
  notifications: NotificationSettings;
  monitoring: MonitoringSettings;
}

export interface SiteCredentials {
  username: string;
  password: string;
  facilities: string[];
}

export interface NotificationSettings {
  pushEnabled: boolean;
  types: NotificationType[];
  pushSubscription?: PushSubscriptionJSON;
}

export type NotificationType =
  | 'vacant_detected'      // ×→○検知
  | 'lottery_detected'     // 取→○検知
  | 'reservation_success'  // 予約成功
  | 'reservation_failed'   // 予約失敗
  | 'session_expired';     // セッション期限切れ

export interface MonitoringSettings {
  enabled: boolean;
  autoReserve: boolean;
}

// 監視対象
export interface MonitoringTarget {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlots: string[];
  priority: number;
  
  // 期間モード用
  dateMode?: 'single' | 'range' | 'continuous';
  startDate?: string;
  endDate?: string;
  
  // 曜日指定用
  selectedWeekdays?: number[];
  includeHolidays?: boolean | 'only'; // 祝日の扱い: true=含める, false=除外, 'only'=祝日のみ
  
  autoReserve?: boolean; // 自動予約フラグ
  applicantCount?: number; // 利用人数（未指定時は品川2人、港4人）
  
  status: 'active' | 'paused' | 'monitoring' | 'detected' | 'reserved' | 'failed';
  createdAt: number;
  updatedAt?: number;
  
  // ステータス追跡用
  detectedAt?: number;
  reservedAt?: number;
  failedAt?: number;
  failureReason?: string;
}

// 予約履歴
export interface ReservationRecord {
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facility: string;
  date: string;
  time: string;
  status: 'success' | 'failed';
  timestamp: number;
  error?: string;
}

// セッション
export interface SiteSession {
  jsessionid: string;
  loginTime: number;
  expiresAt: number;
  site: 'shinagawa' | 'minato';
}

// API レスポンス
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface MonitoringStatus {
  isMonitoring: boolean;
  targets: MonitoringTarget[];
  lastCheck: number;
  nextCheck: number;
  sessionsActive: {
    shinagawa: boolean;
    minato: boolean;
  };
}

// 施設情報
export interface Facility {
  id: string;
  name: string;
  site: 'shinagawa' | 'minato';
  type: 'tennis' | 'futsal' | 'other';
  location: string;
}

// 通知
export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  data?: Record<string, unknown>;
}
