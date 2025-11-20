# テニスコート自動予約システム

品川区・港区のテニスコート予約を自動監視・予約するPWAアプリケーション

## 🎯 機能

### ✅ 実装完了
- **認証システム**: JWT認証、管理者/一般ユーザー
- **PWA**: Next.js 16 + TypeScript + Tailwind CSS
- **監視設定**: 施設・日時選択、自動予約ON/OFF
- **予約履歴**: 成功/失敗履歴の表示
- **設定画面**: 自治体ログイン情報管理
- **バックエンド**: Cloudflare Workers + KV
- **スクレイピング**: 空き状況監視(×→○検知)
- **自動予約**: 空き検知時の自動予約実行
- **Cronジョブ**: 60秒間隔の監視

### 🚧 TODO
- 品川区予約サイトの実際のスクレイピング実装
- 港区予約サイトの実際のスクレイピング実装
- Webプッシュ通知(VAPID設定)
- AWS Lambda集中監視(10秒間隔)
- Service Worker実装(PWA完全対応)

## 📁 プロジェクト構成

```
tennis_yoyaku/
├── pwa/                          # Next.js PWAフロントエンド
│   ├── app/
│   │   ├── page.tsx              # ログインページ
│   │   ├── register/page.tsx     # 登録ページ
│   │   ├── admin/page.tsx        # 管理者登録
│   │   └── dashboard/
│   │       ├── layout.tsx        # ダッシュボードレイアウト
│   │       ├── page.tsx          # ホーム画面
│   │       ├── monitoring/       # 監視設定
│   │       ├── history/          # 予約履歴
│   │       └── settings/         # 設定
│   ├── lib/
│   │   ├── api/client.ts         # APIクライアント
│   │   ├── hooks/useAuth.ts      # 認証フック
│   │   ├── stores/authStore.ts   # 状態管理
│   │   └── types/index.ts        # TypeScript型定義
│   └── .env.local                # 環境変数
├── workers/                       # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts              # メインハンドラー
│   │   ├── auth.ts               # JWT認証
│   │   └── scraper.ts            # スクレイピング
│   └── wrangler.toml             # Workers設定
└── docs/                         # 仕様書
    ├── FINAL_SPEC.md
    ├── INTENSIVE_MONITORING.md
    └── SESSION_STRATEGY.md
```

## 🚀 セットアップ

### 1. リポジトリのクローン
```bash
git clone https://github.com/youshi-kanda/tennis_yoyaku.git
cd tennis_yoyaku
```

### 2. PWAセットアップ
```bash
cd pwa
npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:8787" > .env.local
npm run dev
# → http://localhost:3001
```

### 3. Workersセットアップ
```bash
cd workers
npm install
npx wrangler dev --port 8787
# → http://localhost:8787
```

## 🔑 環境変数

### PWA (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:8787
```

### Workers (wrangler.toml)
```toml
[vars]
ENVIRONMENT = "development"
JWT_SECRET = "your-jwt-secret-here"
ADMIN_KEY = "tennis_admin_2025"
```

## 📡 API エンドポイント

### 認証
- `POST /api/auth/register` - ユーザー登録
- `POST /api/auth/login` - ログイン

### 監視
- `GET /api/monitoring/list` - 監視リスト取得
- `POST /api/monitoring/create` - 監視追加

### 履歴
- `GET /api/reservations/history` - 予約履歴取得

### ヘルスチェック
- `GET /api/health` - API稼働確認

## 🎨 技術スタック

### フロントエンド
- **Next.js 16** - App Router
- **TypeScript 5.x**
- **Tailwind CSS 3.x**
- **Zustand** - 状態管理
- **Axios** - HTTP client

### バックエンド
- **Cloudflare Workers** - サーバーレス
- **Workers KV** - データストア
- **Wrangler 3.x** - 開発ツール
- **Web Crypto API** - JWT/パスワードハッシュ

### 監視
- **Cron Triggers** - 定期実行(60秒)
- **AWS Lambda** - 集中監視(10秒) ※予定

## 🔐 認証フロー

1. ユーザー登録 → JWT発行
2. JWT検証 → 保護されたエンドポイントアクセス
3. トークンリフレッシュ(7日間有効)

### 管理者アカウント作成
```
/admin ページで管理者キーを入力
デフォルト: tennis_admin_2025
```

## 📊 データモデル

### MonitoringTarget
```typescript
{
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'active' | 'completed' | 'failed';
  autoReserve: boolean;
  lastCheck?: number;
  lastStatus?: '×' | '○';
}
```

### ReservationHistory
```typescript
{
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed';
  message?: string;
  createdAt: number;
}
```

## 🔄 監視フロー

1. **Cron (60秒毎)**
   - 全アクティブな監視ターゲット取得
   - 各ターゲットの空き状況チェック
   - 前回の状態と比較

2. **×→○検知**
   - 空きが見つかったらアラート
   - 自動予約ON → 予約実行
   - プッシュ通知送信

3. **予約実行**
   - 自治体サイトにログイン
   - 施設・日時選択
   - 予約確定
   - 履歴に保存

## 🧪 テスト方法

### 1. アカウント作成
```
http://localhost:3001/register
```

### 2. 監視設定
```
ダッシュボード → 監視設定 → 監視を追加
- 自治体選択: 品川区 or 港区
- 施設名入力
- 日時選択
- 自動予約ON/OFF
```

### 3. Cronログ確認
```bash
# Workersターミナルで確認
[Cron] Started: 2025-11-20T...
[Cron] Found 3 active monitoring targets
[Check] Target xxx: shinagawa - 東品川公園
[Check] Status: × → ○, Changed: true
[Alert] Availability changed!
[Reserve] Attempting reservation...
[Reserve] Result: SUCCESS
```

## 📝 次のステップ

1. **実際のスクレイピング実装**
   - 品川区: https://www.cm9.eprs.jp/shinagawa/web/
   - 港区: https://web101.rsv.ws-scs.jp/web/minato/

2. **プッシュ通知**
   - VAPID鍵生成
   - Service Worker登録
   - 通知送信実装

3. **AWS Lambda集中監視**
   - 10秒間隔チェック
   - Workers KVとの連携

4. **本番デプロイ**
   - Vercel (PWA)
   - Cloudflare Workers (API)
   - AWS Lambda (監視)

## 📄 ライセンス

MIT

## 👤 Author

youshi-kanda

## 🐛 Issue

https://github.com/youshi-kanda/tennis_yoyaku/issues
