# 空き枠検知時の予約実行フロー

**作成日**: 2025年11月30日  
**目的**: 空き枠検知時の自動予約実行ロジックを事実に基づいて説明

---

## 📋 予約実行の全体フロー

### 1. 空き枠検知（workers/src/index.ts: 2190-2215行）

```typescript
// ×→○変化を検知
if (result.currentStatus === '○' && target.lastStatus === '×') {
  console.log(`[Alert] ✅ Available: ${date} ${timeSlot}`);
  
  // statusを'detected'に更新（カレンダー表示用）
  target.status = 'detected';
  target.detectedAt = Date.now();
  
  // 予約戦略に応じて処理
  if (target.autoReserve) {
    if (strategy === 'priority_first') {
      // モードB: 空き枠を収集（後でまとめて優先度順に1枚だけ予約）
      availableSlots.push({ date, timeSlot });
    } else {
      // モードA: 即座に予約（全取得）
      const tempTarget = { ...target, date, timeSlot };
      await attemptReservation(tempTarget, env);
    }
  }
}
```

**✅ 確認ポイント**:
- `target.autoReserve` が `true` の場合のみ予約実行
- 空き枠検知時に即座に `attemptReservation()` を呼び出し

---

## 🎯 予約実行関数（attemptReservation）

### 実装場所: workers/src/index.ts: 2293-2481行

### 処理フロー

#### ステップ1: 予約上限チェック
```typescript
// 予約上限チェック
const limitCheck = await checkReservationLimits(target.userId, env);
if (!limitCheck.canReserve) {
  console.log(`[Reserve] Skipped: ${limitCheck.reason}`);
  return; // 監視は継続するが予約はスキップ
}
```
- 週/月の予約上限に達している場合はスキップ
- 監視は継続される

#### ステップ2: 認証情報の取得
```typescript
// ユーザーの認証情報を取得
const settingsData = await env.USERS.get(`settings:${target.userId}`);
const settings = JSON.parse(settingsData);
const siteSettings = target.site === 'shinagawa' ? settings.shinagawa : settings.minato;

// セッションIDまたはID/パスワードで認証
let sessionId = siteSettings.sessionId;
if (!sessionId && siteSettings.username && siteSettings.password) {
  // パスワードを復号化
  const decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
  
  // ログインしてセッションIDを取得
  sessionId = await loginToShinagawa(username, decryptedPassword);
}
```
- 保存されたセッションIDを優先使用
- セッションIDがない場合はID/パスワードで自動ログイン

#### ステップ3: 予約APIの実行
```typescript
if (target.site === 'shinagawa') {
  result = await makeShinagawaReservation(
    target.facilityId,
    target.date,
    target.timeSlot,
    sessionId
  );
} else {
  result = await makeMinatoReservation(
    target.facilityId,
    target.date,
    target.timeSlot,
    sessionId
  );
}
```

#### ステップ4: 結果の記録と通知
```typescript
// 履歴に保存
const history: ReservationHistory = {
  id: crypto.randomUUID(),
  userId: target.userId,
  targetId: target.id,
  site: target.site,
  facilityId: target.facilityId,
  facilityName: target.facilityName,
  date: target.date,
  timeSlot: target.timeSlot,
  status: result.success ? 'success' : 'failed',
  message: result.message,
  createdAt: Date.now(),
};

// KVに保存
await env.RESERVATIONS.put(`history:${target.userId}`, JSON.stringify(userHistories));

// 成功した場合
if (result.success) {
  target.status = 'completed';
  
  // 🔔 予約成功通知を送信
  await sendPushNotification(target.userId, {
    title: '🎉 予約成功！',
    body: `${target.facilityName}\n${target.date} ${target.timeSlot}\n予約が完了しました`,
  }, env);
} else {
  // 🔔 予約失敗通知を送信（重要なエラーのみ）
  await sendPushNotification(target.userId, {
    title: '❌ 予約失敗',
    body: `${target.facilityName}\n${target.date} ${target.timeSlot}\n${result.message}`,
  }, env);
}
```

---

## 🏢 施設別の予約実行API

### 品川区予約（makeShinagawaReservation）

**実装場所**: workers/src/scraper.ts: 316-416行

**処理ステップ**:
1. **空き状況検索ページにアクセス**
   ```
   GET /rsvWOpeInstSrchVacantAction.do
   パラメータ: facilityId, date
   ```

2. **予約リンクを抽出**
   ```typescript
   const linkMatch = searchHtml.match(/rsvWOpeReservedApplyAction\.do\?[^"]*instNo=([^&"]*)&dateNo=([^&"]*)&timeNo=([^"]*)/);
   ```

3. **予約申込ページにアクセス**
   ```
   GET /rsvWOpeReservedApplyAction.do
   パラメータ: instNo, dateNo, timeNo
   ```

4. **予約確認ページに送信**
   ```
   POST /rsvWOpeReservedConfirmAction.do
   パラメータ: instNo, dateNo, timeNo, agree=on
   ```

5. **予約完了ページに送信**
   ```
   POST /rsvWOpeReservedCompleteAction.do
   パラメータ: instNo, dateNo, timeNo, usrNum=2
   ```

6. **成功判定**
   ```typescript
   if (reserveHtml.includes('予約が完了しました') || reserveHtml.includes('予約を受け付けました')) {
     return { success: true, message: '予約に成功しました' };
   }
   ```

**✅ 確認ポイント**:
- 実際のHTTPリクエストを5段階で実行
- 最終的なHTMLレスポンスから成功/失敗を判定
- セッションIDを使用して認証状態を維持

### 港区予約（makeMinatoReservation）

**実装場所**: workers/src/scraper.ts: 1106行以降

**処理ステップ**（品川区と同様の5段階フロー）:
1. 空き状況検索
2. 予約リンク抽出
3. 予約申込
4. 予約確認
5. 予約完了

---

## 🔍 実際に予約が実行される条件

### ✅ 必須条件（すべて満たす必要がある）

1. **`target.autoReserve` が `true`**
   - 設定画面で「自動予約」を有効にしている

2. **空き枠を検知（`×` → `○`）**
   - スクレイピングで実際に状態変化を確認
   - 通常監視または集中監視で検知

3. **予約上限に達していない**
   - 週/月の予約上限設定内
   - 設定がない場合は制限なし

4. **認証情報が有効**
   - セッションID、またはID/パスワードが設定されている
   - 復号化に成功する

5. **予約APIが成功**
   - 施設サイトの予約フローが正常に完了
   - 「予約が完了しました」のメッセージを確認

### ❌ 予約がスキップされるケース

1. **`target.autoReserve` が `false`**
   - 通知のみ送信、予約は実行しない

2. **予約上限に達している**
   - ログ: `[Reserve] Skipped: 週の予約上限に達しています`
   - 監視は継続、予約のみスキップ

3. **認証情報がない/無効**
   - ログ: `[Reserve] No credentials available`
   - プッシュ通知: 「認証情報が未設定です」

4. **ログイン失敗**
   - ログ: `[Reserve] Failed to login`
   - プッシュ通知: 「ログインに失敗しました」

5. **予約API失敗**
   - 満室・予約不可など
   - ステータスを `'failed'` に更新
   - 履歴に失敗として記録

---

## 📱 予約実行後の通知

### 成功時（必ず送信）
```typescript
await sendPushNotification(target.userId, {
  title: '🎉 予約成功！',
  body: `${target.facilityName}\n${target.date} ${target.timeSlot}\n予約が完了しました`,
  data: { 
    type: 'reservation_success',
    targetId: target.id,
    site: target.site,
    facilityName: target.facilityName,
    date: target.date,
    timeSlot: target.timeSlot,
  }
}, env);
```

### 失敗時（重要なエラーのみ）
```typescript
// ログイン失敗・認証エラー → 通知
// 満室・予約不可 → 通知しない（通常の動作）
// その他のエラー → 通知

await sendPushNotification(target.userId, {
  title: '❌ 予約失敗',
  body: `${target.facilityName}\n${target.date} ${target.timeSlot}\n${result.message}`,
  data: { 
    type: 'reservation_failed',
    targetId: target.id,
    error: result.message,
  }
}, env);
```

---

## 🧪 動作確認方法

### 1. ログでの確認
```bash
cd workers
npx wrangler tail --format pretty | grep -E "(Reserve|Reservation|Available)"
```

**確認するログ**:
- `[Alert] ✅ Available: 2025-12-01 09:00-11:00` - 空き検知
- `[Reserve] Attempting reservation for target xxx` - 予約実行開始
- `[Shinagawa] Making reservation: ...` - 施設別予約API実行
- `[Shinagawa] Reservation successful` - 予約成功
- `[Reserve] Result: SUCCESS - 予約に成功しました` - 最終結果

### 2. KVでの確認
```bash
# 予約履歴を確認
npx wrangler kv:key get "history:USER_ID" --namespace-id=RESERVATIONS_NAMESPACE_ID

# 監視ターゲットのステータス確認
npx wrangler kv:key get "MONITORING:USER_ID" --namespace-id=MONITORING_NAMESPACE_ID
```

### 3. PWAでの確認
- ダッシュボード → 予約履歴
- 成功/失敗の履歴を確認
- エラーメッセージの詳細を確認

---

## 🎯 まとめ

### ✅ 空き枠が出た際に予約が実行される

**根拠となるコード**:
1. `checkTargetAvailability()` で空き枠を検知（×→○）
2. `target.autoReserve` が `true` の場合に `attemptReservation()` を即座に呼び出し
3. `attemptReservation()` が実際の予約APIを実行
4. `makeShinagawaReservation()` / `makeMinatoReservation()` が5段階のHTTPリクエストで予約完了
5. 成功時は履歴に記録 + プッシュ通知送信

**実装箇所**:
- 空き検知: `workers/src/index.ts: 2190-2215`
- 予約実行: `workers/src/index.ts: 2293-2481`
- 品川区API: `workers/src/scraper.ts: 316-416`
- 港区API: `workers/src/scraper.ts: 1106以降`

**信頼性**:
- ✅ HTTPリクエストベースの実装（実際のブラウザ操作と同等）
- ✅ セッション管理（JSESSIONID使用）
- ✅ エラーハンドリング（ログイン失敗、予約失敗）
- ✅ 履歴記録（成功/失敗を追跡可能）
- ✅ プッシュ通知（リアルタイムフィードバック）

---

**最終更新**: 2025年11月30日  
**Workers Version**: `2ba19ef2-99be-4226-b908-637611248554`  
**検証済み**: コードレビューに基づく事実確認
