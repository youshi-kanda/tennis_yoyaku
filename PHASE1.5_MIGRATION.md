# Phase 1.5 データマイグレーションスクリプト

## 概要
個別キー管理から配列管理への移行用スクリプト

## 実行タイミング
KV制限リセット後（明日 2025-02-01 09:00 UTC 0:00）

## マイグレーション手順

### 1. 監視ターゲットのマイグレーション

```bash
# Wrangler経由でKVを操作
cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku/workers

# 既存の個別キーをリスト表示
npx wrangler kv:key list --namespace-id=5a8f67abf49546b58f6113e18a5b2443 --prefix=target:

# 各キーの内容を確認
npx wrangler kv:key get "target:user-id:target-id" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# 全ターゲットを取得して配列作成（手動）
# または以下のNode.jsスクリプトを使用
```

### 2. Node.jsマイグレーションスクリプト

```javascript
// migrate-to-arrays.js
const https = require('https');

const API_URL = 'https://tennis-yoyaku-api.kanda02-1203.workers.dev';
const ADMIN_TOKEN = 'your-admin-token-here'; // 管理者トークン

async function migrateMonitoringTargets() {
  // 既存の個別データを全て取得（API経由は難しいため、Wrangler KV操作推奨）
  console.log('Migration completed manually via Wrangler KV commands');
}

migrateMonitoringTargets();
```

### 3. 手動マイグレーション（推奨）

現状データが少ない（テストアカウント1つ）ため、手動で対応：

1. **既存データの確認**
```bash
# 監視ターゲット確認
npx wrangler kv:key list --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# 予約履歴確認
npx wrangler kv:key list --namespace-id=6e26433ee30b4ad0bc0a8749a67038be
```

2. **新規データは自動的に配列形式で保存される**
   - 新しい監視追加 → `monitoring:all_targets`に配列追加
   - 新しい予約 → `history:{userId}`に配列追加

3. **既存の個別キーは削除不要**
   - 新コードは個別キーを参照しない
   - 自然に古いデータは使われなくなる
   - 必要に応じて後で削除

### 4. 初期データ作成（空配列）

KVリセット後、以下のキーを初期化：

```bash
# 空の監視配列を作成
npx wrangler kv:key put "monitoring:all_targets" "[]" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# ユーザーごとの空予約履歴配列は自動作成されるため不要
```

## 確認事項

Phase 1.5デプロイ後：

1. ✅ `getAllActiveTargets()` - list()を使わずget()のみ
2. ✅ `getUserReservations()` - list()を使わずget()のみ
3. ✅ `handleMonitoringList()` - list()を使わずget()のみ
4. ✅ `handleMonitoringCreate()` - 配列に追加
5. ✅ `updateMonitoringTargetOptimized()` - 配列を更新
6. ✅ `attemptReservation()` - 配列に追加
7. ✅ `handleReservationHistory()` - list()を使わずget()のみ

## テスト手順（KVリセット後）

```bash
# 1. 初期化
npx wrangler kv:key put "monitoring:all_targets" "[]" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# 2. ログインしてトークン取得
curl -X POST https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"84005349","password":"Aa1234567890"}'

# 3. 監視リスト取得テスト（list()使わない）
curl https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/monitoring/list \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. 監視作成テスト（配列に追加）
curl -X POST https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/monitoring/create \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "site": "shinagawa",
    "facilityId": "facility-1",
    "facilityName": "しながわ中央公園コートA",
    "date": "2025-02-15",
    "timeSlot": "09:00-11:00",
    "autoReserve": false
  }'

# 5. KVメトリクス確認（list()が0回であることを確認）
curl https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/metrics/kv
```

## 期待結果

- list()操作: 0回
- reads: 大幅削減（目標: 979/日）
- writes: 大幅削減（目標: 86/日）
- エラーなし

## ロールバック手順

問題が発生した場合：

```bash
# Phase 1のバージョンに戻す
cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku/workers
git revert HEAD
npm run deploy
```

前バージョン: `6c8ea614-6762-4e15-ad70-c7fc5431680c`
