# デプロイ手順

## 1. Vercel へのデプロイ

### 前提条件
- Vercelアカウント作成済み
- Vercel CLI インストール済み (`npm i -g vercel`)

### デプロイ手順

1. **Vercel CLI でログイン**
```bash
vercel login
```

2. **プロジェクトをデプロイ**
```bash
cd pwa
vercel
```

初回は以下の質問に答える:
- Set up and deploy? → `Y`
- Which scope? → 自分のアカウント選択
- Link to existing project? → `N`
- What's your project's name? → `tennis-yoyaku`
- In which directory? → `./` (Enter)
- Override settings? → `N`

3. **環境変数を設定**

Vercel ダッシュボードで設定:
```
NEXT_PUBLIC_API_URL=https://your-workers-api.workers.dev
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BJl4G42CTnBBIz0YBhm2yZSPEgyNjXjBnjEXZwT1g0hCiHIGYesl8ePExqj9zcl7kBqRqug9rvg9qLTEtC1KjyQ
```

または CLI で:
```bash
vercel env add NEXT_PUBLIC_API_URL
vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY
```

4. **本番デプロイ**
```bash
vercel --prod
```

## 2. Cloudflare Workers へのデプロイ

### 前提条件
- Cloudflare アカウント作成済み
- Wrangler CLI インストール済み

### デプロイ手順

1. **Wrangler でログイン**
```bash
cd workers
npx wrangler login
```

2. **KV ネームスペースを作成**
```bash
npx wrangler kv:namespace create "USERS"
npx wrangler kv:namespace create "SESSIONS"
npx wrangler kv:namespace create "MONITORING"
npx wrangler kv:namespace create "RESERVATIONS"
```

出力された ID を `wrangler.toml` に追加:
```toml
[[kv_namespaces]]
binding = "USERS"
id = "your_kv_id_here"
```

3. **環境変数を設定**

`wrangler.toml` に以下が設定済みか確認:
```toml
[vars]
JWT_SECRET = "your-secure-jwt-secret-key-here-change-in-production"
ADMIN_KEY = "tennis_admin_2025"
VAPID_PUBLIC_KEY = "BJl4G42CTnBBIz0YBhm2yZSPEgyNjXjBnjEXZwT1g0hCiHIGYesl8ePExqj9zcl7kBqRqug9rvg9qLTEtC1KjyQ"
VAPID_PRIVATE_KEY = "M3GGZhN2hN2Df1GlKD8cLBQGqU3JBdVW4whF7hb_aTI"
VAPID_SUBJECT = "mailto:youshi.kanda@example.com"
```

**本番環境用には必ずシークレットを変更してください!**

4. **CORS設定を追加**

`src/index.ts` のCORS設定でVercelのドメインを許可:
```typescript
const allowedOrigins = [
  'https://tennis-yoyaku.vercel.app',  // 本番ドメイン
  'http://localhost:3001'
];
```

5. **デプロイ**
```bash
npx wrangler deploy
```

6. **Cronトリガーを確認**

Cloudflare Dashboard > Workers > tennis-yoyaku > Triggers で
Cron Triggers が設定されているか確認 (`* * * * *` = 毎分実行)

## 3. デプロイ後の確認

### PWA (Vercel)
- https://tennis-yoyaku.vercel.app にアクセス
- Service Worker が登録されているか確認 (DevTools > Application > Service Workers)
- PWA インストールプロンプトが表示されるか確認

### API (Workers)
- https://your-workers-api.workers.dev/health にアクセス
- `{"status":"ok"}` が返るか確認

### プッシュ通知
1. 設定画面でプッシュ通知を有効化
2. ブラウザの通知許可を承認
3. 監視設定を追加
4. 空きが検知されたら通知が届くか確認

## トラブルシューティング

### ビルドエラー
```bash
npm run build
```
でローカルビルドを確認

### API接続エラー
- CORS設定を確認
- 環境変数 `NEXT_PUBLIC_API_URL` が正しいか確認
- Workers が正常にデプロイされているか確認

### プッシュ通知が届かない
- ブラウザの通知許可を確認
- Service Worker が正常に登録されているか確認
- VAPID鍵が正しく設定されているか確認

## セキュリティ注意事項

本番環境では必ず以下を変更してください:
- `JWT_SECRET`: 強力なランダム文字列に変更
- `ADMIN_KEY`: 推測困難なキーに変更
- VAPID鍵: 本番用に新しい鍵を生成
