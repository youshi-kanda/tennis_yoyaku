# テニスコート自動予約システム v1.1

品川区・港区のテニスコート予約を自動監視・予約するPWAアプリケーション  
**最新機能**: 品川区「取」マーク集中監視の最適化（10分単位・1秒間隔・リソース95%削減）

## 📚 ドキュメント

### ✅ 最新・正確なドキュメント
- **[README.md](./README.md)** - このファイル（v1.1対応）
- **[CLIENT_MANUAL.md](./CLIENT_MANUAL.md)** ⭐ **クライアント向けマニュアル**（v1.1対応）
  - システムの使い方・機能説明
  - 集中監視の詳細説明
  - PWA操作ガイド
- **[SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md)** - システム概要（v1.1対応）
  - アーキテクチャ
  - 技術スタック
  - データ構造
- **[RELEASE_NOTES.md](./RELEASE_NOTES.md)** - リリースノート（v1.1追加済み）
- **[USER_GUIDE.md](./USER_GUIDE.md)** - エンドユーザー向けガイド
- **[UNIFIED_SPEC.md](./UNIFIED_SPEC.md)** - 統一仕様書

### 📋 参考資料（一部古い情報を含む可能性）
- [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) - v2.0時点の実装詳細
- [TECHNICAL_SPECIFICATION.md](./TECHNICAL_SPECIFICATION.md) - 技術仕様書
- [API_SPECIFICATION.md](./API_SPECIFICATION.md) - API仕様
- [OPERATIONS_TASKS.md](./OPERATIONS_TASKS.md) - 運用タスク

## 🚀 最新バージョン (v1.1)

**リリース日**: 2025年11月30日  
**主な変更**: 集中監視最適化、カレンダーUI改善、並列処理強化

### ✨ 新機能
- ✅ **品川区「取」マーク集中監視の最適化**: 10分単位の前後15秒間を1秒間隔でチェック、リソース使用量95%削減
- ✅ **明確な終了条件**: 予約成功・取マーク消失・予約時刻到達で自動的に通常監視に復帰
- ✅ **並列処理の維持**: 集中監視中も他のターゲットは独立して動作
- ✅ **カレンダー4色ステータス表示**: 監視中🔵、空き検知🟡、予約成功🟢、予約失敗🔴
- ✅ **設定画面UI改善**: 折りたたみ式カードで見やすく
- ✅ **3ステップウィザードUI**: 施設選択→日時設定→詳細設定の直感的なフロー

### 🚀 パフォーマンス
- ✅ **KV最適化**: list()操作完全排除（配列管理に移行）
- ✅ **メモリキャッシュ**: セッション5分、監襶3分 TTL
- ✅ **有料プラン**: Cloudflare Workers Paid ($5/月)
  - KV書き込み: 無制限
  - サブリクエスト: 1,000/実行
  - CPU時間: 30秒/実行

## 🎯 機能

### コア機能
- **認証システム**: JWT認証、管理者/一般ユーザー
- **PWA**: Next.js 15 + TypeScript + Tailwind CSS
- **監視設定**: 柔軟なカスタマイズ（期間・時間帯・施設）
- **予約履歴**: 成功/失敗履歴の表示
- **設定画面**: 自治体ログイン情報管理、予約上限設定
- **バックエンド**: Cloudflare Workers + KV（配列管理）
- **スクレイピング**: 空き状況監視(×→○検知)
- **集中監視**: 品川区「取」マーク検知時、10分単位の前後15秒間を1秒間隔で監視
- **自動予約**: 空き検知時の自動予約実行
- **Cronジョブ**: 1分間隔の監視、並列処理対応
- **プッシュ通知**: Web Push API対応

### 🚧 実装予定
- Priority 3: 通知・UI改善
  - リアルタイム通知強化
  - 監視状況の可視化
  - モバイルアプリ最適化
- Priority 4: データ管理・分析
  - 監視テンプレート機能
  - 予約分析レポート
  - データエクスポート

## 📁 プロジェクト構成

```
tennis_yoyaku/
├── pwa/                           # Next.js 15 PWA（Vercel）
│   ├── app/dashboard/
│   │   ├── monitoring/            # 監視設定（期間・時間帯・施設選択）
│   │   ├── history/               # 予約履歴表示
│   │   └── settings/              # 認証情報・予約上限設定
│   ├── lib/
│   │   ├── api/client.ts          # APIクライアント
│   │   ├── hooks/                 # カスタムフック
│   │   ├── stores/authStore.ts    # Zustand状態管理
│   │   └── types/index.ts         # TypeScript型定義
│   └── public/
│       ├── manifest.json          # PWA設定
│       └── service-worker.js      # オフライン対応
├── workers/                       # Cloudflare Workers（バックエンド）
│   ├── src/
│   │   ├── index.ts               # API + Cron（配列管理、優先度処理）
│   │   ├── auth.ts                # JWT認証
│   │   └── scraper.ts             # 空き検知・自動予約
│   └── wrangler.toml              # Workers設定
└── docs/                          # ドキュメント
    ├── IMPLEMENTATION_SUMMARY.md  # 実装サマリー（v2.0）
    ├── USER_GUIDE.md              # ユーザーガイド
    ├── FINAL_SPEC.md              # 最終仕様書
    ├── OPERATIONS_TASKS.md        # 運用タスク・既知の制限事項 ⭐
    └── UX_IMPROVEMENT_TASKS.md    # 改善タスクリスト
```

## � ドキュメント

- **[実装サマリー](./IMPLEMENTATION_SUMMARY.md)**: v2.0の実装詳細と技術仕様
- **[ユーザーガイド](./USER_GUIDE.md)**: 使い方・設定方法の詳細説明
- **[最終仕様書](./FINAL_SPEC.md)**: システム全体の設計仕様
- **[改善タスク](./UX_IMPROVEMENT_TASKS.md)**: 実装済み・予定の改善項目

## �🚀 セットアップ

### 前提条件
- Node.js 18以上
- npm または yarn
- Cloudflare アカウント（Workers/KV）
- Vercel アカウント（PWAデプロイ用）

### 1. リポジトリのクローン
```bash
git clone https://github.com/youshi-kanda/tennis_yoyaku.git
cd tennis_yoyaku
```

### 2. Workers デプロイ
```bash
cd workers
npm install
npx wrangler login
npx wrangler kv:namespace create USERS
npx wrangler kv:namespace create MONITORING_CACHE
npx wrangler kv:namespace create HISTORY
npx wrangler deploy
```

### 3. PWA デプロイ（Vercel）
```bash
cd pwa
npm install
# Vercel CLIまたはGitHub連携でデプロイ
vercel --prod
```

### 4. 環境変数設定

**PWA (.env.local)**:
```env
NEXT_PUBLIC_API_URL=https://tennis-yoyaku-api.kanda02-1203.workers.dev
```

**Workers (wrangler.toml)**:
```toml
[vars]
ENVIRONMENT = "production"
JWT_SECRET = "your-strong-jwt-secret-here"
ADMIN_KEY = "tennis_admin_2025"
```

## 🌐 本番環境

- **PWA URL**: https://pwa-pzltv277c-kys-projects-ed1892e5.vercel.app
- **API URL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **Workers Version**: `2ba19ef2-99be-4226-b908-637611248554`
- **Cron実行**: 1分間隔（*/1 * * * *）
- **集中監視**: 品川区「取」マーク検知時に10分単位でピンポイント監視

## 📡 主要APIエンドポイント

### 認証
- `POST /api/auth/register` - ユーザー登録
- `POST /api/auth/login` - ログイン（JWT発行）

### 監視
- `GET /api/monitoring/list` - 監視リスト取得
- `POST /api/monitoring/create` - 監視追加（期間・時間帯・優先度対応）
- `DELETE /api/monitoring/{id}` - 監視削除

### 設定
- `GET /api/settings` - ユーザー設定取得
- `POST /api/settings` - 設定保存（認証情報・予約上限）

### 履歴
- `GET /api/reservations/history` - 予約履歴取得

### ヘルスチェック
- `GET /api/health` - API稼働確認

詳細は[実装サマリー](./IMPLEMENTATION_SUMMARY.md)を参照してください。

## 🎨 技術スタック

### フロントエンド
- **Next.js 15** - App Router
- **TypeScript 5.x**
- **Tailwind CSS 3.x**
- **Zustand** - 状態管理
- **Axios** - HTTP client
- **PWA** - Service Worker + Manifest

### バックエンド
- **Cloudflare Workers** - サーバーレス実行環境
- **Workers KV** - 配列管理によるデータストア
- **Wrangler 3.x** - 開発・デプロイツール
- **Web Crypto API** - JWT/パスワードハッシュ

### 監視・実行
- **Cron Triggers** - 5分間隔の定期実行
- **優先度キュー** - 重要度順の予約処理
- **メモリキャッシュ** - KV読み取り削減（51%減）

## 🔐 セキュリティ

- **JWT認証**: 7日間有効、HS256署名
- **パスワードハッシュ**: bcrypt相当の強度
- **管理者権限**: 専用キーによる分離
- **CORS**: オリジン検証

## ⚠️ 運用上の注意事項

### 施設データについて
現在、品川区・港区の施設リストは**ハードコードされたフォールバックデータ**を使用しています。これは実際のアカウント権限に基づく正確なデータです。

- **品川区**: 13コート（4施設）
- **港区**: 10コート（3施設）

将来的に施設の追加・変更がある場合は、[OPERATIONS_TASKS.md](./OPERATIONS_TASKS.md) を参照して手動更新が必要です。

### 予約可能期間の管理

予約可能期間は施設ごとに異なり、動的に変更される可能性があります。

#### 現在の設定（2025年11月実測値）
- **品川区**: 30日間（約1ヶ月先まで予約可能）
- **港区**: 60日間（約2ヶ月先まで予約可能）

#### 自動検出の仕組み
システムは以下の優先順位で予約可能期間を判定します:

1. **HTMLからの自動抽出** (最優先)
   - ヘルプページから「○ヶ月先まで」などのテキストを検出
   - カレンダーUIのmax-date属性を解析
   - 成功時: KVに24時間キャッシュ

2. **KVキャッシュの利用** (セカンダリ)
   - 24時間以内に取得した期間情報を再利用
   - サブリクエスト削減による効率化

3. **デフォルト値の使用** (フォールバック)
   - HTML抽出が失敗した場合のバックアップ
   - 実測値に基づく固定値を使用

#### 期間変更時の対応手順

**自動更新される場合**（推奨）:
- システムが自動的にHTMLから新しい期間を検出
- 特別な対応は不要

**手動更新が必要な場合**:
1. ファイル: `workers/src/reservationPeriod.ts`
2. 関数: `getFallbackPeriod()`
3. 変更箇所:
```typescript
function getFallbackPeriod(site: 'shinagawa' | 'minato'): ReservationPeriodInfo {
  const defaultDays = site === 'shinagawa' ? 30 : 60;  // ← この値を変更
  // ...
}
```

4. デプロイ:
```bash
cd workers
npx wrangler deploy
```

5. KVキャッシュのクリア（即座に反映させる場合）:
```bash
npx wrangler kv:key delete "reservation_period:shinagawa" --namespace-id=YOUR_NAMESPACE_ID
npx wrangler kv:key delete "reservation_period:minato" --namespace-id=YOUR_NAMESPACE_ID
```

#### 監視方法

ログで期間検出状況を確認:
```bash
npx wrangler tail tennis-yoyaku-api --format pretty
```

確認ポイント:
- `[Period] Using cached period for shinagawa: XX days (html_extraction)` ← 自動検出成功
- `[Period] Using cached period for shinagawa: XX days (fallback)` ← デフォルト値使用
- `[Check] 継続監視: 予約可能期間=XX日`

詳細は **[運用タスク管理（OPERATIONS_TASKS.md）](./OPERATIONS_TASKS.md)** を参照してください。

## 📊 主要データモデル

### MonitoringTarget（v2.0）
```typescript
{
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  
  // 期間指定（v2.0で追加）
  date: string;              // 後方互換性
  startDate?: string;        // 期間開始日
  endDate?: string;          // 期間終了日（未設定=継続監視）
  
  // 時間帯（v2.0で追加）
  timeSlot: string;          // 後方互換性
  timeSlots?: string[];      // 複数時間帯対応
  
  // 優先度（v2.0で追加）
  priority?: number;         // 1-5レベル（デフォルト: 3）
  
  status: 'active' | 'completed' | 'failed';
  autoReserve: boolean;
  strategy?: string;
  lastCheck?: number;
  lastStatus?: '×' | '○';
}
```

### UserSettings（v2.0）
```typescript
{
  credentials: {
    shinagawa: { loginId: string; password: string };
    minato: { loginId: string; password: string };
  };
  // 予約上限（v2.0で追加）
  reservationLimits?: {
    perWeek?: number;     // 週あたりの上限
    perMonth?: number;    // 月あたりの上限
  };
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

## 🔄 監視フロー（v2.0最適化版）

### 1. Cron実行（5分間隔）
```
1. KVから`monitoring:all_targets`配列を取得
2. メモリキャッシュで重複チェック回避（3分TTL）
3. 優先度順にソート（高→低→古い順）
4. 各監視対象をチェック
```

### 2. 空き検知（×→○）
```
1. 期間内の全日付×時間帯をチェック
2. 空きを発見
3. 予約上限チェック（週/月）
4. 優先度の高い順に予約実行
5. プッシュ通知送信
```

### 3. KV最適化
```
- list()操作を完全排除
- 配列管理でread/write削減
- メモリキャッシュで重複アクセス防止
- 結果: reads 51%削減、writes 87%削減
```

## 🎯 使い方

### クイックスタート
1. **アカウント作成**: [PWAアプリ](https://pwa-pzltv277c-kys-projects-ed1892e5.vercel.app)にアクセス
2. **認証情報設定**: 設定画面で品川区/港区のログイン情報を保存
3. **監視設定**: 期間・時間帯・施設を選択して監視開始
4. **予約上限設定**: 週/月の予約回数上限を設定
5. **履歴確認**: ダッシュボードで予約成功/失敗を確認

詳細は[ユーザーガイド](./USER_GUIDE.md)を参照してください。

## 📝 開発ロードマップ

### ✅ v2.0（現在のバージョン）
- Priority 1: 監視設定の柔軟化（完了）
- Priority 2: 予約戦略の強化（完了）
- KV最適化（Phase 1.5完了）

### 🚧 v2.1（予定）
- Priority 3: 通知・UI改善
  - リアルタイム通知強化
  - 監視状況の可視化
  - モバイル最適化
- Priority 4: データ管理・分析
  - 監視テンプレート
  - 予約分析レポート

### 🔮 v3.0（構想）
- AWS Lambda集中監視（10秒間隔）
- 機械学習による予約成功率予測
- 複数ユーザー間の協調予約

## 🤝 コントリビューション

Issue、Pull Request歓迎です。大きな変更の場合は、事前にIssueで議論をお願いします。

## 📄 ライセンス

MIT License

## 👤 開発者

**youshi-kanda**
- GitHub: [@youshi-kanda](https://github.com/youshi-kanda)

## 🔗 リンク

- **本番環境**: https://pwa-pzltv277c-kys-projects-ed1892e5.vercel.app
- **API**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **Issue**: https://github.com/youshi-kanda/tennis_yoyaku/issues
- **ユーザーガイド**: [USER_GUIDE.md](./USER_GUIDE.md)
- **実装サマリー**: [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md)

---

**v1.1.0 | リリース日: 2025年11月30日 | 集中監視最適化・カレンダーUI改善**
