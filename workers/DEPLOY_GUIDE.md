# Workers デプロイガイド

## 環境分離について

本プロジェクトでは、開発環境と本番環境でKV namespaceを分離しています。

### 環境の種類

| 環境 | Workers名 | KV Namespace | 用途 |
|-----|----------|--------------|-----|
| **Development** | `tennis-yoyaku-api-dev` | 開発用（`*_DEV`） | テスト・開発 |
| **Production** | `tennis-yoyaku-api` | 本番用 | 本番運用 |

### KV Namespace ID一覧

#### Production
- USERS: `2bb51589e95d448abc4f6821a5898865`
- SESSIONS: `2111997ed58e4f5080074fc0a95cacf0`
- MONITORING: `5a8f67abf49546b58f6113e18a5b2443`
- RESERVATIONS: `6e26433ee30b4ad0bc0a8749a67038be`

#### Development
- USERS: `c0d3c217a6544bcabe55d2a489d35158`
- SESSIONS: `940200cc91dc45af854bde2ff274ea94`
- MONITORING: `29eca291199b4570a451fe20775f11ee`
- RESERVATIONS: `272a3a9914bd407e9389ca2d8ef907db`

---

## デプロイコマンド

### 開発環境にデプロイ
```bash
npm run deploy:dev
# または
npx wrangler deploy --env development --compatibility-date=2024-01-01
```

### 本番環境にデプロイ
```bash
npm run deploy
# または
npx wrangler deploy --compatibility-date=2024-01-01
```

---

## ローカル開発

### 開発環境で起動
```bash
npm run dev
# または
npx wrangler dev --env development
```

### 本番設定で起動
```bash
npm run dev:prod
# または
npx wrangler dev
```

---

## ログ監視

### 開発環境のログ
```bash
npm run tail:dev
# または
npx wrangler tail --env development
```

### 本番環境のログ
```bash
npm run tail
# または
npx wrangler tail
```

---

## デプロイ確認

### デプロイ履歴確認（本番）
```bash
npx wrangler deployments list
```

### デプロイ履歴確認（開発）
```bash
npx wrangler deployments list --env development
```

---

## 🎯 推奨ワークフロー

### 1. 機能開発時
```bash
# 開発環境で起動
npm run dev

# コード変更

# 開発環境にデプロイしてテスト
npm run deploy:dev

# 開発環境のログ確認
npm run tail:dev
```

### 2. 本番デプロイ時
```bash
# 開発環境で十分テスト完了後

# コミット
git add -A
git commit -m "feat: 新機能追加"
git push

# 本番環境にデプロイ
cd workers
npm run deploy

# 本番ログ監視
npm run tail
```

---

## ⚠️ 注意事項

### KV上限について
- **無料プラン**: 1,000回/日の書き込み制限
- **開発環境**: テスト時は開発用KVを使用（本番上限を消費しない）
- **本番環境**: 本番運用のみ使用

### 環境変数の違い
| 変数 | Development | Production |
|-----|-------------|------------|
| ENVIRONMENT | `development` | `production` |
| JWT_SECRET | `dev-jwt-secret-for-testing-only` | 本番用シークレット |
| VAPID_SUBJECT | `youshi.kanda+dev@example.com` | `youshi.kanda@example.com` |

### Cron設定
- 開発・本番ともに `*/1 * * * *`（1分間隔）
- 開発環境でもCronは実行されるので注意

---

## 🔧 トラブルシューティング

### デプロイエラー: "namespace already exists"
→ `wrangler.toml`の設定を確認。環境別のbinding名が正しいか確認。

### KV書き込み上限エラー
→ 開発環境を使用しているか確認。本番環境を使っている場合は開発環境に切り替え。

### Cronが実行されない
→ 有料プランの場合のみCronが有効。無料プランではCron Triggersは実行されません。

---

**最終更新**: 2025年11月25日  
**バージョン**: 1.0.0
