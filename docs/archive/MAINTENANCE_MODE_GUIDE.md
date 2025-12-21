# メンテナンスモード・監視一括制御 ガイド

## 概要

システム改修時やメンテナンス時に、ユーザーの監視を一時停止し、管理者のみが操作できる状態にするための機能です。

- **メンテナンスモード**: Cron実行時の監視処理を完全にスキップ
- **監視一括制御**: 全ユーザーの監視設定を一括で停止/再開
- **管理者UI制御**: 管理画面からボタン操作で制御可能

---

## 機能説明

### 1. メンテナンスモード

**目的**: システムの監視処理を完全に停止し、管理者のみが操作できる状態にする

**動作**:
- Cron実行時（毎分 + 5AM一斉処理）に、メンテナンス状態をチェック
- メンテナンスモード有効時は、全ての監視処理をスキップ
- 管理者はAPIへのアクセス・操作が引き続き可能

**制御方法**:
1. **KVベース（即時反映、推奨）**: 
   - 管理画面から「メンテナンスモード有効化」ボタンをクリック
   - KV Namespace (`MONITORING`) に `SYSTEM:MAINTENANCE` キーで状態を保存
   - 次回のCron実行時から即座に有効化

2. **環境変数（完全な制御）**:
   - `wrangler.toml` の `MAINTENANCE_MODE` 変数を `true` に変更
   - Workersを再デプロイ
   - より確実にメンテナンスモードを強制

### 2. 監視一括制御

**目的**: 全ユーザーの監視設定を一括で停止/再開

**動作**:
- 全ユーザーのKVデータ (`MONITORING:{userId}`) を読み取り
- 各監視ターゲットのステータスを `active` ⇔ `paused` に変更
- データは保持されるため、再開時は元の設定で監視が再開

**制御方法**:
- 管理画面から「全監視を一括停止」「全監視を一括再開」ボタンをクリック

---

## 使い方

### 管理画面からの操作

1. **管理者ダッシュボードにアクセス**
   ```
   https://pwa-epo103cmq-kys-projects-ed1892e5.vercel.app/dashboard/admin
   ```

2. **「保守点検」カードをクリック**
   ```
   /dashboard/admin/maintenance
   ```

3. **現在の状態を確認**
   - メンテナンスモード: 有効/無効
   - 監視設定状態: 全X件 (アクティブ: Y件 / 停止中: Z件)

4. **操作を実行**

#### システム改修時（推奨手順）

**停止手順**:
1. 「メンテナンスモード有効化」ボタンをクリック
   - メンテナンスメッセージを入力（任意）
   - 「実行」をクリック
   - ✅ 次回のCron実行時から監視がスキップされる

2. 「全監視を一括停止」ボタンをクリック
   - 確認ダイアログで「実行」をクリック
   - ✅ 全ユーザーの監視設定が停止状態になる

**復旧手順**:
1. 「全監視を一括再開」ボタンをクリック
   - 確認ダイアログで「実行」をクリック
   - ✅ 停止していた監視設定が再開される

2. 「メンテナンスモード無効化」ボタンをクリック
   - 確認ダイアログで「実行」をクリック
   - ✅ 次回のCron実行時から監視が再開される

---

## 技術仕様

### Backend (Workers)

#### 環境変数

```toml
# wrangler.toml
[vars]
MAINTENANCE_MODE = "false"  # メンテナンスモード: true=有効, false=無効
MAINTENANCE_MESSAGE = "システムメンテナンス中です。しばらくお待ちください。"
```

#### API エンドポイント

| Method | Endpoint | 説明 | 管理者専用 |
|--------|----------|------|-----------|
| GET    | `/api/admin/maintenance/status` | メンテナンス状態取得 | ✅ |
| POST   | `/api/admin/maintenance/enable` | メンテナンス有効化 | ✅ |
| POST   | `/api/admin/maintenance/disable` | メンテナンス無効化 | ✅ |
| POST   | `/api/admin/monitoring/pause-all` | 全監視一括停止 | ✅ |
| POST   | `/api/admin/monitoring/resume-all` | 全監視一括再開 | ✅ |

#### データ構造

**KVキー**: `SYSTEM:MAINTENANCE`

```json
{
  "enabled": true,
  "message": "システムメンテナンス中です。しばらくお待ちください。",
  "enabledAt": 1736845200000,
  "enabledBy": "admin"
}
```

#### Cron処理フロー

```typescript
// 1. メンテナンスモードチェック
const maintenanceJson = await env.MONITORING.get('SYSTEM:MAINTENANCE');
const isMaintenanceMode = maintenanceJson ? JSON.parse(maintenanceJson).enabled : false;

if (isMaintenanceMode) {
  console.log('[Cron] 🛠️ メンテナンスモード有効 - 監視スキップ');
  return;  // 全ての監視処理をスキップ
}

// 2. 通常の監視処理
// ...
```

### Frontend (PWA)

#### 管理画面

**パス**: `/dashboard/admin/maintenance`

**機能**:
- メンテナンス状態表示
- 監視設定状態表示
- メンテナンスモード有効化/無効化ボタン
- 全監視一括停止/再開ボタン
- 確認ダイアログ

#### API Client

```typescript
// pwa/lib/api/client.ts

// メンテナンス状態取得
async getMaintenanceStatus()

// メンテナンス有効化
async enableMaintenance(message?: string)

// メンテナンス無効化
async disableMaintenance()

// 全監視一括停止
async pauseAllMonitoring()

// 全監視一括再開
async resumeAllMonitoring()
```

---

## 注意事項

### メンテナンスモード

⚠️ **重要**: 管理画面からの有効化/無効化は、KVベースの動的制御です。

- **即時反映**: 次回のCron実行時（最大1分後）から有効化
- **完全な制御**: より確実にメンテナンスを強制したい場合は、`wrangler.toml` の `MAINTENANCE_MODE` を `true` に変更してWorkersを再デプロイしてください

### 監視一括制御

✅ **データ保持**: 監視設定のデータは保持されるため、再開時は元の設定で監視が再開されます

⚠️ **処理時間**: 監視ターゲットが多い場合、処理に数秒かかる場合があります

### 復旧時の手順

1. **全監視一括再開** → 全ユーザーの監視設定を再開
2. **メンテナンスモード無効化** → Cron実行時の監視処理を再開

この順序で実行することで、スムーズに復旧できます。

---

## デプロイ情報

### 最新デプロイ

- **Workers Version**: `cf91e252-6a47-4361-a612-186954c3f594`
- **PWA URL**: https://pwa-epo103cmq-kys-projects-ed1892e5.vercel.app
- **API URL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **デプロイ日時**: 2025-01-14

### Git情報

- **コミット**: `cead9a7`
- **メッセージ**: "Add maintenance mode and bulk monitoring control"

---

## トラブルシューティング

### メンテナンスモードが効かない

**原因**: KVベースの制御が反映されていない可能性

**対処法**:
1. Workersログを確認: `[Cron] 🛠️ メンテナンスモード有効` が出力されているか
2. `wrangler.toml` の `MAINTENANCE_MODE` を `true` に変更して再デプロイ

### 全監視一括停止後、再開できない

**原因**: ネットワークエラーやAPI障害

**対処法**:
1. 管理画面から再度「全監視を一括再開」を実行
2. それでも失敗する場合は、各ユーザーの監視設定を個別に確認

### 管理者も監視できない

**原因**: メンテナンスモードは全ユーザー（管理者含む）の監視をスキップ

**対処法**:
- メンテナンスモードを無効化してから監視を再開

---

## まとめ

メンテナンスモードと監視一括制御機能により、システム改修時に以下が可能になりました:

✅ **ユーザーの監視を一時停止** - 全監視一括停止
✅ **Cron実行をスキップ** - メンテナンスモード有効化
✅ **管理者は引き続き操作可能** - API認証は継続
✅ **ワンクリック復旧** - 管理画面からボタン操作で再開
✅ **データ保持** - 監視設定はそのまま保持

これにより、安全かつ効率的にシステムメンテナンスを実施できます。
