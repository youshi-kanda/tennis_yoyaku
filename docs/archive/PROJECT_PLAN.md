# プロジェクト実装計画 - PWA版自動予約システム

**作成日**: 2025年11月20日  
**対象**: 品川区・港区テニスコート自動予約システム  
**実装形態**: PWA (Progressive Web App)

---

## 📋 目次

1. [プロジェクト概要](#プロジェクト概要)
2. [技術スタック](#技術スタック)
3. [開発フェーズ](#開発フェーズ)
4. [詳細タスクリスト](#詳細タスクリスト)
5. [スケジュール](#スケジュール)
6. [コスト見積もり](#コスト見積もり)

---

## プロジェクト概要

### システム構成

```
┌──────────────────────────────────────────────┐
│          PWA フロントエンド (スマホ最適化)       │
│      - Next.js + TypeScript + Tailwind        │
│      - Service Worker + Push通知              │
│      - オフライン対応                           │
└─────────────┬────────────────────────────────┘
              │
              │ HTTPS API
              ▼
┌──────────────────────────────────────────────┐
│     Cloudflare Workers (メイン監視)           │
│      - 通常監視（60秒間隔、×→○）               │
│      - セッション管理（5:00-24:00維持）         │
│      - 24時間対応（3:15リセット、5:00再ログイン）│
└─────────────┬────────────────────────────────┘
              │
              │ Workers KV
              ▼
┌──────────────────────────────────────────────┐
│       AWS Lambda (集中監視)                   │
│      - 10秒間隔監視（取→○）                    │
│      - 10分ごとにトリガー                       │
│      - 5:00特別対応                            │
└─────────────┬────────────────────────────────┘
              │
              │ HTTP POST
              ▼
┌──────────────────────────────────────────────┐
│    品川区・港区予約システム                     │
│      - 空き状況監視                            │
│      - 自動予約実行                            │
└──────────────────────────────────────────────┘
```

### 主要機能

#### 1. 24時間監視
- ✅ 5:00-24:00: セッション維持しながら監視
- ✅ 24:00-3:15: セッション維持試行、なければ5:00まで待機
- ✅ 3:15-5:00: 監視のみ、予約は5:00に実行
- ✅ 5:00:00: 待機中の予約を一斉実行

#### 2. PWA機能
- ✅ スマホにインストール可能
- ✅ プッシュ通知（予約成功/失敗/検知）
- ✅ オフライン対応
- ✅ ホーム画面アイコン

#### 3. 自動予約
- ✅ 品川区5段階フロー
- ✅ 港区対応（規約同意なし）
- ✅ 複数施設・複数時間帯対応
- ✅ 優先度設定

---

## 技術スタック

### フロントエンド (PWA)

```json
{
  "framework": "Next.js 14 (App Router)",
  "language": "TypeScript",
  "styling": "Tailwind CSS + shadcn/ui",
  "pwa": "next-pwa",
  "state": "Zustand + React Query",
  "notification": "Web Push API",
  "offline": "Service Worker + IndexedDB"
}
```

#### ディレクトリ構成

```
tennis-yoyaku-pwa/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── register/
│   ├── dashboard/
│   │   ├── page.tsx          # メインダッシュボード
│   │   ├── settings/
│   │   ├── history/
│   │   └── monitoring/
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── ui/                    # shadcn/ui コンポーネント
│   ├── monitoring/
│   │   ├── StatusCard.tsx
│   │   ├── FacilityList.tsx
│   │   └── ReservationHistory.tsx
│   ├── settings/
│   │   ├── FacilitySelector.tsx
│   │   ├── NotificationSettings.tsx
│   │   └── ScheduleSettings.tsx
│   └── layout/
│       ├── Header.tsx
│       ├── Navigation.tsx
│       └── BottomNav.tsx      # スマホ用ボトムナビ
├── lib/
│   ├── api/                   # Workers API クライアント
│   ├── hooks/                 # カスタムフック
│   ├── stores/                # Zustand ストア
│   └── utils/
├── public/
│   ├── manifest.json          # PWA マニフェスト
│   ├── icons/                 # アプリアイコン
│   └── sw.js                  # Service Worker
├── styles/
│   └── globals.css
├── next.config.js
├── tailwind.config.js
└── package.json
```

### バックエンド

```json
{
  "runtime": "Cloudflare Workers",
  "plan": "Paid ($5/月)",
  "storage": "Workers KV",
  "scheduler": "Cron Triggers (1分間隔推奨)",
  "language": "TypeScript",
  "framework": "Native Workers API"
}
```

#### Workers ディレクトリ構成

```
workers/
├── src/
│   ├── index.ts               # メインエントリ
│   ├── handlers/
│   │   ├── auth.ts            # 認証ハンドラ
│   │   ├── monitoring.ts      # 監視ハンドラ
│   │   ├── reservation.ts     # 予約ハンドラ
│   │   └── notification.ts    # 通知ハンドラ
│   ├── services/
│   │   ├── shinagawa.ts       # 品川区スクレイピング
│   │   ├── minato.ts          # 港区スクレイピング
│   │   ├── session.ts         # セッション管理
│   │   └── kv.ts              # KV操作
│   ├── types/
│   │   └── index.ts
│   └── utils/
│       ├── encoding.ts        # Shift_JIS変換
│       └── parser.ts          # HTMLパース
├── wrangler.toml
└── package.json
```

---

## 開発フェーズ

### Phase 1: 基盤構築 (Week 1-2)

#### Week 1: 環境構築
- [ ] **Day 1-2**: Next.js PWA プロジェクトセットアップ
  - next-pwa 設定
  - Tailwind + shadcn/ui 導入
  - TypeScript 設定
  - ESLint + Prettier
  
- [ ] **Day 3-4**: Cloudflare Workers セットアップ
  - Hono フレームワーク導入
  - Workers KV Namespace 作成
  - wrangler.toml 設定
  - ローカル開発環境

- [ ] **Day 5-7**: 認証・基本UI
  - ログイン画面（スマホ最適化）
  - ダッシュボード基本レイアウト
  - ボトムナビゲーション
  - Workers 認証API

#### Week 2: コア機能実装
- [ ] **Day 8-10**: スクレイピング実装
  - 品川区ログイン・空き検索
  - 港区ログイン・空き検索
  - HTML パース処理
  - Shift_JIS 変換

- [ ] **Day 11-12**: セッション管理
  - 24時間対応ロジック
  - 5:00自動ログイン
  - 3:15リセット対応
  - KVセッション保存

- [ ] **Day 13-14**: 通常監視実装
  - 60秒Cronトリガー
  - ×→○検知
  - Workers KV統合
  - エラーハンドリング

---

### Phase 2: 集中監視とPWA (Week 3-4)

#### Week 3: 集中監視機能強化
- [ ] **Day 15-17**: 集中監視実装（Cloudflare Workers）
  - 「取」ステータス検知ロジック
  - 10分刻み前後の高頻度チェック（1分間隔）
  - Cron間隔の最適化
  - 取→○即座予約

- [ ] **Day 18-19**: 予約フロー実装
  - 品川区5段階フロー
  - 港区予約フロー
  - エラーリトライ
  - 成功/失敗通知

- [ ] **Day 20-21**: 5:00特別対応
  - 4:59:58トリガー
  - 待機予約一斉実行
  - 優先度処理

#### Week 4: PWA機能
- [ ] **Day 22-24**: Service Worker
  - オフライン対応
  - キャッシュ戦略
  - バックグラウンド同期
  - アップデート通知

- [ ] **Day 25-26**: Push通知
  - Web Push API統合
  - 通知許可UI
  - 通知設定画面
  - 通知テスト

- [ ] **Day 27-28**: UI仕上げ
  - 監視状態表示
  - 予約履歴
  - 設定画面
  - レスポンシブ調整

---

### Phase 3: テストと最適化 (Week 5)

#### Week 5: 品質保証
- [ ] **Day 29-30**: ユニットテスト
  - Workers ロジックテスト
  - Lambda テスト
  - UI コンポーネントテスト

- [ ] **Day 31-32**: E2Eテスト
  - Playwright設定
  - 予約フローテスト
  - PWAテスト（インストール、通知）

- [ ] **Day 33**: パフォーマンス最適化
  - Lighthouse 90+達成
  - 画像最適化
  - コード分割

- [ ] **Day 34**: セキュリティ対策
  - 認証情報暗号化
  - CSP設定
  - Rate limiting

- [ ] **Day 35**: ステージングテスト
  - 24時間監視テスト
  - 実際のサイトで動作確認

---

## 詳細タスクリスト

### 1. プロジェクト構成とドキュメント整理
- [x] SPECIFICATION.md 作成
- [x] INTENSIVE_MONITORING.md 作成
- [x] SESSION_STRATEGY.md 作成
- [ ] PROJECT_PLAN.md 作成（本ドキュメント）
- [ ] PWA要件整理
- [ ] API仕様書作成

### 2. PWAフロントエンド環境構築

```bash
# Next.js プロジェクト作成
npx create-next-app@latest tennis-yoyaku-pwa --typescript --tailwind --app

cd tennis-yoyaku-pwa

# PWA対応
npm install next-pwa
npm install -D @types/service-worker

# UI ライブラリ
npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu
npx shadcn-ui@latest init

# 状態管理・API
npm install zustand @tanstack/react-query axios
npm install date-fns zod

# アイコン
npm install lucide-react
```

#### PWA設定ファイル

```typescript
// next.config.js
const withPWA = require('next-pwa')({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
});

module.exports = withPWA({
  // Next.js config
});
```

```json
// public/manifest.json
{
  "name": "テニスコート予約自動化",
  "short_name": "テニス予約",
  "description": "品川区・港区のテニスコート自動予約システム",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#10b981",
  "orientation": "portrait",
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

### 3. 認証・ユーザー管理機能

#### Workers KV スキーマ

```typescript
// ユーザー情報
interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  settings: UserSettings;
}

interface UserSettings {
  shinagawa: {
    username: string;
    password: string; // 暗号化
    facilities: string[];
  };
  minato: {
    username: string;
    password: string; // 暗号化
    facilities: string[];
  };
  notifications: {
    pushEnabled: boolean;
    types: NotificationType[];
  };
  monitoring: {
    enabled: boolean;
    autoReserve: boolean;
  };
}

// KV keys
users:{userId} -> User
sessions:{sessionId} -> { userId, expiresAt }
site_sessions:shinagawa:{userId} -> { jsessionid, expiresAt }
site_sessions:minato:{userId} -> { jsessionid, expiresAt }
pending_reservations:{userId} -> PendingReservation[]
reservation_history:{userId} -> ReservationRecord[]
```

### 4. Cloudflare Workers バックエンド実装

```bash
# Workers プロジェクト作成
npm create cloudflare@latest workers -- tennis-yoyaku-workers

cd workers
npm install hono
npm install @cloudflare/workers-types
npm install iconv-lite cheerio
```

#### Hono API 構造

```typescript
// src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { jwt } from 'hono/jwt';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());
app.use('/api/*', jwt({ secret: 'SECRET' }));

// 認証
app.post('/auth/login', authHandler.login);
app.post('/auth/register', authHandler.register);

// 監視
app.get('/api/monitoring/status', monitoringHandler.getStatus);
app.post('/api/monitoring/start', monitoringHandler.start);
app.post('/api/monitoring/stop', monitoringHandler.stop);

// 予約
app.get('/api/reservations', reservationHandler.getHistory);
app.post('/api/reservations', reservationHandler.create);

// 設定
app.get('/api/settings', settingsHandler.get);
app.put('/api/settings', settingsHandler.update);

// Cron（内部トリガー）
export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    await runMonitoring(env, ctx);
  },
};
```

### 5. 集中監視機能実装 (Cloudflare Workers)

**目的**: 品川区の「取」ステータスが10分刻みで「○」に変わる瞬間を監視

**実装方針**:
```typescript
// workers/src/index.ts に追加
interface IntensiveMonitoringTarget {
  nextCheckTime: number;  // 次の10分刻み時刻
  isIntensive: boolean;   // 集中監視モード中
}

// Cron実行時に判定
if (現在時刻が10分刻み前後2分) {
  // 高頻度チェック（1分Cron）
}
```

### 6. 予約フロー実装

品川区5段階フローの詳細実装は `SPECIFICATION.md` 参照。

### 7. PWA通知機能実装

```typescript
// Service Worker (public/sw.js)
self.addEventListener('push', (event) => {
  const data = event.data.json();
  
  self.registration.showNotification(data.title, {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    tag: data.tag,
    requireInteraction: data.requireInteraction,
  });
});

// フロントエンド通知登録
async function subscribeToPush() {
  const registration = await navigator.serviceWorker.ready;
  
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: PUBLIC_VAPID_KEY,
  });
  
  // Workers に送信して保存
  await fetch('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}
```

### 8-16. その他タスク

詳細は上記の開発フェーズとタスクリストを参照。

---

## スケジュール

### 概要

| フェーズ | 期間 | タスク |
|---------|------|--------|
| Phase 1: 基盤構築 | Week 1-2 | 環境構築、認証、スクレイピング、セッション管理 |
| Phase 2: 機能実装 | Week 3-4 | Lambda、予約フロー、PWA機能 |
| Phase 3: 品質保証 | Week 5 | テスト、最適化、デプロイ |

### 詳細スケジュール

```
Week 1: 環境構築とコア実装
├─ Day 1-2:  Next.js PWA セットアップ
├─ Day 3-4:  Cloudflare Workers セットアップ
├─ Day 5-7:  認証・基本UI
└─ 成果物:   ログイン可能なPWA + Workers API基盤

Week 2: スクレイピングと監視
├─ Day 8-10:  品川区・港区スクレイピング
├─ Day 11-12: セッション管理（24時間対応）
├─ Day 13-14: 通常監視（60秒）
└─ 成果物:    ×→○検知動作、セッション維持

Week 3: 集中監視と予約
├─ Day 15-17: Workers集中監視機能
├─ Day 18-19: 予約フロー実装
├─ Day 20-21: 5:00特別対応
└─ 成果物:    取→○検知、自動予約動作

Week 4: PWA機能完成
├─ Day 22-24: Service Worker + オフライン
├─ Day 25-26: Push通知
├─ Day 27-28: UI仕上げ
└─ 成果物:    完全動作するPWA

Week 5: 品質保証
├─ Day 29-30: ユニットテスト
├─ Day 31-32: E2Eテスト
├─ Day 33:    パフォーマンス最適化
├─ Day 34:    セキュリティ対策
├─ Day 35:    ステージングテスト
└─ 成果物:    本番デプロイ準備完了
```

---

## コスト見積もり

### 開発コスト

```
前提: 1人開発、1日8時間作業

Week 1-2 (基盤構築):    10日 × 8時間 = 80時間
Week 3-4 (機能実装):    10日 × 8時間 = 80時間
Week 5   (品質保証):    5日 × 8時間  = 40時間
──────────────────────────────────────────
合計:                   200時間

時給換算 (例: ¥5,000/時):
開発費用: 200時間 × ¥5,000 = ¥1,000,000
```

### 運用コスト（月額）

```
Cloudflare Workers:
- リクエスト:     無料枠内
- KV 読み取り:    無料枠内
- KV 書き込み:    $0.50/月

Cloudflare Workers (有料プラン):
- 月額費用:       $5/月
- リクエスト:     10M/月（実質無制限）
- KV書き込み:    無制限

PWA ホスティング:
- Vercel/Cloudflare Pages: 無料枠内

プッシュ通知:
- Firebase Cloud Messaging: 無料

──────────────────────────────────────────
合計:             $0.54/月 ≈ ¥82/月
```

### 追加で必要なもの

1. **ドメイン**: ¥1,000-2,000/年
2. **SSL証明書**: Cloudflare Pages なら無料
3. **監視ツール**: 無料枠で十分（CloudWatch, Workers Analytics）

---

## 次のステップ

### 即座に開始できるタスク

1. **Next.js PWA プロジェクト作成**
   ```bash
   npx create-next-app@latest tennis-yoyaku-pwa --typescript --tailwind --app
   ```

2. **Cloudflare Workers プロジェクト作成**
   ```bash
   npm create cloudflare@latest workers
   ```

3. **Cloudflare Workers 設定確認**
   - 有料プラン契約済み ($5/月)
   - Cron Triggers 設定

4. **デザインシステム決定**
   - shadcn/ui コンポーネント選定
   - カラースキーム決定
   - アイコンセット準備

### 質問事項

- [ ] デザインの希望（カラー、テーマ）
- [ ] 対応デバイス（iOS/Android バージョン）
- [ ] ユーザー数規模の想定
- [ ] テスト用アカウントの準備

---

**ドキュメント管理**
- 最終更新: 2025年11月20日
- 作成者: GitHub Copilot
- レビュー: 未実施
