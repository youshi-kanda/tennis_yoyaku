# テニスコート自動予約システム - システム概要

## 📋 目次
1. [システム概要](#システム概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [技術スタック](#技術スタック)
4. [主要機能](#主要機能)
5. [データ構造](#データ構造)
6. [API仕様](#api仕様)
7. [デプロイ情報](#デプロイ情報)
8. [開発環境](#開発環境)

---

## システム概要

### プロジェクト名
**テニスコート自動予約システム (Tennis Court Auto-Reservation System)**

### 目的
品川区・港区のテニスコート予約サイトを監視し、キャンセル枠が出た際に自動で予約を行うシステム

**対象施設**: 現状はテニスコートのみ対象（将来的に体育館・野球場等に拡張可能）

### 対象サイト
- **品川区**: https://www.shinagawa-yoyaku.jp/
- **港区**: https://yoyaku.city.minato.tokyo.jp/

### 主な特徴
- 🔄 5分間隔での自動監視
- 📱 PWA対応（オフライン機能、プッシュ通知）
- 🎌 祝日対応（祝日のみ/祝日を含む/祝日を除外）
- 📅 曜日指定監視
- 🎯 優先度設定による複数施設監視
- 🚀 3ステップウィザードUIによる簡単設定

---

## アーキテクチャ

### システム構成図
```
┌─────────────────────────────────────────────────────────────┐
│                      User (Browser)                         │
│                   PWA (Next.js 15 App)                      │
│              https://pwa-*.vercel.app                       │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS
                      │ REST API
┌─────────────────────▼───────────────────────────────────────┐
│              Cloudflare Workers                             │
│       https://tennis-yoyaku-api.*.workers.dev               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ • JWT認証                                             │  │
│  │ • セッション管理                                      │  │
│  │ • 監視ロジック (Cron: */5 * * * *)                  │  │
│  │ • スクレイピング                                      │  │
│  │ • 予約実行                                            │  │
│  │ • プッシュ通知 (Web Push)                            │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              KV Namespaces (Storage)                  │  │
│  │ • USERS: ユーザー情報・設定                          │  │
│  │ • SESSIONS: ログインセッション                       │  │
│  │ • MONITORING: 監視ターゲット                         │  │
│  │ • RESERVATIONS: 予約履歴                             │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                      │
                      │ HTTPS (Scraping)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Target Reservation Sites                       │
│  • shinagawa-yoyaku.jp                                      │
│  • yoyaku.city.minato.tokyo.jp                              │
└─────────────────────────────────────────────────────────────┘
```

### データフロー
1. **ユーザー操作** → PWA → Workers API
2. **Cron実行** (5分毎) → Workers → 監視実行 → スクレイピング
3. **キャンセル検知** → 自動予約 → プッシュ通知 → ユーザー

---

## 技術スタック

### フロントエンド (PWA)
| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | 15.1.0 | React フレームワーク |
| React | 19.x | UI ライブラリ |
| TypeScript | 5.x | 型安全性 |
| Tailwind CSS | 3.x | スタイリング |
| Zustand | - | 状態管理 |
| Service Worker | - | オフライン対応・プッシュ通知 |

### バックエンド (Workers)
| 技術 | バージョン | 用途 |
|------|-----------|------|
| Cloudflare Workers | - | サーバーレス実行環境 |
| Wrangler | 3.114.15 | デプロイツール |
| KV (Key-Value) | - | データストレージ |
| Cron Triggers | - | 定期実行 (5分間隔) |
| Web Push | - | プッシュ通知 |
| jose | - | JWT認証 |

### インフラ
| サービス | 用途 |
|---------|------|
| Vercel | PWAホスティング |
| Cloudflare Workers | APIサーバー・Cron実行 |
| Cloudflare KV | データベース |

---

## 主要機能

### 1. 認証機能
- **ユーザー登録**: メールアドレス + パスワード (8文字以上、英数字含む)
- **管理者登録**: 管理者キー (`tennis_admin_2025`) 必要
- **JWT認証**: トークンベース認証
- **セッション管理**: 30日間有効

### 2. 監視設定機能（3ステップウィザード）

#### ステップ1: 施設選択
- 品川区・港区の施設から複数選択
- 地区別の施設一覧表示
- チェックボックスで選択

#### ステップ2: 日時・時間帯設定
- **期間モード**:
  - 特定日: 1日のみ監視
  - 期間指定: 開始日〜終了日
  - 毎週曜日: 継続的に曜日指定監視
- **時間帯選択**: 複数選択可能
  - 09:00-11:00 (午前早め)
  - 11:00-13:00 (午前遅め)
  - 13:00-15:00 (午後早め)
  - 15:00-17:00 (午後遅め)
  - 17:00-19:00 (夕方)
  - 19:00-21:00 (夜間)
- **優先度**: 1〜10 (複数監視時の優先順位)

#### ステップ3: 詳細設定
- **曜日選択**: 毎週曜日モード時に有効
  - 個別選択: 日〜土
  - プリセット: 平日のみ/土日のみ/全曜日
- **祝日設定**:
  - 祝日を含む
  - 祝日を除外
  - 祝日のみ
- **予約戦略**:
  - すべて予約: 空きが出たらすべて予約
  - 優先度順: 優先度の高い順に1つずつ

### 3. 監視機能
- **自動監視**: Cron (5分間隔) で実行
- **ステータス表示**:
  - 監視中 (monitoring)
  - キャンセル検知 (detected)
  - 予約成功 (reserved)
  - 予約失敗 (failed)
- **セッション管理**:
  - 自動ログイン
  - セッション期限管理 (30分)
  - 期限切れ時の再ログイン

### 4. 予約機能
- **自動予約実行**: キャンセル検知時に自動実行
- **予約戦略適用**:
  - 全予約モード: 検知した空きをすべて予約
  - 優先度順モード: 優先度の高い施設から順に予約
- **結果記録**: 成功・失敗を履歴に保存

### 5. 通知機能
- **Web Push通知**:
  - キャンセル検知時
  - 予約成功時
  - 予約失敗時
  - セッション期限切れ時
- **通知設定**: 通知タイプごとに有効/無効切り替え

### 6. 履歴管理
- **予約履歴**: 日時、施設、結果、エラー内容
- **フィルタリング**: 成功/失敗でフィルタ
- **詳細表示**: エラー詳細の確認

### 7. 設定管理
- **ログイン情報**:
  - 品川区: 利用者ID・パスワード
  - 港区: 利用者ID・パスワード
  - 個別保存（上書きせずマージ）
- **通知設定**: プッシュ通知の有効化
- **監視設定**: 自動予約ON/OFF

---

## データ構造

### User (ユーザー)
```typescript
interface User {
  id: string;                    // ユーザーID (UUID)
  email: string;                 // メールアドレス
  role: 'user' | 'admin';        // ロール
  createdAt: number;             // 作成日時 (timestamp)
  settings: UserSettings;        // ユーザー設定
}
```

### UserSettings (ユーザー設定)
```typescript
interface UserSettings {
  shinagawa: SiteCredentials;    // 品川区ログイン情報
  minato: SiteCredentials;       // 港区ログイン情報
  notifications: NotificationSettings;
  monitoring: MonitoringSettings;
}

interface SiteCredentials {
  username: string;              // 利用者ID
  password: string;              // パスワード（✅ AES-256-GCM で暗号化して保存）
  facilities: string[];          // 選択した施設ID
}

// ✅ セキュリティ実装済み:
// - パスワードは AES-256-GCM で暗号化してKVに保存
// - 暗号化キーは Workers Secrets に保存
// - 自動マイグレーション: 既存の平文パスワードを初回アクセス時に暗号化
// - Workers Secretsには以下を保存:
//   - ENCRYPTION_KEY: パスワード暗号化キー（256ビット）
//   - JWT_SECRET: JWT署名用シークレット
//   - ADMIN_KEY: 管理者登録キー
//   - VAPID_PRIVATE_KEY: プッシュ通知秘密鍵

interface NotificationSettings {
  pushEnabled: boolean;          // プッシュ通知有効
  types: NotificationType[];     // 通知タイプ
  pushSubscription?: PushSubscriptionJSON;
}

interface MonitoringSettings {
  enabled: boolean;              // 監視有効
  autoReserve: boolean;          // 自動予約有効
}
```

### MonitoringTarget (監視ターゲット)
```typescript
interface MonitoringTarget {
  id: string;                    // ターゲットID (UUID)
  userId: string;                // ユーザーID
  site: 'shinagawa' | 'minato';  // サイト
  facilityId: string;            // 施設ID
  facilityName: string;          // 施設名
  date: string;                  // 日付 (YYYY-MM-DD) ※後方互換性のため残存
  timeSlots: string[];           // 時間帯 ['09:00-11:00', ...]
  priority: number;              // 優先度 (1-10) ※現在は削除済み、後方互換性のため型定義のみ残存
  status: 'monitoring' | 'detected' | 'reserved' | 'failed';
  
  // 期間モード用（dateMode により使用するフィールドが異なる）
  dateMode?: 'single' | 'range' | 'continuous';
  startDate?: string;            // 開始日
  endDate?: string;              // 終了日
  
  // 📌 dateMode別の必須フィールド:
  // - single: date のみ使用
  // - range: startDate + endDate 使用、date は開始日と同じ値
  // - continuous: startDate + endDate を動的設定（予約可能期間まで）
  
  // 曜日指定用（continuousモードで使用）
  selectedWeekdays?: number[];   // [0,1,2,...] (0=日曜)
  includeHolidays?: boolean | 'only'; // 祝日の扱い
  
  // 戦略（現在は削除済み、後方互換性のため型定義のみ残存）
  reservationStrategy?: 'all' | 'priority';
  
  createdAt: number;
  updatedAt: number;
}
```

### ReservationHistory (予約履歴)
```typescript
interface ReservationHistory {
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed';
  message: string;               // 結果メッセージ
  createdAt: number;
}
```

### Session (セッション)
```typescript
interface SiteSession {
  jsessionid: string;            // セッションID
  loginTime: number;             // ログイン時刻
  expiresAt: number;             // 期限 (loginTime + 30分)
  site: 'shinagawa' | 'minato';
}
```

---

## API仕様

### ベースURL
- **Production**: `https://tennis-yoyaku-api.kanda02-1203.workers.dev`
- **Dev**: `http://localhost:8787`

### 認証
- **方式**: JWT Bearer Token
- **ヘッダー**: `Authorization: Bearer <token>`

### エンドポイント

#### 1. 認証系

##### POST `/auth/register`
ユーザー登録

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "adminKey": "tennis_admin_2025" // optional
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

##### POST `/auth/login`
ログイン

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

##### GET `/auth/me`
ログインユーザー情報取得

**Response:**
```json
{
  "success": true,
  "data": {
    "user": { ... }
  }
}
```

#### 2. 監視系

##### POST `/monitoring/create`
監視ターゲット作成

**Request Body:**
```json
{
  "site": "shinagawa",
  "facilityId": "facility_001",
  "facilityName": "品川区テニスコート1",
  "date": "2025-12-01",
  "timeSlots": ["09:00-11:00", "11:00-13:00"],
  "priority": 5,
  "periodMode": "weekly",
  "startDate": "2025-12-01",
  "endDate": "2025-12-31",
  "selectedWeekdays": [0, 6],
  "includeHolidays": true,
  "reservationStrategy": "priority"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "targetId": "uuid-xxx-xxx"
  }
}
```

##### GET `/monitoring/list`
監視ターゲット一覧取得

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-xxx-xxx",
      "site": "shinagawa",
      "facilityName": "品川区テニスコート1",
      "status": "monitoring",
      ...
    }
  ]
}
```

##### DELETE `/monitoring/:targetId`
監視ターゲット削除

**Response:**
```json
{
  "success": true
}
```

#### 3. 設定系

##### POST `/settings/save`
ユーザー設定保存

**Request Body:**
```json
{
  "shinagawa": {
    "username": "user123",
    "password": "pass123",
    "facilities": ["facility_001"]
  },
  "minato": {
    "username": "user456",
    "password": "pass456",
    "facilities": ["facility_002"]
  },
  "notifications": {
    "pushEnabled": true,
    "types": ["vacant_detected", "reservation_success"],
    "pushSubscription": { ... }
  },
  "monitoring": {
    "enabled": true,
    "autoReserve": true
  }
}
```

**Response:**
```json
{
  "success": true
}
```

##### GET `/settings/get`
ユーザー設定取得

**Response:**
```json
{
  "success": true,
  "data": {
    "shinagawa": { ... },
    "minato": { ... },
    ...
  }
}
```

#### 4. 履歴系

##### GET `/history/reservations`
予約履歴取得

**Query Parameters:**
- `status`: `success` | `failed` | `all` (default: all)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid-xxx",
      "site": "shinagawa",
      "facilityName": "品川区テニスコート1",
      "date": "2025-12-01",
      "timeSlot": "09:00-11:00",
      "status": "success",
      "message": "予約成功",
      "createdAt": 1732406400000
    }
  ]
}
```

#### 5. 施設系

##### GET `/facilities/:site`
施設一覧取得

**Parameters:**
- `site`: `shinagawa` | `minato`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "facility_001",
      "name": "品川区テニスコート1",
      "site": "shinagawa",
      "type": "tennis",
      "location": "品川区"
    }
  ]
}
```

---

## デプロイ情報

### 現在のバージョン

#### PWA (Frontend)
- **URL**: https://pwa-m5kk1nk9i-kys-projects-ed1892e5.vercel.app
- **Platform**: Vercel
- **Framework**: Next.js 15 (Turbopack)
- **Build**: Production
- **Last Deploy**: 2025-11-24

#### Workers (Backend)
- **URL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **Platform**: Cloudflare Workers
- **Version ID**: `f58ae125-5029-403e-9f35-cc139b1e379e`
- **Compatibility Date**: 2024-01-01
- **Last Deploy**: 2025-11-24
- **Security**: AES-256-GCM パスワード暗号化実装済み

### Cron Schedule
- **実行間隔**: 5分毎 (`*/5 * * * *`)
- **実行内容**:
  1. アクティブな監視ターゲット取得（全ユーザー分）
  2. 優先度順にソート（優先度高→作成日時古い順）
  3. 各サイトにログイン（セッション期限切れ時のみ）
  4. スクレイピング実行（ターゲットごと）
  5. キャンセル検知（×→○）
  6. 自動予約実行
  7. プッシュ通知送信

**処理ポリシー**:
- 1回のCron実行で全ユーザーの全ターゲットを処理
- 優先度の高いターゲットから順に処理
- スロットリング: 現在制限なし（将来的に検討）
- エラー時: 次のターゲットへ継続（個別ターゲットの失敗で全体停止しない）

### KV Namespaces
| Namespace | ID | 用途 |
|-----------|----|----|
| USERS | `2bb51589e95d448abc4f6821a5898865` | ユーザー情報 |
| SESSIONS | `2111997ed58e4f5080074fc0a95cacf0` | ログインセッション |
| MONITORING | `5a8f67abf49546b58f6113e18a5b2443` | 監視ターゲット |
| RESERVATIONS | `6e26433ee30b4ad0bc0a8749a67038be` | 予約履歴 |

### 環境変数
| 変数名 | 説明 |
|--------|------|
| `NEXT_PUBLIC_API_URL` | Workers API URL |
| `JWT_SECRET` | JWT署名シークレット |
| `ADMIN_KEY` | 管理者登録キー |
| `VAPID_PUBLIC_KEY` | Web Push公開鍵 |
| `VAPID_PRIVATE_KEY` | Web Push秘密鍵 |
| `VAPID_SUBJECT` | Web Push送信者情報 |

---

## セキュリティとレート制御

### 認証とセッション管理
- **JWT認証**: 有効期限30日、Authorization ヘッダーで送信
- **パスワード保存**: ✅ AES-256-GCM で暗号化してKV保存（実装済み）
  - 暗号化キー: Workers Secrets の `ENCRYPTION_KEY`（256ビット）
  - IV: 96ビット（12バイト）をランダム生成
  - 認証タグ: 128ビット（16バイト）
  - 自動マイグレーション: 既存の平文パスワードを初回アクセス時に自動暗号化
- **施設予約サイトのセッション**: JSESSIONID をKVで管理（30分TTL）

### レート制御
- **予約上限設定**: ユーザーごとに週/月の予約回数上限を設定可能
  - `settings.reservationLimits.perWeek`: 週あたりの上限
  - `settings.reservationLimits.perMonth`: 月あたりの上限
- **監視ターゲット数**: 現在制限なし（将来的に検討）

### エラーハンドリング
- **スクレイピング失敗**: エラーログ出力、次のターゲットへ継続
- **ログイン失敗**: セッション削除、次回Cronで再試行
- **予約失敗**: `ReservationHistory.status = 'failed'` に記録
- **リトライ**: 現在は1回のみ（将来的に複数回リトライを検討）

### Workers Secrets（本番環境）
```
ENCRYPTION_KEY: パスワード暗号化キー（256ビット、64文字のHex文字列）
JWT_SECRET: JWT署名用シークレットキー
ADMIN_KEY: 管理者登録キー（"tennis_admin_2025"）
VAPID_PUBLIC_KEY: Web Push 公開鍵
VAPID_PRIVATE_KEY: Web Push 秘密鍵
VAPID_SUBJECT: Web Push 送信者情報
```

---

## 開発環境

### セットアップ

#### 1. リポジトリクローン
```bash
git clone https://github.com/youshi-kanda/tennis_yoyaku.git
cd tennis_yoyaku
```

#### 2. PWA セットアップ
```bash
cd pwa
npm install
cp .env.local.example .env.local
# .env.localを編集
npm run dev
```

#### 3. Workers セットアップ
```bash
cd workers
npm install
# wrangler.tomlの環境変数を設定
npx wrangler dev
```

### ディレクトリ構造
```
tennis_yoyaku/
├── pwa/                          # Next.js PWA
│   ├── app/                      # App Router
│   │   ├── page.tsx              # ログインページ
│   │   ├── register/             # 登録ページ
│   │   ├── dashboard/            # ダッシュボード
│   │   │   ├── layout.tsx        # ダッシュボードレイアウト
│   │   │   ├── monitoring/       # 監視設定ページ
│   │   │   ├── history/          # 履歴ページ
│   │   │   └── settings/         # 設定ページ
│   │   └── admin/                # 管理画面
│   ├── components/               # コンポーネント
│   ├── lib/
│   │   ├── api/                  # APIクライアント
│   │   ├── hooks/                # カスタムフック
│   │   ├── stores/               # Zustand ストア
│   │   ├── types/                # 型定義
│   │   └── utils/                # ユーティリティ
│   ├── public/
│   │   ├── manifest.json         # PWAマニフェスト
│   │   ├── service-worker.js     # Service Worker
│   │   └── icons/                # アプリアイコン
│   └── package.json
├── workers/                      # Cloudflare Workers
│   ├── src/
│   │   ├── index.ts              # メインエントリポイント
│   │   ├── auth.ts               # 認証ロジック
│   │   └── scraper.ts            # スクレイピングロジック
│   ├── wrangler.toml             # Workers設定
│   └── package.json
├── SYSTEM_OVERVIEW.md            # このファイル
├── SPECIFICATION.md              # 詳細仕様書
├── PROJECT_PLAN.md               # プロジェクト計画
└── README.md                     # プロジェクトREADME
```

### ビルド & デプロイ

#### PWA
```bash
cd pwa
npm run build           # ビルド
npx vercel --prod       # Vercelにデプロイ
```

#### Workers
```bash
cd workers
npx wrangler deploy --compatibility-date=2024-01-01
```

### ローカル開発

#### PWA開発サーバー
```bash
cd pwa
npm run dev
# http://localhost:3000
```

#### Workers開発サーバー
```bash
cd workers
npx wrangler dev
# http://localhost:8787
```

### テスト
```bash
# PWA
cd pwa
npm run lint            # ESLint
npm run type-check      # TypeScript型チェック

# Workers
cd workers
npm run test            # テスト実行（未実装）
```

---

## 最新の改善点

### Phase 1: ウィザードUI実装 (2025-11-24 完了)
- ✅ 3ステップウィザード形式に変更
- ✅ プログレスバー表示
- ✅ ステップごとのバリデーション
- ✅ 監視開始後に自動でウィザードを閉じる

### Phase 2: 祝日対応 (2025-11-23 完了)
- ✅ 祝日判定モジュール追加
- ✅ 祝日設定UI実装
- ✅ バックエンド対応

### バグ修正履歴
- ✅ 監視作成時に`selectedWeekdays`と`includeHolidays`が保存されない問題を修正
- ✅ 設定保存時に品川区・港区のログイン情報が上書きされる問題を修正（マージ処理追加）
- ✅ TypeScriptの`any`型エラーを修正（型安全性向上）
- ✅ Effect内のsetState警告を修正
- ✅ Service WorkerのPOSTリクエストエラーを修正

---

## 今後の拡張予定

### 🚨 緊急対応 (即時実施)

#### 1. 監視間隔の短縮化
**現状**: 5分間隔 (`*/5 * * * *`)  
**要件**: 数秒〜数十秒単位  
**ギャップ**: 60倍以上遅い

**実装案**:
- **無料プラン対応**: 1分間隔 + 集中監視（10秒間隔）のハイブリッド
  - 通常監視: 1分間隔（1,440リクエスト/日）
  - 集中監視: 「取」検知時に10秒間隔（最大1,728リクエスト/日）
  - 合計: 3,168リクエスト/日（無料枠100,000リクエスト/日内）
- **Workers Paid推奨**: $5/月でアップグレード
  - 通常監視: 5秒間隔（17,280リクエスト/日）
  - 集中監視: 1秒間隔（最大3,600リクエスト/日）
  - リクエスト上限: 10M/月（余裕あり）
  - KV書き込み: 無制限

**技術的制約**:
- Cron Triggers: 最短1分間隔
- 秒単位監視: Durable Objects必須（$5/月 + 従量課金）

#### 2. 集中監視機能（取→○）実装
**現状**: 未実装  
**要件**: 10分刻み前後の秒単位集中監視

**実装案**:
```typescript
interface MonitoringTarget {
  // 既存フィールド...
  intensiveMode?: boolean;          // 集中監視有効
  intensiveInterval?: number;       // 集中監視間隔（秒）
  intensiveWindowBefore?: number;   // 前何秒から監視
  intensiveWindowAfter?: number;    // 後何秒まで監視
  detectedStatus?: '×' | '取' | '○';
}
```

**処理フロー**:
1. 通常監視で「取」ステータス検知
2. 次の10分刻み時刻を計算（例: 10:23検知 → 10:30が目標）
3. 目標時刻の前後60秒を秒単位で監視
4. 「○」検知時に即座に予約実行

**Durable Objects実装**:
```typescript
// workers/src/intensive-monitor.ts
export class IntensiveMonitor {
  async fetch(request: Request) {
    const interval = setInterval(async () => {
      // 1秒ごとにスクレイピング
      await checkAvailability();
    }, 1000);
  }
}
```

### 📋 重要機能 (1週間以内)

#### 3. 検索結果の一括取得
**現状**: 施設ごとに個別スクレイピング  
**要件**: 検索条件でまとめて取得

**実装案**:
```typescript
// 改善前
for (const facilityId of facilities) {
  await scrapeFacility(facilityId);  // サブリクエスト×施設数
}

// 改善後
const results = await scrapeAllFacilities({
  date: '2025-12-01',
  timeSlots: ['09:00-11:00'],
  facilityIds: facilities
});
```

**効果**:
- サブリクエスト削減: 10施設 × 5回 = 50 → 5回
- 処理時間短縮: 10秒 → 2秒
- 無料プランのサブリクエスト上限（50/リクエスト）に余裕

#### 4. 5:00一斉処理実装
**要件**: 5:00:00に溜まった対象枠を一斉予約

**実装案**:
```typescript
// wrangler.toml
[[triggers.crons]]
crons = ["0 5 * * *"]  // 毎日5:00

// src/index.ts
async function handle5AMBatch(env: Env) {
  const targets = await getAllPendingTargets(env);
  
  // 優先度順にソート
  targets.sort((a, b) => b.priority - a.priority);
  
  // 一斉に予約実行
  for (const target of targets) {
    if (target.status === 'detected') {
      await reserveSlot(target, env);
    }
  }
}
```

#### 5. 深夜早朝時間帯対応
**要件**:
- 24:00～3:15: ログイン不可、既存セッションのみ予約可
- 3:15: セッションリセット
- 3:15～5:00: 新規予約不可

**実装案**:
```typescript
function canLogin(now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 24:00～3:15はログイン不可
  if (hour === 0 || (hour < 3) || (hour === 3 && minute < 15)) {
    return false;
  }
  return true;
}

function shouldResetSession(now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 3:15にリセット
  return hour === 3 && minute === 15;
}

function canMakeReservation(now: Date): boolean {
  const hour = now.getHours();
  const minute = now.getMinutes();
  
  // 3:15～5:00は新規予約不可
  if ((hour === 3 && minute >= 15) || hour === 4) {
    return false;
  }
  return true;
}
```

### 🔧 中期改善 (2週間以内)

#### 6. 複数枚取得方針の選択機能
**現状**: `autoReserve: true`で全取得  
**要件**: モード選択可能に

**実装案**:
```typescript
interface MonitoringSettings {
  enabled: boolean;
  autoReserve: boolean;
  reservationStrategy: 'all' | 'priority_first';  // 追加
}

// モードA: 全取得
if (settings.reservationStrategy === 'all') {
  for (const slot of availableSlots) {
    await reserve(slot);
  }
}

// モードB: 優先度1枚のみ
if (settings.reservationStrategy === 'priority_first') {
  const topPrioritySlot = availableSlots[0];
  await reserve(topPrioritySlot);
}
```

#### 7. Cronバッチ処理最適化
**目的**: KV書き込み回数の最小化

**実装案**:
```typescript
// メモリに蓄積してバッチ書き込み
const updates = new Map<string, MonitoringTarget[]>();

// 監視実行
for (const target of targets) {
  const result = await checkAvailability(target);
  
  if (!updates.has(target.userId)) {
    updates.set(target.userId, []);
  }
  updates.get(target.userId)!.push(result);
}

// ユーザー単位でまとめて書き込み
for (const [userId, userTargets] of updates) {
  await saveUserMonitoringState(userId, userTargets, env.MONITORING);
  // 1ユーザー1回の書き込み
}
```

**効果**:
- 87日分のチェック: 書き込み87回 → 最大3回
- 1ユーザー1キー方式: `MONITORING:{userId}`

### 🛠 環境整備 (随時)

#### 8. dev/prod namespace分離
**目的**: テストで本番上限を消費しない

**実装案**:
```toml
# wrangler.toml
[env.development]
name = "tennis-yoyaku-api-dev"
kv_namespaces = [
  { binding = "USERS", id = "dev_users_namespace_id" },
  { binding = "MONITORING", id = "dev_monitoring_namespace_id" },
  # ...
]

[env.production]
name = "tennis-yoyaku-api"
kv_namespaces = [
  { binding = "USERS", id = "2bb51589e95d448abc4f6821a5898865" },
  { binding = "MONITORING", id = "5a8f67abf49546b58f6113e18a5b2443" },
  # ...
]
```

**デプロイ**:
```bash
# 開発環境
npx wrangler deploy --env development

# 本番環境
npx wrangler deploy --env production
```

---

## Cloudflare プラン比較

### 無料プラン
- **リクエスト**: 100,000/日
- **KV書き込み**: 1,000/日
- **サブリクエスト**: 50/リクエスト
- **Cron**: 最短1分間隔
- **制約**: 秒単位監視不可

**実現可能な監視間隔**:
- 1分通常 + 10秒集中: 3,168リクエスト/日（✅ 可能）
- 5秒間隔: 17,280リクエスト/日（❌ 17倍超過）

### Workers Paid ($5/月)
- **リクエスト**: 10M/月
- **KV書き込み**: 無制限
- **サブリクエスト**: 1,000/リクエスト
- **Cron**: 最短1分間隔
- **制約**: 秒単位監視にはDurable Objects必要

**実現可能な監視間隔**:
- 5秒通常 + 1秒集中: 20,880リクエスト/日（✅ 余裕）
- クライアント要件完全対応: ✅ 可能

### Durable Objects ($5/月 + 従量課金)
- **用途**: ステートフル処理、秒単位ループ
- **コスト**: $0.15/100万リクエスト + $15/月（GB-秒）
- **推定月額**: $7-10/月
- **制約**: なし

**実現可能な監視間隔**:
- 1秒以下の監視: ✅ 可能
- クライアント要件: ✅ オーバースペック

---

## 推奨プラン

### 🎯 推奨: Workers Paid ($5/月)
**理由**:
1. クライアント要件「数秒〜数十秒」を完全対応
2. KV書き込み無制限でテスト・開発が自由
3. コストパフォーマンス最高
4. Durable Objectsよりシンプル

**実装ステップ**:
1. Workers Paidにアップグレード
2. 監視間隔を5秒に短縮（Cron 1分 + Durable Objects 5秒ループ）
3. 集中監視を1秒間隔で実装
4. 検索一括取得で処理時間短縮
5. 5:00一斉処理実装

---

## 短期 (1-2週間)
- [ ] 設定プレビューサイドバー実装
- [ ] エラーハンドリング強化
- [ ] ユニットテスト追加
- [ ] E2Eテスト導入

## 中期 (1-2ヶ月)
- [ ] 他の自治体サイト対応
- [ ] 予約状況ダッシュボード
- [ ] 統計・分析機能
- [ ] メール通知追加

## 長期 (3ヶ月以降)
- [ ] モバイルアプリ化 (React Native)
- [ ] 複数ユーザー協調予約
- [ ] AI予測機能（空き予測）
- [ ] 料金管理機能

---

## サポート & コントリビューション

### バグ報告
GitHubのIssueで報告してください

### 開発者
- **メイン開発者**: Youshi Kanda
- **連絡先**: youshi.kanda@example.com

### ライセンス
MIT License

---

**最終更新**: 2025年11月24日  
**バージョン**: 1.3.0  
**Workers Version**: `f58ae125-5029-403e-9f35-cc139b1e379e`  
**セキュリティ**: AES-256-GCM パスワード暗号化実装済み
