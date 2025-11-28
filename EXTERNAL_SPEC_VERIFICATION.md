# 外部システム仕様書 検証結果とタスクリスト

**作成日**: 2025年11月26日  
**検証対象**: 品川区・港区 施設予約サイト 外部システム仕様書  
**現在の実装**: Version e84d6c16-3020-4bf6-bd61-cd5f8bf5e597

---

## 📋 目次

1. [検証サマリー](#検証サマリー)
2. [品川区の検証結果](#品川区の検証結果)
3. [港区の検証結果](#港区の検証結果)
4. [重大な問題](#重大な問題)
5. [実装タスクリスト](#実装タスクリスト)

---

## 検証サマリー

### 全体的な整合性

| 項目 | 仕様書 | 現在の実装 | 整合性 | 備考 |
|------|--------|-----------|--------|------|
| **品川区ログイン** | JSESSIONID Cookie | ✅ 実装済み | ✅ 一致 | `loginToShinagawa()` |
| **品川区空き状況** | Shift_JIS, `.do`エンドポイント | ✅ 実装済み | ✅ 一致 | `checkShinagawaAvailability()` |
| **品川区予約** | 5段階フロー | ✅ 実装済み | ✅ 一致 | `makeShinagawaReservation()` |
| **品川区「取」状態** | 10分刻みバッチ処理 | ✅ 集中監視実装済み | ✅ 一致 | `intensiveMonitoringUntil` |
| **港区ログイン** | reCAPTCHA v2あり | ❌ 未対応 | 🚨 **不一致** | **CRITICAL** |
| **港区空き状況** | 仕様不明 | ⚠️ 実装あり | ⚠️ 要確認 | 動作未検証 |
| **港区予約** | 規約画面なし | ✅ 実装済み | ✅ 一致 | `makeMinatoReservation()` |

### 重大な発見

1. 🚨 **CRITICAL**: 港区サイトにreCAPTCHA v2が実装されている
   - **影響**: 港区の自動ログイン・自動予約が**完全に不可能**
   - **詳細**: `CRITICAL_ISSUE_CAPTCHA.md` 参照

2. ⚠️ **WARNING**: 監視日数とサブリクエスト制限の問題
   - **影響**: 31日間全部を毎分監視すると無料プラン制限超過
   - **詳細**: `SYSTEM_REQUIREMENTS_ANALYSIS.md` 参照

---

## 品川区の検証結果

### ✅ 実装済み・仕様通り

#### 1. ログイン処理

**仕様書の記載**:
```
- ログインURL: rsvWTransUserLoginAction.do → rsvWUserAttestationLoginAction.do
- 認証方式: ID / パスワードのみ
- CAPTCHA: 無し
- セッション: JSESSIONID Cookie
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 50-120)

export async function loginToShinagawa(userId: string, password: string): Promise<string | null> {
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
  
  // 1. セッション取得
  const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`);
  const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
  
  // 2. ログイン
  const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
    method: 'POST',
    body: loginParams.toString(),
    headers: { 'Cookie': `JSESSIONID=${sessionId}` }
  });
}
```

**検証結果**: ✅ **仕様通り実装済み**

---

#### 2. 空き状況チェック

**仕様書の記載**:
```
- URL: rsvWOpeInstSrchVacantAction.do
- パラメータ: instCd（施設コード）, srchDate（日付）
- 文字コード: Shift_JIS
- ステータス: ○ / × / 取
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 155-220)

export async function checkShinagawaAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials?: SiteCredentials
): Promise<AvailabilityResult> {
  const searchParams = new URLSearchParams({
    'rsvWOpeInstSrchVacantForm.instCd': facilityId,
    'rsvWOpeInstSrchVacantForm.srchDate': date,
  });
  
  const searchResponse = await fetch(
    `${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`
  );
  
  const htmlText = await searchResponse.text();
  const statusMatch = htmlText.match(/([○×取])/);
  const currentStatus = statusMatch ? statusMatch[1] : '×';
}
```

**検証結果**: ✅ **仕様通り実装済み**

---

#### 3. 予約処理

**仕様書の記載**:
```
1. 週表示の空きセルをクリックして選択
2. 画面下部「予約」ボタン押下 → rsvWOpeReservedApplyAction.do
3. 規約・注意事項画面でチェックボックス同意
4. 予約内容確認画面で利用人数入力
5. 「予約」ボタン押下で確定
6. 完了画面表示
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 250-450)

export async function makeShinagawaReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials
): Promise<ReservationHistory> {
  // 1. ログイン
  const sessionId = await loginToShinagawa(...);
  
  // 2. 空き状況確認
  const availability = await checkShinagawaAvailability(...);
  
  // 3. 予約申し込み
  const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do?${applyParams}`);
  
  // 4. 規約同意
  const confirmParams = new URLSearchParams({
    'rsvWOpeReservedConfirmForm.agree': 'on',
    'rsvWOpeReservedConfirmForm.usrCnt': '2',
  });
  
  // 5. 予約確定
  const confirmResponse = await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
    method: 'POST',
    body: confirmParams.toString()
  });
}
```

**検証結果**: ✅ **仕様通り実装済み**

---

#### 4. 「取」状態の集中監視

**仕様書の記載**:
```
- 「取」ステータス: 取消処理中アイコン
- 内部バッチ: 10分刻みで動作していると思われる
- ツール側: 10分刻み前後の集中監視で対応
```

**現在の実装**:
```typescript
// workers/src/index.ts (line 1300-1400)

// Cron実行時に10分刻み前後2分間を集中監視モードとする
const minute = now.getMinutes();
const isIntensiveTime = (minute % 10 === 0) || // 0, 10, 20, 30, 40, 50分
                        (minute % 10 === 1) || // 1, 11, 21, 31, 41, 51分
                        (minute % 10 === 9);   // 9, 19, 29, 39, 49, 59分

if (isIntensiveTime) {
  console.log(`[Cron] 🔥 集中監視モード: 分=${minute} (10分刻み前後2分間)`);
}

// 「取」検知時に集中監視フラグを立てる
if (result.currentStatus === '取') {
  await startIntensiveMonitoring(target, env);
}
```

**検証結果**: ✅ **仕様通り実装済み**

---

### ⚠️ 要確認項目（品川区）

#### 1. 深夜帯のログイン制限

**仕様書の記載**:
```
要現地確認:
- 深夜帯のログイン制限（クライアント観測値と突き合わせ）
- セッション有効期限
```

**現在の実装**:
```typescript
// workers/src/index.ts (line 70-130)

function checkTimeRestrictions(now: Date = new Date()): TimeRestrictions {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = jst.getHours();
  const minute = jst.getMinutes();
  
  // 24:00〜3:15: ログイン不可、既存セッションのみ予約可
  if (hour === 0 || hour === 1 || hour === 2 || (hour === 3 && minute < 15)) {
    return {
      canLogin: false,
      canReserve: true,
      reason: '深夜時間帯（24:00-3:15）: ログイン不可、既存セッションのみ予約可'
    };
  }
  
  // 3:15: セッションリセットタイミング
  // 3:15〜5:00: 新規予約不可
}
```

**検証結果**: ⚠️ **実装済みだが実測確認が必要**
- クライアント観測値との整合性確認
- 実際のサイトでの動作確認

---

## 港区の検証結果

### 🚨 CRITICAL: reCAPTCHA v2の存在

**仕様書の記載**:
```
### 4.2 ログイン仕様

- CAPTCHA
  - reCAPTCHA v2（Google の「私はロボットではありません」チェックボックス）
  - 文言: `私はロボットではありません`

### 4.5 CAPTCHA による技術的制約

- **サーバー側（Workers）からの完全自動ログインは不可**
  - reCAPTCHA は人間判定のために設計されている
  - 自動でバイパスすることは利用規約違反となる可能性が高い
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 250-350)

export async function loginToMinato(userId: string, password: string): Promise<string | null> {
  // ❌ reCAPTCHAを完全に無視している
  // この実装は動作しない
  
  const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
    method: 'POST',
    body: loginParams.toString(), // reCAPTCHAトークンが含まれていない
  });
}
```

**検証結果**: 🚨 **実装が無効** - 詳細は `CRITICAL_ISSUE_CAPTCHA.md` 参照

---

### ⚠️ 未確認項目（港区）

#### 1. 空き状況画面の構造

**仕様書の記載**:
```
港区のログイン後画面の HTML は現時点で取得できていないため、
詳細な DOM 構造は **要現地確認** とします。
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 450-550)

export async function checkMinatoAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials?: SiteCredentials
): Promise<AvailabilityResult> {
  // 品川区と同じ構造を仮定している
  // 実際に動作するか未検証
}
```

**検証結果**: ⚠️ **未検証** - reCAPTCHA問題により検証不可能

---

#### 2. 規約画面の有無

**仕様書の記載**:
```
規約同意画面が**存在しない**（品川区との相違点としてクライアントから共有あり）
```

**現在の実装**:
```typescript
// workers/src/scraper.ts (line 650-750)

export async function makeMinatoReservation(...): Promise<ReservationHistory> {
  // 規約画面をスキップする実装になっている
  // confirmParams に 'agree' パラメータを含めていない
}
```

**検証結果**: ✅ **仕様通り実装済み**（ただしreCAPTCHA問題により検証不可）

---

## 重大な問題

### 問題1: 港区reCAPTCHA（CRITICAL）

**詳細**: `CRITICAL_ISSUE_CAPTCHA.md` 参照

**影響**:
- ❌ 港区の自動ログイン: **不可能**
- ❌ 港区の自動予約: **不可能**
- ❌ 港区の監視: **セッション方式なら可能**

**解決策**:
1. 選択肢A: 品川区のみ対応（港区は対象外）
2. 選択肢B: 港区は通知のみ対応（推奨）
3. 選択肢C: ブラウザ拡張機能開発（高コスト）

**次のアクション**: クライアントに報告して方針決定

---

### 問題2: 監視日数とサブリクエスト制限（HIGH）

**詳細**: `SYSTEM_REQUIREMENTS_ANALYSIS.md` 参照

**影響**:
- ⚠️ 31日間全部を毎分監視: **無料プラン制限超過**
- ⚠️ 現在のローテーション: **11分間隔で取りこぼし**

**解決策**:
1. 選択肢A: 監視日数を7日に短縮（無料、取りこぼしなし）
2. 選択肢B: Workers Paid ($5/月) にアップグレード（推奨）

**次のアクション**: クライアントに報告して方針決定

---

## 実装タスクリスト

### 🚨 Priority 1: 港区reCAPTCHA対応（即座）

#### タスク1.1: クライアントへの報告
```
□ CRITICAL_ISSUE_CAPTCHA.md をレビュー依頼
□ 選択肢A/B/Cの説明
□ 方針決定を依頼
□ 期限: 即座
```

#### タスク1.2: 選択肢Bの実装（方針決定後）
```
選択肢B採用の場合:
□ Phase 1: 現状確認（1時間）
  - 港区サイトでreCAPTCHA v2を実際に確認
  - ログインフォームのパラメータを確認
  - 既存セッションでの空き状況チェックが可能か確認

□ Phase 2: UI修正（2時間）
  - 港区設定に「通知のみ」の説明を追加
  - セッション管理UIを追加

□ Phase 3: Workers修正（3時間）
  - loginToMinato() を非推奨化
  - セッションID受け取り方式に変更
  - 港区は予約せず通知のみ

□ Phase 4: セッション管理UI（4時間）
  - ユーザーがブラウザでログイン
  - セッションIDを抽出して送信
  - セッション有効期限を表示

□ Phase 5: 通知のみモード（2時間）
  - 港区の空き検知時はプッシュ通知のみ
  - 自動予約はしない

合計: 12時間（1.5日）
```

---

### ⚠️ Priority 2: 監視日数の最適化（高優先）

#### タスク2.1: クライアントへの報告
```
□ SYSTEM_REQUIREMENTS_ANALYSIS.md をレビュー依頼
□ 選択肢A（7日短縮）/ B（Paid）の説明
□ 方針決定を依頼
□ 期限: 1日以内
```

#### タスク2.2: 選択肢Aの実装（無料プラン継続）
```
選択肢A採用の場合:
□ workers/src/index.ts を修正（1時間）
  - DAYS_PER_CRON を削除
  - MAX_MONITORING_DAYS = 7 に変更
  - ローテーション削除
  - カーソル管理削除

□ デプロイ・実測確認（30分）
  - サブリクエスト数が21/50以内を確認
  - 全日付が毎分チェックされることを確認

合計: 1.5時間
```

#### タスク2.3: 選択肢Bの実装（Paidプラン）
```
選択肢B採用の場合:
□ Cloudflare Workers アップグレード（30分）
  - ダッシュボードで "Unbound" ($5/月) に変更

□ workers/src/index.ts を修正（1時間）
  - DAYS_PER_CRON を削除
  - MAX_MONITORING_DAYS = 31 に変更
  - ローテーション削除
  - バッチ処理削除（CPU時間制限なし）

□ デプロイ・実測確認（30分）
  - サブリクエスト数が93/1000以内を確認
  - 全日付が毎分チェックされることを確認

合計: 2時間
```

---

### ✅ Priority 3: 品川区の動作確認（中優先）

#### タスク3.1: 深夜帯のログイン制限確認
```
□ 24:00〜3:15にログイン試行（実測）
□ 3:15のセッションリセット確認（実測）
□ 既存セッションでの予約可否確認（実測）
□ 期限: 1週間以内
```

#### タスク3.2: 「取」→「○」の切り替わりタイミング確認
```
□ 10分刻み（00, 10, 20, 30, 40, 50分）での切り替わりを観測
□ 集中監視モードの動作確認
□ ログで切り替わりを記録
□ 期限: 1週間以内
```

---

### 📝 Priority 4: ドキュメント更新（低優先）

#### タスク4.1: 仕様書の更新
```
□ UNIFIED_SPEC.md に港区reCAPTCHA制約を追記
□ SYSTEM_OVERVIEW.md に監視日数の制約を追記
□ USER_GUIDE.md に港区の制限事項を追記
□ 期限: 実装完了後
```

---

## 📊 まとめ

### 実現可能性の評価

| 要件 | 品川区 | 港区 | 総合評価 |
|------|--------|------|---------|
| 一ヶ月先まで監視 | ✅ 可能（Paid推奨） | ⚠️ 通知のみ可能 | ⚠️ 条件付き |
| 即座に取得（自動予約） | ✅ 可能 | ❌ 不可能 | ⚠️ 品川区のみ |
| 複数施設監視 | ✅ 可能 | ⚠️ 通知のみ可能 | ⚠️ 条件付き |
| 平日19時以降・土日祝全日 | ✅ 可能 | ⚠️ 通知のみ可能 | ⚠️ 条件付き |

### 重要な決定事項

1. **港区の扱い**: 選択肢A（対象外）/ B（通知のみ）/ C（拡張機能）
2. **監視日数**: 選択肢A（7日、無料）/ B（31日、$5/月）

### 推奨事項

1. **即座対応**: 港区reCAPTCHA問題をクライアントに報告
2. **推奨**: 選択肢B（港区は通知のみ）+ 選択肢B（Paidプラン）
3. **理由**: 
   - 品川区・港区両方の監視が可能
   - 31日間全部を毎分チェック可能
   - 取りこぼしなし
   - 月額$5で運用可能

---

**最終更新**: 2025年11月26日  
**次回アクション**: クライアントへの報告（Priority 1, 2）
