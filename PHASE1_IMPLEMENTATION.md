# フェーズ1実装: 無料プラン案A - 集中監視機能

## 📋 実装概要

**実装日**: 2025年11月25日  
**目的**: 無料プランで「取→○」の集中監視を実現  
**コスト**: $0/月（無料枠内）

---

## 🎯 実装内容

### 1. Cron間隔の変更
**変更前**: 5分間隔 (`*/5 * * * *`)  
**変更後**: 1分間隔 (`*/1 * * * *`)

**影響**:
- リクエスト数: 288回/日 → 1,440回/日
- 無料枠: 100,000回/日（余裕あり）

### 2. 集中監視ロジック実装

#### 2.1 集中監視モード判定
```typescript
// 10分刻み(10, 20, 30...)の前後2分間を集中監視
// 例: 10:08, 10:09, 10:10, 10:11, 10:12
const minutes = now.getMinutes();
const isIntensiveMode = (minutes % 10 >= 8) || (minutes % 10 <= 2);
```

#### 2.2 「取」ステータス検知
```typescript
if (result.currentStatus === '取' && target.detectedStatus !== '取') {
  // 次の10分刻み時刻を計算
  let nextTenMinuteMark = Math.ceil((currentMinutes + 1) / 10) * 10;
  
  // 集中監視終了時刻: 目標時刻の+2分後まで
  const intensiveUntil = new Date(targetTime.getTime() + 2 * 60 * 1000);
  
  // ターゲットを更新
  target.detectedStatus = '取';
  target.intensiveMonitoringUntil = intensiveUntil.getTime();
  
  // プッシュ通知送信
  await sendPushNotification(target.userId, {
    title: '🔥「取」検知！集中監視開始',
    body: `${target.facilityName} ${date} ${timeSlot}`,
    data: { targetId: target.id, type: 'status_tori_detected' }
  });
}
```

#### 2.3 集中監視対象の優先処理
```typescript
// 集中監視対象をフィルタ
const intensiveTargets = targets.filter(t => 
  t.detectedStatus === '取' && 
  t.intensiveMonitoringUntil && 
  t.intensiveMonitoringUntil > Date.now()
);

// 集中監視対象を優先処理
for (const target of sortedIntensiveTargets) {
  await checkAndNotify(target, env, true); // 集中監視フラグ
}
```

### 3. データ構造の拡張

#### MonitoringTarget に追加フィールド
```typescript
export interface MonitoringTarget {
  // 既存フィールド...
  
  // 新規追加
  detectedStatus?: '×' | '取' | '○';  // 検知したステータス
  intensiveMonitoringUntil?: number;   // 集中監視の終了時刻（timestamp）
}
```

---

## 📊 期待される効果

### リクエスト数の試算

#### 通常監視
- 頻度: 1分間隔
- 回数: 1,440回/日
- 対象: 全ターゲット

#### 集中監視
- 頻度: 1分間隔（10分刻み前後2分間のみ）
- 回数: 最大 5回 × 12セット = 60回/日/ターゲット
- 対象: 「取」検知済みターゲットのみ

**合計**: 約1,440〜1,500回/日（無料枠100,000回/日の1.5%）

### 検知精度の向上

| 項目 | 変更前（5分間隔） | 変更後（1分間隔 + 集中監視） |
|-----|------------------|---------------------------|
| 通常監視間隔 | 5分 | 1分 |
| 集中監視間隔 | なし | 1分（10分刻み前後2分間） |
| 「取→○」検知精度 | 低（5分遅れの可能性） | 高（最大1分遅れ） |
| 10:10:00の枠取得確率 | 低 | 中〜高 |

**実用性**:
- ✅ 品川区の「取→○」は通常10:10:00ぴったりに変わる
- ✅ 10:08, 10:09, 10:10, 10:11, 10:12の5回チェックで十分カバー
- ✅ 10:10:00〜10:11:00の間に検知可能（実用上問題なし）

---

## 🚀 デプロイ手順

### 1. 事前確認
```bash
cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku/workers
cat wrangler.toml | grep crons
# 出力: crons = ["*/1 * * * *"]
```

### 2. デプロイ
```bash
cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku
git add -A
git commit -m "feat: フェーズ1実装 - 無料プラン集中監視機能

- Cron間隔を5分→1分に変更
- 「取」ステータス検知機能追加
- 10分刻み前後2分間の集中監視実装
- detectedStatus, intensiveMonitoringUntil フィールド追加
- プッシュ通知「取」検知対応"

git push
cd workers
npx wrangler deploy --compatibility-date=2024-01-01
```

### 3. デプロイ確認
```bash
npx wrangler deployments list
```

### 4. ログ監視
```bash
npx wrangler tail --format pretty
```

---

## 🧪 テストシナリオ

### シナリオ1: 通常監視
1. 監視ターゲット作成（品川区、テニスコート、明日の日付）
2. 1分待機
3. ログ確認: `[Cron] 📋 通常監視モード`
4. KVメトリクス確認: 書き込み回数が最小限

### シナリオ2: 「取」検知と集中監視
1. 監視ターゲット作成
2. スクレイピングで「取」ステータスを返すようにテスト
3. ログ確認:
   - `[Alert] 🔥「取」検知: ... - 集中監視モード開始`
   - `集中監視: 現在 XX:XX:XX, 目標 XX:X0:00, 終了 XX:X2:00`
4. プッシュ通知確認: 「🔥「取」検知！集中監視開始」
5. 10分刻み前後2分間のログ確認:
   - `[Cron] 🔥 集中監視モード: 分=8`
   - `[Cron] 集中監視対象: 1件`
   - `[Cron] 🔥 集中監視チェック: ...`

### シナリオ3: 「取→○」変化検知
1. 集中監視中のターゲットがある状態
2. スクレイピングで「○」ステータスを返す
3. ログ確認:
   - `[Alert] 🎉「取」→「○」変化検知！集中監視成功`
   - `[Alert] ✅ Available: ...`
4. 自動予約実行確認

### シナリオ4: 集中監視期間終了
1. 集中監視中のターゲットがある状態
2. `intensiveMonitoringUntil` 時刻を過ぎる
3. ログ確認:
   - `[Alert] 集中監視期間終了: ...`
4. `detectedStatus`, `intensiveMonitoringUntil` がクリアされる

---

## 📝 注意事項

### 1. 時刻のJST変換
- Workers はUTC時刻で動作
- JST変換: `new Date(now.getTime() + 9 * 60 * 60 * 1000)`
- ログには必ずJST時刻を表示

### 2. KV書き込み最小化
- 集中監視モード開始時のみ書き込み
- 通常チェック時は書き込みスキップ
- ユーザー単位の一括更新（`MONITORING:{userId}`）

### 3. プッシュ通知
- 新しい通知タイプ: `status_tori_detected`
- フロントエンドでの対応が必要

### 4. 後方互換性
- 既存の`lastStatus`フィールドは維持
- 新しい`detectedStatus`フィールドは任意

---

## 🔄 次のステップ（フェーズ2）

### クライアント要件との差分
| 項目 | フェーズ1（現状） | クライアント要件 | フェーズ2（Durable Objects） |
|-----|-----------------|----------------|----------------------------|
| 通常監視 | 1分間隔 | 数秒〜数十秒 | 5秒間隔 |
| 集中監視 | 1分間隔 | 秒単位 | 1-2秒間隔 |
| コスト | $0/月 | - | $5-7/月 |

### フェーズ2実装時の変更点
1. Durable Objects 導入
2. 秒単位ループの実装
3. Workers Paid へのアップグレード

---

## 📊 メトリクス

### デプロイ前
- Cron間隔: 5分
- リクエスト: 288回/日
- KV書き込み: 最適化済み

### デプロイ後
- Cron間隔: 1分
- 予想リクエスト: 1,440〜1,500回/日
- KV書き込み: 変更なし（最適化済み）

### 成功指標
- ✅ Cronが1分間隔で実行される
- ✅ 「取」検知時にプッシュ通知が送信される
- ✅ 10分刻み前後2分間に集中監視ログが出る
- ✅ KV書き込み上限に達しない
- ✅ 「取→○」の変化を1分以内に検知

---

**最終更新**: 2025年11月25日  
**バージョン**: Phase 1.0.0  
**ステータス**: 実装完了、デプロイ待ち
