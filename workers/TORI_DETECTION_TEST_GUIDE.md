# 「取」マーク検知テストガイド

## テスト対象
**12月13日（土） 八潮北公園 庭球場E 11:00~の「取」マーク**

スクリーンショットで確認済み：11:00~枠に「取」マークが表示されている

## 現在の実装状況

### ✅ 実装済み機能

#### 1. スクレイパーでの「取」マーク検知
**ファイル:** `workers/src/scraper.ts:183-383`

```typescript
// セルコンテンツから「取」マークを検出
if (cellContent.includes('取')) {
  status = '取';
}
```

- ✅ HTMLから「取」文字を検出
- ✅ ステータスとして `'取'` を設定
- ✅ 週間カレンダーから一括取得（品川区対応）

#### 2. 集中監視モードの自動起動
**ファイル:** `workers/src/index.ts:2344-2393`

```typescript
// 「取」検知時の処理
if (result.currentStatus === '取' && target.detectedStatus !== '取') {
  console.log(`[Alert] 🔥🔥🔥「取」検知！ ${target.facilityName} ${date} ${timeSlot}`);
  
  // 集中監視モードに移行
  target.detectedStatus = '取';
  target.nextIntensiveCheckTime = nextCheckTimeUTC.getTime();
  target.intensiveMonitoringDate = date;
  target.intensiveMonitoringTimeSlot = timeSlot;
  
  // プッシュ通知送信
  await sendPushNotification(target.userId, {
    title: '🔥「取」検知！集中監視開始',
    body: `${target.facilityName} ${date} ${timeSlot}\n次回: ${jstNextCheck.toLocaleTimeString('ja-JP')} (10分間隔)`,
    data: { targetId: target.id, type: 'status_tori_detected' }
  }, env);
}
```

- ✅ 「取」マーク検知で集中監視モードに自動移行
- ✅ 10分間隔で15秒間の高速チェック
- ✅ プッシュ通知送信

#### 3. 「取」→「○」変化の検知
**ファイル:** `workers/src/index.ts:2423-2439`

```typescript
// 「取」から「○」に変わった場合
if (target.detectedStatus === '取') {
  console.log(`[Alert] 🎉「取」→「○」変化検知！集中監視成功`);
  target.detectedStatus = '○';
  
  // 通知送信
  await sendPushNotification(target.userId, {
    title: '🎉「取」→「○」変化検知！',
    body: `${target.facilityName}\n${date} ${timeSlot}\nキャンセル待ちから空きになりました`,
    data: { type: 'tori_to_vacant', ... }
  }, env);
}
```

- ✅ キャンセル発生の瞬間を検知
- ✅ 即座に通知送信
- ✅ 自動予約実行（設定時）

## テスト手順

### 方法1: 本番環境で監視設定を作成してテスト（推奨）

1. **PWAにアクセス**
   - https://pwa-3416zboml-kys-projects-ed1892e5.vercel.app
   - ログイン

2. **監視設定を作成**
   ```
   日時設定:
   - モード: 単一日付
   - 日付: 2025-12-13
   - 時間帯: 11:00-13:00

   施設選択:
   - 品川区
   - 八潮北公園 庭球場E（ID: 10300050）

   詳細設定:
   - 自動予約: OFF（テスト用）
   - 通知: ON
   ```

3. **監視開始を待つ**
   - cron（毎分実行）が監視を開始
   - 「取」マーク検知でプッシュ通知が来る
   - 10分間隔の集中監視が始まる

4. **ログで確認**
   ```bash
   cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku/workers
   npx wrangler tail tennis-yoyaku-api --format pretty
   ```

   期待されるログ:
   ```
   [Shinagawa Weekly] ⚡ 取: 2025-12-13_11:00-13:00
   [Alert] 🔥🔥🔥「取」検知！ 八潮北公園 庭球場Ｅ 2025-12-13 11:00-13:00
   [Alert] 集中監視モード開始 - 10分間隔で15秒間の1秒間隔チェック
   ```

### 方法2: 手動で品川区サイトを確認

1. **ブラウザで品川区予約サイトにアクセス**
   - https://cm9.eprs.jp/shinagawa/web/rsv

2. **ログイン**
   - 品川区の利用者ID/パスワード

3. **週間表示で確認**
   - 「予約」→「週間表示」
   - 施設: 八潮北公園 庭球場E
   - 日付: 12月13日（土）
   - 11:00~の枠を目視確認

4. **HTMLソースを確認**
   - ブラウザの開発者ツールでHTMLを表示
   - 11:00~のセルに「取」という文字列が含まれているか確認

### 方法3: Workersのログから過去の検知結果を確認

```bash
cd /Users/youshi/Desktop/projects/COCONARA/tennis_yoyaku/workers

# KVから監視設定を確認
npx wrangler kv key get "monitoring:all_targets" \
  --namespace-id=5a8f67abf49546b58f6113e18a5b2443 | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
for t in data:
    if '八潮北公園' in t.get('facilityName', ''):
        print(f'施設: {t[\"facilityName\"]}')
        print(f'  status: {t.get(\"status\")}')
        print(f'  detectedStatus: {t.get(\"detectedStatus\")}')
        print(f'  日付: {t.get(\"date\", t.get(\"startDate\"))}')
        print()
"
```

## 期待される動作

### 「取」マーク検知時
1. ✅ `status = '取'` として保存される
2. ✅ `detectedStatus = '取'` に更新される
3. ✅ プッシュ通知「🔥「取」検知！集中監視開始」が送信される
4. ✅ 10分間隔の集中監視がスケジュールされる
5. ✅ ログに `[Shinagawa Weekly] ⚡ 取: 2025-12-13_11:00-13:00` が出力される

### 「取」→「○」変化検知時
1. ✅ `detectedStatus = '○'` に更新される
2. ✅ プッシュ通知「🎉「取」→「○」変化検知！」が送信される
3. ✅ 自動予約が実行される（autoReserve=ONの場合）
4. ✅ ログに `[Alert] 🎉「取」→「○」変化検知！` が出力される

## トラブルシューティング

### 「取」マークが検知されない場合

1. **HTMLの構造を確認**
   - セルに「取」という文字列が含まれているか
   - セルID形式が `id="YYYYMMDD_HHMM-HHMM"` か

2. **セッションの有効性を確認**
   - ログに「Login failed or session expired」が出ていないか
   - 品川区サイトに手動ログインできるか

3. **施設IDの確認**
   - 八潮北公園 庭球場E = `10300050`
   - 正しい施設IDが設定されているか

4. **日付フォーマットの確認**
   - `2025-12-13` 形式で正しく設定されているか

## 次のステップ

### 機能追加の検討
- [ ] `/api/availability/shinagawa` エンドポイントの実装
- [ ] 申込人数のパース（「取(○名)」から数値を抽出）
- [ ] 「取」マーク専用の通知設定オプション
- [ ] 「取」→「○」変化の予測機能

### 監視精度の向上
- [ ] 集中監視の最適化（間隔調整）
- [ ] 複数枠の同時監視対応
- [ ] ネットワークエラー時のリトライ処理

## 参考情報

### 関連ファイル
- `workers/src/scraper.ts` - スクレイパー実装
- `workers/src/index.ts` - メインロジック
- `workers/src/pushNotification.ts` - 通知送信

### 関連ドキュメント
- `workers/SHINAGAWA_RESERVATION_FLOW_ANALYSIS.md` - 品川区予約フロー分析
- `workers/WEEKLY_CALENDAR_INVESTIGATION.md` - 週間カレンダー調査

### デバッグコマンド
```bash
# ログ監視
npx wrangler tail tennis-yoyaku-api --format pretty

# 監視設定確認
npx wrangler kv key get "monitoring:all_targets" --namespace-id=5a8f67abf49546b58f6113e18a5b2443

# セッション確認
npx wrangler kv key list --namespace-id=2111997ed58e4f5080074fc0a95cacf0 | head -20
```
