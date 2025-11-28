# システム状態調査レポート

**調査日時**: 2025年11月27日  
**調査対象**: tennis-yoyaku システム全体  
**目的**: Workers-PWA連携状況、実装の完成度、不足機能の特定

---

## 📊 システム全体の状況

### ✅ 完了している実装

#### 1. Workers API（バックエンド）
- ✅ **認証系API**: login, register, JWT認証
- ✅ **設定保存API**: handleSaveSettings
  - `shinagawaUserId`, `shinagawaPassword`
  - `minatoUserId`, `minatoPassword`
  - `shinagawaSessionId`, `minatoSessionId` (新規追加済み)
  - `reservationLimits` (週・月上限)
- ✅ **空き状況チェック**: checkShinagawaAvailability, checkMinatoAvailability
  - セッションID対応済み
  - ログイン処理削除済み
  - セッション期限切れ検知機能追加済み
- ✅ **予約実行API**: makeShinagawaReservation, makeMinatoReservation
- ✅ **監視設定API**: 監視ターゲットの追加・削除・更新
- ✅ **Cron処理**: 毎分実行（現在は停止中）
  - セッションID取得・使用機能追加済み
  - セッション期限切れチェック追加済み

#### 2. PWA（フロントエンド）
- ✅ **認証画面**: ログイン・登録
- ✅ **ダッシュボード**: 監視一覧、履歴表示
- ✅ **設定画面**: 
  - 品川区・港区のID/パスワード入力
  - 予約上限設定
  - プッシュ通知設定
- ✅ **API Client**: shinagawaSessionId/minatoSessionId対応済み

#### 3. インフラ
- ✅ **Cloudflare Workers**: デプロイ済み（Version: 184be81b）
- ✅ **Workers Paid**: 有料プラン適用済み ($5/month)
- ✅ **KV Namespaces**: USERS, SESSIONS, MONITORING, RESERVATIONS
- ✅ **Cron Triggers**: 設定済み（現在は停止中）

---

## ❌ 未実装・不具合

### 🔴 重大な不具合

#### 1. **sendPushNotification関数が未定義** 【CRITICAL】
**場所**: `workers/src/index.ts`

**問題**:
- Line 1495, 1701 で `sendPushNotification()` を呼び出し
- しかし、この関数は **どこにも定義されていない**
- import文にも存在しない

**影響**:
- セッション期限切れ通知が送信できない
- 空き状況変更通知が送信できない
- システムの核心機能が動作不可

**コード例**:
```typescript
// Line 1701: 呼び出しているが定義がない
await sendPushNotification(userId, {
  title: `${siteName}: セッション期限切れ`,
  body: `${siteName}の予約サイトに再ログインしてセッションを更新してください`,
  data: { 
    type: 'session_expired', 
    site,
    url: siteUrl
  }
}, env);
```

**必要な対応**:
- プッシュ通知送信関数を実装
- Web Push API（VAPID）を使用
- 既存のVAPID鍵を活用（環境変数に設定済み）

---

#### 2. **予約処理がcredentials方式のまま** 【HIGH】
**場所**: `workers/src/index.ts` Line 1600-1650

**問題**:
```typescript
// Line 1622-1629: パスワード復号化処理が残っている
let decryptedPassword = siteSettings.password;
if (isEncrypted(siteSettings.password)) {
  decryptedPassword = await decryptPassword(siteSettings.password, env.ENCRYPTION_KEY);
}

const credentials = {
  username: siteSettings.username,
  password: decryptedPassword
};

// Line 1632-1645: credentials を使っている
result = await makeShinagawaReservation(
  target.facilityId,
  target.date,
  target.timeSlot,
  credentials  // ← セッションIDに変更すべき
);
```

**影響**:
- 空き状況チェックはセッションID方式に移行済み
- しかし予約実行は古いcredentials方式のまま
- 一貫性がない

**必要な対応**:
- `makeShinagawaReservation`, `makeMinatoReservation` の引数を `sessionId` に変更
- 予約時もセッションIDを使用

---

### 🟡 未実装機能

#### 3. **PWA: セッション取得UI** 【MEDIUM】
**場所**: `pwa/app/dashboard/settings/page.tsx`

**現状**:
- ID/パスワード入力フォームのみ実装済み
- セッション取得ボタンが未実装
- Cookie Store APIの実装がない

**必要な実装**:
```typescript
// 品川区セッション取得
const handleGetShinagawaSession = async () => {
  const cookies = await navigator.cookieStore.getAll({
    domain: '.cm9.eprs.jp'
  });
  const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
  
  await apiClient.saveSettings({
    shinagawaSessionId: jsessionCookie.value
  });
};

// 港区セッション取得
const handleGetMinatoSession = async () => {
  const cookies = await navigator.cookieStore.getAll({
    domain: '.rsv.ws-scs.jp'
  });
  const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
  
  await apiClient.saveSettings({
    minatoSessionId: jsessionCookie.value
  });
};
```

**UIコンポーネント**:
- 「セッション取得」ボタン
- セッション状態表示（最終更新日時）
- 外部サイトへのリンク
- reCAPTCHA説明（港区用）

---

#### 4. **自動ログイン + エラーハンドリング** 【LOW】
**場所**: 未実装

**提案された機能**:
- セッション期限切れ時に自動再ログイン
- 3回失敗で監視停止
- エラーカウント管理
- 監視再開機能

**現状**: 完全に未実装

---

## 🔄 Workers-PWA 連携状況

### API連携マトリクス

| API | Workers実装 | PWA実装 | 動作状況 |
|-----|-----------|---------|---------|
| **POST /api/auth/login** | ✅ | ✅ | ✅ 動作OK |
| **POST /api/auth/register** | ✅ | ✅ | ✅ 動作OK |
| **POST /api/settings** | ✅ | ✅ | ✅ 動作OK（ID/Pass保存） |
| **POST /api/settings** (sessionId) | ✅ | ⚠️ | ⚠️ UIなし（API側は対応済み） |
| **GET /api/settings** | ✅ | ✅ | ✅ 動作OK |
| **POST /api/monitoring/targets** | ✅ | ✅ | ✅ 動作OK |
| **GET /api/monitoring/targets** | ✅ | ✅ | ✅ 動作OK |
| **プッシュ通知** | ❌ | ✅ | ❌ Workers側未実装 |

---

## 📋 実装優先度付きタスクリスト

### 🔴 Priority 1: 緊急（システム動作に必須）

#### タスク 1.1: sendPushNotification関数の実装
**所要時間**: 2時間  
**ファイル**: `workers/src/pushNotification.ts` (新規作成)

```typescript
export async function sendPushNotification(
  userId: string,
  notification: {
    title: string;
    body: string;
    data?: any;
  },
  env: Env
): Promise<void> {
  // 1. ユーザーのプッシュサブスクリプションを取得
  const subscription = await env.USERS.get(`push_subscription:${userId}`, 'json');
  if (!subscription) return;
  
  // 2. Web Push APIで通知送信
  const vapidKeys = {
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
    subject: env.VAPID_SUBJECT,
  };
  
  // 3. webpushライブラリを使用して送信
  // 実装詳細...
}
```

**index.tsに追加**:
```typescript
import { sendPushNotification } from './pushNotification';
```

---

#### タスク 1.2: 予約処理のセッションID対応
**所要時間**: 1時間  
**ファイル**: `workers/src/scraper.ts`, `workers/src/index.ts`

**修正内容**:
- `makeShinagawaReservation(facilityId, date, timeSlot, sessionId)`
- `makeMinatoReservation(facilityId, date, timeSlot, sessionId)`
- 引数を `credentials` → `sessionId` に変更

---

### 🟡 Priority 2: 高優先（ユーザー体験向上）

#### タスク 2.1: PWA セッション取得UI実装
**所要時間**: 4時間  
**ファイル**: `pwa/app/dashboard/settings/page.tsx`

**実装内容**:
- 品川区セッション取得ボタン + Cookie Store API
- 港区セッション取得ボタン + Cookie Store API
- セッション状態表示（最終更新日時）
- 外部サイトへのリンク
- reCAPTCHA説明（港区）

---

#### タスク 2.2: Cron監視の再開
**所要時間**: 5分  
**ファイル**: `workers/wrangler.toml`

```toml
[triggers]
crons = ["*/1 * * * *"]  # 毎分監視を再開
```

その後、`wrangler deploy`

---

### 🟢 Priority 3: 通常（将来的な改善）

#### タスク 3.1: 自動ログイン + エラーハンドリング
**所要時間**: 6時間  
**内容**: 提案された自動再ログイン機能の実装

#### タスク 3.2: ドキュメント更新
**所要時間**: 2時間  
**内容**: USER_GUIDE.md, SYSTEM_OVERVIEW.md の作成

---

## 🎯 推奨実装順序

```
1. sendPushNotification関数実装（2h）← 最優先
   ↓
2. 予約処理のセッションID対応（1h）
   ↓
3. Workersデプロイ + 動作確認（30m）
   ↓
4. PWA セッション取得UI実装（4h）
   ↓
5. PWAデプロイ + エンドツーエンドテスト（1h）
   ↓
6. Cron監視再開（5m）
   ↓
7. 本番運用開始
```

**合計推定時間**: 8.5時間

---

## 💡 重要な発見

### セッションID方式への移行状況

| 機能 | 状態 | 詳細 |
|------|------|------|
| **空き状況チェック** | ✅ 完了 | checkShinagawa/MinatoAvailability |
| **予約実行** | ❌ 未対応 | makeShinagawa/MinatoReservation |
| **API設定保存** | ✅ 完了 | handleSaveSettings |
| **PWA UI** | ❌ 未実装 | セッション取得ボタンなし |
| **通知機能** | ❌ 未実装 | sendPushNotification未定義 |

### 現在のシステムでできること

✅ **動作する機能**:
- ユーザー登録・ログイン
- ID/パスワード保存
- 監視設定の登録
- （Cron停止中のため監視は動作していない）

❌ **動作しない機能**:
- プッシュ通知（関数未実装）
- セッションID方式での監視（UI未実装）
- セッションID方式での予約（未対応）
- Cron監視（停止中）

---

## 📌 結論

### 現状サマリー

1. **Workers API**: 80%完成（プッシュ通知関数が欠落）
2. **PWA**: 60%完成（セッション取得UIが欠落）
3. **連携**: API側は準備済み、UI側が未実装
4. **運用**: Cron停止中、有料プラン適用済み

### 次のアクション

**最優先**: sendPushNotification関数を実装しないと、システムの核心機能（通知）が動作しません。

**推奨**: 
1. sendPushNotification実装（2h）
2. 予約処理修正（1h）
3. デプロイ・テスト（30m）
4. PWA UI実装（4h）
5. 本番運用開始

**所要時間**: 合計 7.5時間

---

**作成者**: AI Assistant  
**最終更新**: 2025年11月27日
