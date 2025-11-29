# テニスコート自動予約システム v2.0

品川区・港区のテニスコート予約を自動監視・予約するPWAアプリケーション

## � ドキュメント

- **[統一仕様書（UNIFIED_SPEC.md）](./UNIFIED_SPEC.md)** ⭐ **最新・正式版**
  - システム全体の統一仕様
  - 監視間隔、セッション管理、データモデルの正確な定義
  - 実装とドキュメントの矛盾を解消
  
- [システム概要（SYSTEM_OVERVIEW.md）](./SYSTEM_OVERVIEW.md) - 補足資料
- [README.md](./README.md) - このファイル

### 参考資料（部分的に古い情報を含む）
- [FINAL_SPEC.md](./FINAL_SPEC.md) - 1分監視の提案（現在は5分）
- [INTENSIVE_MONITORING.md](./INTENSIVE_MONITORING.md) - Lambda実装（未実装）
- [SPECIFICATION.md](./SPECIFICATION.md) - 初期技術調査
- [SESSION_STRATEGY.md](./SESSION_STRATEGY.md) - セッション管理

## �🚀 最新バージョン (v2.0)

**リリース日**: 2025年11月24日  
**主な変更**: 優先度機能削除、ウィザードUI実装、仕様書統一

### ✨ 新機能
- ✅ **3ステップウィザードUI**: 施設選択→日時設定→詳細設定の直感的なフロー
- ✅ **設定プレビュー**: 右側サイドバーで設定内容をリアルタイム表示
- ✅ **期間指定機能**: 単一日付・期間指定・継続監視の3モード
- ✅ **時間帯カスタマイズ**: 6つの時間帯を自由に選択
- ✅ **施設個別選択**: 地区別に施設を個別選択可能
- ✅ **シンプル予約**: 優先度機能を削除、選択施設すべてを自動予約

### 🚀 パフォーマンス
- ✅ **KV最適化**: list()操作完全排除（配列管理に移行）
- ✅ **メモリキャッシュ**: セッション5分、監視3分 TTL
- ✅ **KV使用量削減**: reads 51%削減、writes 87%削減
- ✅ **24施設対応**: 無料プラン内で運用可能

## 🎯 機能

### コア機能
- **認証システム**: JWT認証、管理者/一般ユーザー
- **PWA**: Next.js 15 + TypeScript + Tailwind CSS
- **監視設定**: 柔軟なカスタマイズ（期間・時間帯・施設）
- **予約履歴**: 成功/失敗履歴の表示
- **設定画面**: 自治体ログイン情報管理、予約上限設定
- **バックエンド**: Cloudflare Workers + KV（配列管理）
- **スクレイピング**: 空き状況監視(×→○検知)
- **自動予約**: 空き検知時の自動予約実行
- **Cronジョブ**: 5分間隔の監視（優先度順）
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
- **Workers Version**: `4000f861-7b0f-4af6-964b-4902b5445544`
- **Cron実行**: 5分間隔（*/5 * * * *）

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

**v2.0.0 | リリース日: 2025年11月23日**
