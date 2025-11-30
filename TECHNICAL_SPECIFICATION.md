# テニスコート自動予約システム - 技術仕様書

**バージョン**: 1.0  
**最終更新日**: 2025年11月30日  
**対象**: システム管理者・開発者

---

## 📋 目次

1. [システム概要](#システム概要)
2. [アーキテクチャ](#アーキテクチャ)
3. [技術スタック](#技術スタック)
4. [機能仕様](#機能仕様)
5. [API仕様](#api仕様)
6. [データベース設計](#データベース設計)
7. [セキュリティ](#セキュリティ)
8. [デプロイ・運用](#デプロイ運用)
9. [制限事項](#制限事項)
10. [トラブルシューティング](#トラブルシューティング)

---

## システム概要

### プロジェクト情報

- **システム名**: テニスコート自動予約システム
- **リポジトリ**: tennis_yoyaku
- **オーナー**: youshi-kanda
- **ブランチ**: main

### デプロイ情報

#### バックエンド（Cloudflare Workers）
- **URL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **最新バージョン**: v1e85083f-e8c9-4864-8b6a-316a00058da1
- **デプロイコマンド**: `npx wrangler deploy`

#### フロントエンド（Vercel PWA）
- **URL**: https://pwa-msstcv2fk-kys-projects-ed1892e5.vercel.app
- **デプロイコマンド**: `vercel --prod --yes`

### 対応サイト

1. **品川区スポーツ予約**: https://www.cm9.eprs.jp/shinagawa/web/
2. **港区スポーツ予約**: https://web101.rsv.ws-scs.jp/web/

---

## アーキテクチャ

### システム構成図

```
┌─────────────────────────────────────────────────┐
│          クライアント（PWA）                      │
│  - Next.js 16.0.3 (App Router)                 │
│  - Service Worker (Push通知・オフライン)         │
│  - Vercel でホスティング                         │
└─────────────────┬───────────────────────────────┘
                  │ HTTPS/REST API
                  │
┌─────────────────▼───────────────────────────────┐
│       Cloudflare Workers (バックエンド)          │
│  - 認証・認可                                    │
│  - 監視ロジック                                  │
│  - 予約実行                                      │
│  - Cron処理（毎分 + 5:00一斉）                   │
└─────────────────┬───────────────────────────────┘
                  │
        ┌─────────┴──────────┐
        │                    │
┌───────▼────────┐  ┌────────▼───────┐
│ Cloudflare KV  │  │  外部予約サイト  │
│  (データ永続化) │  │ - 品川区        │
│                │  │ - 港区          │
└────────────────┘  └────────────────┘
```

### データフロー

#### 1. 監視・予約フロー

```
Cron Trigger (毎分実行)
  ↓
監視ターゲット取得 (KV: monitoring:all_targets)
  ↓
並列で空き状況チェック (外部サイトにHTTPリクエスト)
  ↓
空きあり？
  ├─ YES → 自動予約実行 → プッシュ通知送信
  └─ NO → 次回の監視へ
```

#### 2. 認証フロー

```
ログイン (POST /api/auth/login)
  ↓
パスワード検証 (bcrypt)
  ↓
JWT生成 (有効期限: 7日間)
  ↓
クライアントにトークン返却
  ↓
以降のリクエストでAuthorizationヘッダーに含める
```

---

## 技術スタック

### フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | 16.0.3 | フレームワーク |
| React | 19.0.0 | UIライブラリ |
| TypeScript | 5.x | 型安全性 |
| Tailwind CSS | 4.0.0 | スタイリング |
| Zustand | - | 状態管理 |
| Axios | - | HTTPクライアント |
| react-calendar | - | カレンダーUI |

### バックエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Cloudflare Workers | - | サーバーレス実行環境 |
| TypeScript | 5.x | 言語 |
| Wrangler | 3.114.15 | CLIツール |
| Cloudflare KV | - | Key-Value データストア |

### インフラ・運用

| サービス | 用途 |
|---------|------|
| Vercel | PWAホスティング |
| Cloudflare Workers | バックエンドAPI |
| Cloudflare KV | データ永続化 |
| GitHub | ソースコード管理 |

---

## 機能仕様

### 1. 認証・認可

#### ユーザーロール

- **admin**: 管理者（全機能アクセス可能）
- **user**: 一般ユーザー（自分のデータのみアクセス可能）

#### パスワード暗号化

- **アルゴリズム**: bcrypt
- **ソルトラウンド**: 10
- **ストレージ**: Cloudflare KV (users namespace)

#### JWT トークン

- **有効期限**: 7日間
- **署名アルゴリズム**: HMAC-SHA256
- **ペイロード**: `{ userId, email, role, exp }`

### 2. 監視機能

#### 監視モード

**A. 単一日付モード**
- 1日だけを監視
- `date` フィールドに日付を指定

**B. 期間指定モード**
- 指定した期間内の日付を監視
- `startDate`, `endDate` を指定

**C. 継続監視モード** （推奨）
- 予約可能期間全体を自動で監視
- `dateMode: 'continuous'` を指定
- 予約可能期間を動的に取得・更新

#### 監視頻度

- **通常監視**: 1分ごと（Cron: `*/1 * * * *`）
- **集中監視**: 10分刻み（10:10, 10:20...）の前後2分間は高頻度
- **5:00一斉処理**: 毎日5:00に実行（Cron: `0 5 * * *`）

#### フィルタリング

1. **曜日フィルタ**: `selectedWeekdays: [0-6]` (0=日, 6=土)
2. **祝日フィルタ**: 
   - `includeHolidays: true` - 祝日を含める
   - `includeHolidays: false` - 祝日を除外
   - `includeHolidays: 'only'` - 祝日のみ
3. **時間枠フィルタ**: `timeSlots: ['9:00-11:00', ...]`

### 3. 予約実行

#### 予約戦略

**A. 全件予約モード** (`reservationStrategy: 'all'`)
- 空きが見つかった時間枠すべてを予約

**B. 優先度モード** (`reservationStrategy: 'priority_first'`)
- 最も優先度の高い1枠だけ予約
- `priority` フィールド（1-5）で優先順位を設定

#### 予約制限

- 週あたりの上限: 設定可能（デフォルト: 無制限）
- 月あたりの上限: 設定可能（デフォルト: 無制限）

### 4. プッシュ通知

#### 通知タイミング

1. **予約成功**: 🎉 自動予約が成功した時
2. **「取」検知**: 🔥 キャンセル待ち枠を検知した時
3. **集中監視成功**: 🎉 「取」→「○」で予約成功
4. **認証エラー**: ❌ ログイン失敗時
5. **セッション期限切れ**: ⚠️ セッションが無効になった時

#### 実装技術

- **プロトコル**: Web Push API
- **認証**: VAPID (Voluntary Application Server Identification)
- **公開鍵**: `BJl4G42CTnBBIz0YBhm2yZSPEgyNjXjBnjEXZwT1g0hC...`
- **エンドポイント**: ブラウザ固有（FCM, APNs等）

### 5. セッション管理

#### 自動リセット

- **実行時刻**: 毎日 3:15 (JST)
- **対象**: 品川区・港区の全セッション
- **理由**: 品川区サイトのメンテナンス明け（3:15）に備える

#### セッション有効期限

- **品川区**: 約24時間（深夜メンテナンスで無効化）
- **港区**: サイト側の仕様に依存

---

## API仕様

### エンドポイント一覧

#### 認証API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| POST | /api/auth/login | ログイン | 不要 |
| POST | /api/auth/register | ユーザー登録 | 不要 |
| POST | /api/auth/admin-register | 管理者登録 | Admin Key |

#### 監視API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/monitoring/list | 監視リスト取得 | JWT |
| POST | /api/monitoring/create | 監視設定追加 | JWT |
| POST | /api/monitoring/create-batch | 監視設定一括追加 | JWT |
| PATCH | /api/monitoring/:id | 監視設定更新 | JWT |
| DELETE | /api/monitoring/:id | 監視設定削除 | JWT |

#### 予約履歴API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/reservations/history | 予約履歴取得 | JWT |

#### 設定API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/settings | 設定取得 | JWT |
| POST | /api/settings | 設定保存 | JWT |
| GET | /api/settings/credentials | 認証情報取得 | JWT |
| PUT | /api/settings/credentials/:site | 認証情報更新 | JWT |

#### 施設API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/facilities/shinagawa | 品川区施設一覧 | JWT |
| GET | /api/facilities/minato | 港区施設一覧 | JWT |

#### 予約可能期間API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/reservation-period | 予約可能期間取得 | JWT |

#### プッシュ通知API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| POST | /api/push/subscribe | 通知登録 | JWT |
| POST | /api/push/unsubscribe | 通知解除 | JWT |

#### 管理者API

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/admin/stats | 統計情報取得 | Admin JWT |
| GET | /api/admin/users | ユーザー一覧 | Admin JWT |
| GET | /api/admin/monitoring | 全監視設定 | Admin JWT |
| GET | /api/admin/reservations | 全予約履歴 | Admin JWT |
| POST | /api/admin/users/create | ユーザー作成 | Admin JWT |
| DELETE | /api/admin/users/:id | ユーザー削除 | Admin JWT |
| POST | /api/admin/test-notification | テスト通知送信 | Admin JWT |
| POST | /api/admin/reset-sessions | セッション一括リセット | Admin JWT |
| POST | /api/admin/clear-cache | キャッシュクリア | Admin JWT |

#### ヘルスチェックAPI

| メソッド | パス | 説明 | 認証 |
|---------|------|------|------|
| GET | /api/health | ヘルスチェック | 不要 |
| GET | /api/metrics/kv | KVメトリクス | 不要 |

---

## データベース設計

### Cloudflare KV Namespaces

#### 1. USERS Namespace (id: 2bb51589e95d448abc4f6821a5898865)

| キー | 値の型 | 説明 |
|------|-------|------|
| `user:{email}` | User JSON | ユーザー情報 |
| `user:id:{userId}` | string | メールアドレスの逆引き |
| `settings:{userId}` | Settings JSON | ユーザー設定 |
| `push_subscription:{userId}` | PushSubscription JSON | プッシュ通知登録情報 |

**User型**:
```typescript
{
  id: string;           // UUID
  email: string;
  password: string;     // bcrypt ハッシュ
  role: 'admin' | 'user';
  createdAt: number;    // Unix timestamp
}
```

**Settings型**:
```typescript
{
  shinagawa?: {
    username: string;
    password: string;   // 暗号化済み
    sessionId?: string;
  };
  minato?: {
    username: string;
    password: string;   // 暗号化済み
    sessionId?: string;
  };
  reservationLimits?: {
    perWeek?: number;
    perMonth?: number;
  };
}
```

#### 2. SESSIONS Namespace (id: 2111997ed58e4f5080074fc0a95cacf0)

| キー | 値の型 | 説明 |
|------|-------|------|
| `session:{userId}:{site}` | Session JSON | サイト別セッション |

**Session型**:
```typescript
{
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  lastUsed: number;
}
```

#### 3. MONITORING Namespace (id: 5a8f67abf49546b58f6113e18a5b2443)

| キー | 値の型 | 説明 |
|------|-------|------|
| `monitoring:all_targets` | MonitoringTarget[] JSON | 全監視設定 |
| `facilities:{site}` | Facility[] JSON | 施設一覧キャッシュ |
| `reservation_period:{site}` | PeriodInfo JSON | 予約可能期間キャッシュ |

**MonitoringTarget型**:
```typescript
{
  id: string;                    // UUID
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;                  // YYYY-MM-DD
  startDate?: string;            // 期間指定の場合
  endDate?: string;
  dateMode?: 'single' | 'range' | 'continuous';
  timeSlot: string;              // "9:00-11:00"
  timeSlots?: string[];          // 複数時間枠
  selectedWeekdays?: number[];   // [0-6]
  includeHolidays?: boolean | 'only';
  priority?: number;             // 1-5
  status: 'active' | 'paused' | 'completed';
  autoReserve: boolean;
  reservationStrategy?: 'all' | 'priority_first';
  lastCheck?: number;
  lastStatus?: '○' | '×' | '取' | '休';
  detectedStatus?: '取' | '○';
  intensiveMonitoringUntil?: number;
  createdAt: number;
}
```

#### 4. RESERVATIONS Namespace (id: 6e26433ee30b4ad0bc0a8749a67038be)

| キー | 値の型 | 説明 |
|------|-------|------|
| `history:{userId}` | ReservationHistory[] JSON | ユーザーの予約履歴 |

**ReservationHistory型**:
```typescript
{
  id: string;
  userId: string;
  targetId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed';
  message: string;
  createdAt: number;
}
```

---

## セキュリティ

### 1. 認証・認可

#### JWT セキュリティ

- **署名**: HMAC-SHA256
- **シークレット**: 環境変数 `JWT_SECRET`
- **有効期限**: 7日間
- **検証**: 全APIリクエストでトークン検証

#### パスワードセキュリティ

- **ハッシュアルゴリズム**: bcrypt
- **ソルトラウンド**: 10
- **最小文字数**: 制限なし（推奨: 8文字以上）

### 2. データ暗号化

#### 予約サイトのパスワード

- **暗号化方式**: AES-256-GCM
- **暗号化キー**: 環境変数 `ENCRYPTION_KEY`
- **保存形式**: `encrypted:${iv}:${authTag}:${encryptedData}`

#### 通信暗号化

- **プロトコル**: HTTPS/TLS 1.3
- **証明書**: Cloudflare/Vercel 自動管理

### 3. CORS設定

```javascript
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
```

⚠️ **注意**: 本番環境では `Access-Control-Allow-Origin` を特定のドメインに制限することを推奨

### 4. レート制限

現在は未実装。Cloudflare Workers の無料プランの制限に依存：
- **リクエスト数**: 100,000 リクエスト/日
- **CPU時間**: 10ms/リクエスト
- **サブリクエスト**: 50/リクエスト

---

## デプロイ・運用

### 環境変数

#### バックエンド（Cloudflare Workers）

`wrangler.toml` で管理：

```toml
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "prod_jwt_secret_8f9a3b2c1d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z"
ADMIN_KEY = "tennis_admin_2025"
VAPID_PUBLIC_KEY = "BJl4G42CTnBBIz0YBhm2yZSPEgyNjXjBnjEXZwT1g0hC..."
VAPID_PRIVATE_KEY = "M3GGZhN2hN2Df1GlKD8cLBQGqU3JBdVW4whF7hb_aTI"
VAPID_SUBJECT = "mailto:youshi.kanda@gmail.com"
```

⚠️ **重要**: `ENCRYPTION_KEY` はシークレットとして別途設定

#### フロントエンド（Vercel）

Vercel ダッシュボードで設定：

```
NEXT_PUBLIC_API_URL = https://tennis-yoyaku-api.kanda02-1203.workers.dev
NEXT_PUBLIC_VAPID_PUBLIC_KEY = BJl4G42CTnBBIz0YBhm2yZSPEgyNjXjBnjEXZwT1g0hC...
```

### デプロイ手順

#### バックエンド

```bash
cd workers
npx wrangler deploy
```

#### フロントエンド

```bash
cd pwa
vercel --prod --yes
```

### Cron設定

**workers/wrangler.toml**:
```toml
[triggers]
crons = ["*/1 * * * *", "0 5 * * *"]
```

- `*/1 * * * *`: 毎分実行（通常監視）
- `0 5 * * *`: 毎日5:00実行（一斉予約）

### ログ監視

```bash
# リアルタイムログ
npx wrangler tail

# フィルタ付きログ
npx wrangler tail --format pretty
```

### KVデータ管理

```bash
# キーの一覧取得
npx wrangler kv:key list --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# データ取得
npx wrangler kv:key get "monitoring:all_targets" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# データ保存
npx wrangler kv:key put "monitoring:all_targets" "[]" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# データ削除
npx wrangler kv:key delete "key_name" --namespace-id=5a8f67abf49546b58f6113e18a5b2443
```

---

## 制限事項

### Cloudflare Workers 無料プラン

| 項目 | 制限 |
|------|-----|
| リクエスト数 | 100,000 / 日 |
| CPU時間 | 10ms / リクエスト |
| メモリ | 128MB |
| サブリクエスト | 50 / リクエスト |
| KV読み取り | 100,000 / 日 |
| KV書き込み | 1,000 / 日 |
| KVストレージ | 1GB |

### 予約サイトの制約

#### 品川区

- **ログイン可能時間**: 3:15〜24:00（深夜メンテナンスあり）
- **予約可能期間**: 翌月末まで（最大60日程度）
- **予約上限**: サイトのルールに従う

#### 港区

- **ログイン可能時間**: 24時間
- **予約可能期間**: 翌々月5日まで（最大65日程度）
- **予約上限**: サイトのルールに従う

### PWA制限

- **Service Worker**: HTTPS必須
- **プッシュ通知**: 
  - iOS: ホーム画面に追加が必要
  - Android: 制限なし
- **オフライン**: 一部機能のみ（監視・予約は不可）

---

## トラブルシューティング

### サブリクエスト制限超過

**症状**: Cron実行時にエラー、予約失敗

**原因**: 50サブリクエスト/リクエストの制限を超過

**対処法**:
1. 監視ターゲット数を削減
2. バッチ処理のサイズを調整（現在: 5件/バッチ）
3. Workers Paid プランへアップグレード（$5/月）

### KV書き込み制限超過

**症状**: データ保存エラー

**原因**: 1,000書き込み/日の制限を超過

**対処法**:
1. `updateMonitoringTargetOptimized()` を使用（差分更新）
2. キャッシュヒット率を向上
3. 不要な更新を削減

### セッション期限切れ

**症状**: ログイン失敗、予約失敗

**原因**: 予約サイトのセッションが無効

**対処法**:
1. 3:15の自動リセットを待つ
2. 管理者パネルから手動リセット
3. ユーザーに再ログイン依頼

### プッシュ通知が届かない

**症状**: 通知が送信されない

**原因**: 
- サブスクリプション未登録
- VAPID鍵の不一致
- ブラウザの通知許可なし

**対処法**:
1. 設定でプッシュ通知を再有効化
2. 保守点検でテスト通知を送信
3. ブラウザの通知設定を確認

### 予約が取れない

**症状**: 空きがあるのに予約失敗

**原因**:
- 他のユーザーが先に予約
- セッション期限切れ
- 予約上限到達

**対処法**:
1. 集中監視モード（「取」検知）を活用
2. 5:00一斉予約を活用
3. 予約履歴でエラー詳細を確認

---

## パフォーマンス最適化

### KVメトリクス

システムは自動的にKV操作を最適化：

- **キャッシュヒット率**: 目標 50%以上
- **書き込みスキップ率**: 差分がない場合は書き込みスキップ
- **並列実行**: 空き状況チェックを5件ずつバッチ処理

### メトリクス確認

```bash
curl https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/metrics/kv
```

**レスポンス例**:
```json
{
  "reads": 150,
  "writes": 20,
  "cacheHits": 80,
  "cacheMisses": 70,
  "writesSkipped": 15,
  "cacheHitRate": 0.533,
  "writeSkipRate": 0.428,
  "elapsedMinutes": 60,
  "resetAt": 1764475916418
}
```

---

## 今後の拡張案

### 短期（1-3ヶ月）

1. **レート制限の実装**
   - IPベースの制限
   - ユーザーごとの制限

2. **通知のカスタマイズ**
   - 通知のON/OFF切り替え
   - 通知タイプ別の設定

3. **予約リマインダー**
   - 予約日の前日に通知

### 中期（3-6ヶ月）

1. **他地区への対応**
   - 世田谷区、目黒区など
   - 汎用的なスクレイパー

2. **予約の自動キャンセル**
   - 雨天時の自動キャンセル
   - 重複予約の整理

3. **グループ機能**
   - 複数人で予約を共有
   - 当番制の設定

### 長期（6ヶ月以上）

1. **AI予測機能**
   - 空き枠の出やすい時間帯を学習
   - 予約成功率の予測

2. **モバイルアプリ**
   - React Native版
   - より高度なプッシュ通知

3. **有料プラン**
   - 優先監視
   - 詳細な統計・分析

---

## 参考資料

### ドキュメント

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare KV: https://developers.cloudflare.com/kv/
- Next.js: https://nextjs.org/docs
- Web Push: https://web.dev/push-notifications-overview/

### リポジトリ

- GitHub: youshi-kanda/tennis_yoyaku

### ダッシュボード

- Cloudflare: https://dash.cloudflare.com
- Vercel: https://vercel.com

---

**この仕様書について**:  
この技術仕様書は、システムの実装内容に基づいて作成されています。変更や追加があった場合は、この文書も更新してください。

**最終更新**: 2025年11月30日  
**作成者**: システム開発チーム
