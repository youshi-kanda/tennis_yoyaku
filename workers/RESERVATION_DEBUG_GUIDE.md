# 予約実行デバッグガイド

**作成日**: 2025年11月30日  
**目的**: 予約実行時のレスポンスHTMLを確認して正しい成功判定文字列を特定する

---

## ✅ 実装完了

### デバッグログの追加

**品川区** (`workers/src/scraper.ts: 402行付近`):
- レスポンスHTMLの最初の3000文字をログ出力
- キーワード検索（予約、完了、受付、成功、失敗、エラー、満室、空き、予約済）
- 各キーワードの前後50文字のコンテキストを表示
- 現在の成功判定結果を表示

**港区** (`workers/src/scraper.ts: 1195行付近`):
- 同様のデバッグログ
- 予約受付番号の正規表現パターンテスト（4種類）
- マッチ結果の詳細表示

### デプロイ完了

**Workers Version**: `48740d43-b2c3-4fb2-8815-4bcd5db210d8`  
**デプロイ日時**: 2025年11月30日

---

## 🚀 使い方

### 方法1: 自動監視スクリプト（推奨）

```bash
cd workers
./watch-reservation-debug.sh
```

**機能**:
- 予約実行時のログをリアルタイム監視
- レスポンスHTML検出時にハイライト表示
- キーワード検索結果を強調表示
- 重要なヒントを表示

**表示例**:
```
========================================
🔍 予約実行デバッグログ監視
========================================

監視中... (Ctrl+C で終了)

[2025-11-30 15:23:45] [Reserve] Attempting reservation for target xxx
[2025-11-30 15:23:46] [Shinagawa] Making reservation: ...
[2025-11-30 15:23:47] [Shinagawa] 🔍 DEBUG: Response HTML length: 15234
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔥 レスポンスHTMLを検出！上記のログを確認してください
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[2025-11-30 15:23:47] [Shinagawa] 🔍 DEBUG: Response HTML (first 3000 chars): <!DOCTYPE html>...
[2025-11-30 15:23:47] [Shinagawa] 🔍 DEBUG: Keyword search results:
[2025-11-30 15:23:47]   - "予約" found at 1234: ...ご予約ありがとうございます...
[2025-11-30 15:23:47]   - "完了" found at 1256: ...予約が完了しました...
```

### 方法2: 手動でログ確認

```bash
cd workers
npx wrangler tail --format pretty | grep -E "(DEBUG|Reserve|Reservation)"
```

---

## 🔍 確認すべきログ

### 予約実行時に表示されるログ

#### 1. レスポンスHTMLの先頭3000文字
```
[Shinagawa] 🔍 DEBUG: Response HTML (first 3000 chars): <!DOCTYPE html>...
```
**確認内容**:
- 「予約」「完了」などのキーワードがあるか
- HTMLの構造
- メッセージの全文

#### 2. キーワード検索結果
```
[Shinagawa] 🔍 DEBUG: Keyword search results:
  - "予約" found at 1234: ...ご予約ありがとうございます...
  - "完了" found at 1256: ...予約が完了しました...
  - "受付" found at 1280: ...受付番号: 12345...
```
**確認内容**:
- どのキーワードが見つかったか
- キーワード周辺のテキスト（実際のメッセージ）

#### 3. 成功判定の結果
```
[Shinagawa] 🔍 DEBUG: Success check - 予約が完了しました: true
[Shinagawa] ✅ Reservation successful
```
または
```
[Shinagawa] 🔍 DEBUG: Success check - 予約が完了しました: false
[Shinagawa] ❌ Reservation failed - success keywords not found
[Shinagawa] 💡 HINT: Check the DEBUG logs above to find the actual success message
```

#### 4. 港区の予約受付番号パターン
```
[Minato] 🔍 DEBUG: Reservation ID pattern search:
  - 予約受付番号: MATCHED - "予約受付番号：12345" (ID: 12345)
  - 受付番号: NOT MATCHED
  - 予約番号: NOT MATCHED
```

---

## 📝 成功メッセージの特定方法

### ステップ1: キーワード検索結果を確認

ログから以下の情報を探す:
```
  - "予約" found at XXX: ...実際のメッセージ...
  - "完了" found at XXX: ...実際のメッセージ...
```

### ステップ2: 実際の成功メッセージを特定

**例1**: 品川区
```
  - "予約" found at 1234: ...ご予約を受け付けました。ありがとうございます...
```
→ 実際のメッセージは **「ご予約を受け付けました」**

**例2**: 港区
```
  - "完了" found at 1256: ...予約受付が完了いたしました...
```
→ 実際のメッセージは **「予約受付が完了いたしました」**

### ステップ3: コードを修正

#### 品川区の場合
```typescript
// workers/src/scraper.ts: 420行付近

// 修正前
if (reserveHtml.includes('予約が完了しました') || reserveHtml.includes('予約を受け付けました')) {

// 修正後（実際のメッセージに変更）
if (reserveHtml.includes('ご予約を受け付けました') || reserveHtml.includes('予約が完了しました')) {
```

#### 港区の場合
```typescript
// workers/src/scraper.ts: 1230行付近

// 修正前
if (completeHtml.includes('予約が完了しました') || completeHtml.includes('予約受付番号')) {

// 修正後（実際のメッセージに変更）
if (completeHtml.includes('予約受付が完了いたしました') || completeHtml.includes('予約受付番号')) {
```

### ステップ4: 再デプロイ

```bash
cd workers
npx wrangler deploy
```

---

## 🎯 タイミング

### いつログが出力されるか

1. **空き枠検知時**
   ```
   [Alert] ✅ Available: 2025-12-01 09:00-11:00
   [Reserve] Attempting reservation for target xxx
   ```
   → この直後にデバッグログが出力される

2. **集中監視で「○」検知時**
   ```
   [IntensiveCheck] 🎉 「取」→「○」検知！即座に予約
   [Reserve] Attempting reservation for target xxx
   ```
   → この直後にデバッグログが出力される

### 予約が実行される条件

- ✅ `autoReserve` が `true`
- ✅ 空き枠検知（×→○）または集中監視（取→○）
- ✅ 予約上限に達していない
- ✅ 認証情報が有効

---

## ⚠️ 注意事項

### 1. キャンセルが少ない場合

**対策**: 手動でテスト予約を試す
- 実際に空いている枠を選択
- 予約ボタンまで進む
- レスポンスHTMLを確認

**リスク**: なし（実際に予約は実行される）

### 2. デバッグログのサイズ

- レスポンスHTMLの最初の3000文字のみ出力
- 成功メッセージがそれより後ろにある場合は見つからない可能性

**対策**: 必要に応じて3000を5000に変更
```typescript
console.log('[Shinagawa] 🔍 DEBUG: Response HTML (first 5000 chars):', reserveHtml.substring(0, 5000));
```

### 3. 予約が実際に実行される

- デバッグログが有効な状態でも予約は実行される
- 成功判定が間違っていても、施設側のシステムでは予約完了している可能性

---

## 📊 確認後のアクション

### 成功判定が正しかった場合

✅ **何もしない**
- 現在の実装で問題なし
- デバッグログは削除してもOK

### 成功判定が間違っていた場合

1. **ログから実際のメッセージを特定**
2. **コードを修正**
3. **再デプロイ**
4. **次回の予約で動作確認**

### デバッグログの削除（任意）

正しい成功メッセージが確認できたら、デバッグログを削除できます:

```typescript
// デバッグログをすべて削除
// console.log('[Shinagawa] 🔍 DEBUG: ...'); を削除
```

**推奨**: しばらくは残しておく
- トラブルシューティングに役立つ
- 他の施設でも同様に確認できる

---

## 💡 ヒント

### よくある成功メッセージのパターン

**品川区**:
- `予約が完了しました`
- `予約を受け付けました`
- `ご予約ありがとうございます`
- `予約受付完了`

**港区**:
- `予約が完了しました`
- `予約受付番号：12345`
- `予約受付完了`
- `ご予約ありがとうございました`

### 失敗メッセージのパターン

- `満室です`
- `予約できません`
- `エラーが発生しました`
- `既に予約されています`

---

## 🔗 関連ファイル

- **デバッグログ実装**: `workers/src/scraper.ts`
- **監視スクリプト**: `workers/watch-reservation-debug.sh`
- **検証ドキュメント**: `RESERVATION_VERIFICATION_NEEDED.md`
- **予約フロー**: `RESERVATION_FLOW.md`

---

**最終更新**: 2025年11月30日  
**Workers Version**: `48740d43-b2c3-4fb2-8815-4bcd5db210d8`  
**ステータス**: ✅ デバッグログ追加完了、監視準備完了
