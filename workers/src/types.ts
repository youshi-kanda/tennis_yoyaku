
import { KVNamespace, Queue, DurableObjectNamespace, ExecutionContext } from '@cloudflare/workers-types';
import { UserAgent } from './do/UserAgent';

export interface Env {
    USERS: KVNamespace;
    SESSIONS: KVNamespace;
    MONITORING: KVNamespace;
    RESERVATIONS: KVNamespace;
    ENVIRONMENT: string;
    ENCRYPTION_KEY: string;
    JWT_SECRET: string;
    ADMIN_KEY: string;
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
    VAPID_SUBJECT: string;
    VERSION?: string;
    MAINTENANCE_MODE?: string; // メンテナンスモードフラグ: 'true' or 'false'
    MAINTENANCE_MESSAGE?: string; // メンテナンスモード時のメッセージ
    RESERVATION_QUEUE: Queue<ReservationMessage>; // Queue binding
    USER_AGENT: DurableObjectNamespace; // DO binding
}

export { UserAgent };

export interface ReservationMessage {
    target: MonitoringTarget;
    weeklyContext?: any;
}

export interface User {
    id: string;
    email: string;
    password: string;
    role: 'user' | 'admin';
    createdAt: number;
    updatedAt?: number;
}

export interface MonitoringTarget {
    id: string;
    userId: string;
    site: 'shinagawa' | 'minato';
    facilityId: string;
    facilityName: string;
    date: string; // 後方互換性（単一日付）
    dateMode?: 'single' | 'range' | 'continuous'; // 日付モード（新規）
    startDate?: string; // 期間指定開始日（新規）
    endDate?: string; // 期間指定終了日（新規）
    timeSlot: string; // 後方互換性のため残す（非推奨）
    timeSlots?: string[]; // 複数時間帯対応（新規）
    selectedWeekdays?: number[]; // 監視する曜日（0=日, 1=月, ..., 6=土）デフォルトは全曜日
    priority?: number; // 優先度（1-5、5が最優先）デフォルトは3
    includeHolidays?: boolean | 'only'; // 祝日の扱い: true=含める, false=除外, 'only'=祝日のみ
    status: 'active' | 'pending' | 'completed' | 'failed' | 'detected' | 'paused';
    autoReserve: boolean;
    reservationStrategy?: 'all' | 'priority_first'; // 予約戦略: 'all'=全取得, 'priority_first'=優先度1枚のみ（デフォルトは'all'）
    lastCheck?: number;
    lastStatus?: string; // '×' or '○' or '取'
    detectedStatus?: '×' | '取' | '○'; // 検知したステータス（集中監視用）
    intensiveMonitoringUntil?: number; // 集中監視の終了時刻（タイムスタンプ）- 廃止予定
    nextIntensiveCheckTime?: number; // 次の集中監視時刻（10分単位）
    intensiveMonitoringDate?: string; // 集中監視対象の日付
    intensiveMonitoringTimeSlot?: string; // 集中監視対象の時間帯
    applicantCount?: number; // 利用人数（未指定時は品川2人、港4人）
    createdAt: number;
    updatedAt?: number;
    detectedAt?: number; // 空き枠検知時刻
    failedAt?: number; // 予約失敗時刻
    failureReason?: string; // 予約失敗理由
}

export interface UserMonitoringState {
    targets: MonitoringTarget[];
    updatedAt: number;
    version: number; // データバージョン管理
}

export interface TimeRestrictions {
    canLogin: boolean;
    canReserve: boolean;
    shouldResetSession: boolean;
    reason?: string;
}
