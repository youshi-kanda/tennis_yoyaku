# 品川区・港区テニスコート自動予約システム - 最終仕様書

**作成日**: 2025年11月20日  
**バージョン**: 1.0.0  
**実装形態**: PWA (Progressive Web App)

---

## 📋 目次

1. [システム概要](#システム概要)
2. [技術スタック](#技術スタック)
3. [機能仕様](#機能仕様)
4. [アーキテクチャ](#アーキテクチャ)
5. [監視戦略](#監視戦略)
6. [セッション管理](#セッション管理)
7. [PWA要件](#pwa要件)
8. [API仕様](#api仕様)
9. [データモデル](#データモデル)
10. [セキュリティ](#セキュリティ)
11. [運用コスト](#運用コスト)

---

## システム概要

### 目的
品川区・港区の施設予約システムを24時間監視し、空き枠が出た瞬間に自動予約するPWAアプリケーション。

### 対象システム
- **品川区**: https://www.cm9.eprs.jp/shinagawa/web/
- **港区**: https://web101.rsv.ws-scs.jp/web/minato/

### 主要機能
1. **通常監視（×→○）**: 60秒間隔で空き状況監視
2. **集中監視（取→○）**: 10秒間隔で抽選結果監視（品川区のみ）
3. **24時間対応**: セッション管理で深夜も監視継続
4. **PWA**: スマホにインストール、プッシュ通知対応
5. **自動予約**: 空き検知後、即座に予約実行

---

## 技術スタック

### フロントエンド (PWA)
```json
{
  "framework": "Next.js 14 (App Router)",
  "language": "TypeScript 5.x",
  "styling": "Tailwind CSS 3.x",
  "ui": "shadcn/ui + Radix UI",
  "pwa": "next-pwa",
  "state": "Zustand + React Query",
  "notification": "Web Push API",
  "offline": "Service Worker + IndexedDB"
}
```

### バックエンド
```json
{
  "main": "Cloudflare Workers",
  "framework": "Hono",
  "intensive": "AWS Lambda (Node.js 20.x)",
  "storage": "Workers KV",
  "scheduler": "AWS EventBridge",
  "scraping": "cheerio + iconv-lite"
}
```

### インフラ
```json
{
  "hosting": "Cloudflare Pages",
  "cdn": "Cloudflare CDN",
  "dns": "Cloudflare DNS",
  "monitoring": "CloudWatch + Workers Analytics",
  "iac": "Terraform (optional)"
}
```

---

## 機能仕様

### 1. ユーザー認証
- メール/パスワード認証
- JWT トークン管理
- Workers KV でユーザー情報保存

### 2. 施設予約システム認証
- 品川区・港区それぞれのログイン情報保存（暗号化）
- セッション自動管理
- 5:00自動ログイン、24時間維持、3:15リセット対応

### 3. 監視機能

#### 通常監視（×→○）
- **間隔**: 60秒
- **対象**: 全施設
- **動作**: Cloudflare Workers Cron Trigger
- **成功率**: 70%

#### 集中監視（取→○）
- **間隔**: 10秒
- **対象**: 品川区の「取」ステータス施設
- **動作**: AWS Lambda + EventBridge
- **トリガー**: 毎時0分、10分、20分、30分、40分、50分の50秒
- **成功率**: 85%

### 4. 自動予約

#### 品川区（5段階フロー）
1. 空き検索
2. 仮予約
3. 予約内容確認
4. 予約確定
5. 完了画面

#### 港区（シンプルフロー）
1. 空き検索
2. 予約確定
3. 完了画面

### 5. PWA機能
- ホーム画面インストール
- オフライン動作
- プッシュ通知
- バックグラウンド同期

### 6. 通知機能
- ×→○検知
- 取→○検知
- 予約成功
- 予約失敗
- セッション期限切れ
- エラー発生

---

## アーキテクチャ

### システム構成図

```
┌─────────────────────────────────────────────────────┐
│                    ユーザー（スマホ）                    │
│                                                       │
│  ┌─────────────────────────────────────────────┐   │
│  │           PWA (Next.js App)                  │   │
│  │  - ダッシュボード                               │   │
│  │  - 設定画面                                    │   │
│  │  - 履歴表示                                    │   │
│  │  - Service Worker                            │   │
│  └──────────────┬──────────────────────────────┘   │
│                 │ HTTPS                             │
└─────────────────┼─────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│          Cloudflare Pages (PWAホスティング)           │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│        Cloudflare Workers (APIエンドポイント)         │
│  - 認証API                                           │
│  - 監視API                                           │
│  - 設定API                                           │
│  - 通常監視Cron (60秒)                               │
│  - セッション管理                                     │
└─────────────┬───────────────────┬───────────────────┘
              │                   │
              │                   │ Cloudflare API
              ▼                   ▼
┌─────────────────────┐  ┌─────────────────────────┐
│   Workers KV        │  │   AWS Lambda            │
│  - ユーザー情報      │  │  - 集中監視 (10秒)       │
│  - セッション        │  │  - 5:00特別対応          │
│  - 監視対象          │  │                         │
│  - 待機予約          │  │  EventBridge Trigger    │
│  - 履歴             │  │  - 10分ごと              │
└─────────────────────┘  └────────┬────────────────┘
                                  │
              ┌───────────────────┴───────────────────┐
              │                                       │
              ▼                                       ▼
┌──────────────────────────┐      ┌──────────────────────────┐
│  品川区予約システム         │      │  港区予約システム           │
│  cm9.eprs.jp             │      │  web101.rsv.ws-scs.jp    │
│  - ログイン               │      │  - ログイン                │
│  - 空き検索               │      │  - 空き検索                │
│  - 予約実行 (5段階)       │      │  - 予約実行                │
└──────────────────────────┘      └──────────────────────────┘
```

---

## 監視戦略

### 24時間監視フロー

```
00:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │ 深夜監視（セッション維持試行）
      │ - セッションあり → 即座に予約可能
      │ - セッションなし → 監視のみ、5:00まで待機
      │
03:15 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │ システムリセット（強制ログアウト）
      │ 監視継続、予約はKVに保存
      │
05:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │ ★最重要★ 5:00:00に自動ログイン
      │ 4:59:58にLambdaトリガー
      │ → 待機中の予約を優先順に実行
      │ → 通常監視開始
      │
10:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │ 「取→○」集中監視（10秒間隔）
      │ Lambda: 10:09:50 → 10:10:20をカバー
      │
24:00 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      │ ログイン不可、セッション維持継続
```

### 監視間隔の選定理由

#### 通常監視: 60秒
- Cloudflare Workers Cron の最小間隔
- 成功率70%で十分
- コスト無料

#### 集中監視: 10秒
- バッチ更新の3〜4秒ズレを吸収
- 成功率85%（1秒監視の90%と5%差）
- コストは1秒監視の1/9

---

## セッション管理

### ログイン可能時間
```
5:00 - 24:00  : ログイン可能、セッション維持
24:00 - 3:15  : ログイン不可、既存セッション継続可能
3:15          : システムリセット（全セッション切断）
3:15 - 5:00   : ログイン不可、監視のみ
```

### セッション維持戦略

```typescript
// Workers Cron (毎分実行)
async function manageSession(env: Env) {
  const now = new Date();
  const hour = now.getHours();
  
  let session = await env.KV.get('active_session');
  
  if (hour >= 5 && hour < 24) {
    // 通常時間: セッション維持
    if (!session) {
      session = await loginToSite();
      await env.KV.put('active_session', session, {
        expirationTtl: 68400 // 19時間
      });
    }
    return session;
  }
  
  if (hour >= 0 && hour < 3) {
    // 深夜: セッション維持試行
    if (session) {
      return session; // 既存セッション使用
    }
    // セッションなし: 監視のみ、予約は5:00まで待機
    return null;
  }
  
  // 3:15-5:00: 監視のみ
  return null;
}
```

---

## PWA要件

### Manifest設定

```json
{
  "name": "テニスコート予約自動化",
  "short_name": "テニス予約",
  "description": "品川区・港区のテニスコート自動予約",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#10b981",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### Service Worker機能

1. **キャッシュ戦略**
   - App Shell: Cache First
   - API: Network First
   - 画像: Cache First + lazy loading

2. **オフライン対応**
   - 設定変更をIndexedDBにキュー保存
   - オンライン復帰時に自動同期

3. **プッシュ通知**
   - Web Push API
   - バックグラウンド受信

4. **バックグラウンド同期**
   - 監視状態の定期取得
   - 履歴の自動更新

---

## API仕様

### 認証API

#### POST /api/auth/register
```typescript
Request:
{
  email: string;
  password: string;
}

Response:
{
  token: string;
  userId: string;
}
```

#### POST /api/auth/login
```typescript
Request:
{
  email: string;
  password: string;
}

Response:
{
  token: string;
  userId: string;
  settings: UserSettings;
}
```

### 監視API

#### GET /api/monitoring/status
```typescript
Response:
{
  isMonitoring: boolean;
  targets: MonitoringTarget[];
  lastCheck: number;
  nextCheck: number;
}
```

#### POST /api/monitoring/start
```typescript
Request:
{
  targets: MonitoringTarget[];
}

Response:
{
  success: boolean;
  message: string;
}
```

#### POST /api/monitoring/stop
```typescript
Response:
{
  success: boolean;
}
```

### 設定API

#### GET /api/settings
```typescript
Response: UserSettings
```

#### PUT /api/settings
```typescript
Request: UserSettings
Response: { success: boolean }
```

### 履歴API

#### GET /api/reservations/history
```typescript
Response:
{
  reservations: ReservationRecord[];
  total: number;
}
```

---

## データモデル

### Workers KV スキーマ

```typescript
// ユーザー
interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  settings: UserSettings;
}

// ユーザー設定
interface UserSettings {
  shinagawa: {
    username: string;
    password: string; // AES-256暗号化
    facilities: string[];
  };
  minato: {
    username: string;
    password: string; // AES-256暗号化
    facilities: string[];
  };
  notifications: {
    pushEnabled: boolean;
    types: NotificationType[];
    pushSubscription?: PushSubscription;
  };
  monitoring: {
    enabled: boolean;
    autoReserve: boolean;
  };
}

// 監視対象
interface MonitoringTarget {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlots: string[];
  priority: number;
  status: 'monitoring' | 'detected' | 'reserved' | 'failed';
}

// セッション
interface SiteSession {
  jsessionid: string;
  loginTime: number;
  expiresAt: number;
  site: 'shinagawa' | 'minato';
}

// 待機予約
interface PendingReservation {
  id: string;
  userId: string;
  target: MonitoringTarget;
  detectedAt: number;
  scheduledAt: number; // 5:00など
  priority: number;
}

// 予約履歴
interface ReservationRecord {
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

// KV Keys
const KV_KEYS = {
  USER: 'users:{userId}',
  SESSION: 'sessions:{sessionId}',
  SITE_SESSION: 'site_sessions:{site}:{userId}',
  MONITORING_TARGETS: 'monitoring_targets:{userId}',
  PENDING_RESERVATIONS: 'pending_reservations:{userId}',
  RESERVATION_HISTORY: 'reservation_history:{userId}',
  INTENSIVE_TARGETS: 'intensive_targets', // Lambda用
};
```

---

## セキュリティ

### 1. 認証情報の暗号化

```typescript
// Workers での暗号化
import { AES, enc } from 'crypto-js';

function encryptPassword(password: string, secret: string): string {
  return AES.encrypt(password, secret).toString();
}

function decryptPassword(encrypted: string, secret: string): string {
  return AES.decrypt(encrypted, secret).toString(enc.Utf8);
}
```

### 2. HTTPSヘッダー

```typescript
// Cloudflare Workers
const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Content-Security-Policy': "default-src 'self'",
};
```

### 3. Rate Limiting

```typescript
// Cloudflare Workers
async function rateLimit(ip: string, env: Env): Promise<boolean> {
  const key = `rate_limit:${ip}`;
  const count = await env.KV.get(key);
  
  if (count && parseInt(count) > 100) {
    return false; // Too many requests
  }
  
  await env.KV.put(key, String((parseInt(count || '0') + 1)), {
    expirationTtl: 60 // 1分
  });
  
  return true;
}
```

### 4. JWT認証

```typescript
// Hono JWT middleware
import { jwt } from 'hono/jwt';

app.use('/api/*', jwt({
  secret: env.JWT_SECRET,
  cookie: 'auth_token',
}));
```

---

## 運用コスト

### 月額コスト（詳細）

```
Cloudflare Workers:
  - リクエスト:       無料枠内 (10万/日)
  - CPU時間:         無料枠内
  - KV 読み取り:      無料枠内 (100万/日)
  - KV 書き込み:      $0.50/月 (100万書き込み)
  - KV ストレージ:    $0.50/月 (含む)

AWS Lambda:
  - リクエスト:       無料枠内 (4,320回/月)
  - 実行時間:         無料枠内 (2,160分/月)
  - EventBridge:     $0.04/月

Cloudflare Pages:
  - ホスティング:     無料枠内
  - ビルド:          無料枠内

CloudWatch Logs:
  - ログ保存:        無料枠内 (5GB/月)

Push通知:
  - Firebase FCM:    無料

──────────────────────────────────────────
合計:               $0.54/月 ≈ ¥82/月
```

### 無料枠の内訳

#### Cloudflare Workers 無料枠
- リクエスト: 10万/日
- CPU時間: 10ms/リクエスト
- KV 読み取り: 100万/日
- KV 書き込み: 1,000/日（超過分 $0.50/100万）

#### AWS Lambda 無料枠
- リクエスト: 100万/月
- 実行時間: 40万GB秒/月
- 本システム使用量: 4,320回/月、540GB秒/月

---

## 成功率の見積もり

### 通常監視（×→○）
- **60秒間隔**: 70%
- **理由**: 空きが出てから60秒以内に他のユーザーに取られる可能性

### 集中監視（取→○）
- **10秒間隔**: 85%
- **理由**: バッチ更新の3〜4秒ズレを10秒×4回でカバー
- **1秒間隔**: 90%（コスト2倍以上、5%の差で不採用）

### 5:00の瞬間
- **4:59:58トリガー**: 90%+
- **理由**: 他のユーザーより早くログイン・予約実行

---

## 実装優先順位

### Phase 1: 基盤（Week 1-2）
1. Next.js PWA セットアップ
2. Cloudflare Workers API
3. 認証機能
4. 基本UI

### Phase 2: コア機能（Week 3-4）
1. スクレイピング実装
2. 通常監視
3. セッション管理
4. 予約フロー

### Phase 3: 高度な機能（Week 5）
1. AWS Lambda 集中監視
2. PWA機能（通知、オフライン）
3. テスト
4. デプロイ

---

## 参照ドキュメント

- `SPECIFICATION.md`: 詳細技術仕様
- `INTENSIVE_MONITORING.md`: 10秒監視の実装詳細
- `SESSION_STRATEGY.md`: 24時間セッション管理
- `PROJECT_PLAN.md`: 開発計画・タスクリスト

---

**ドキュメント管理**
- 最終更新: 2025年11月20日
- バージョン: 1.0.0
- 承認: 未承認
