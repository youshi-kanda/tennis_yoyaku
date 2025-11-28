# セッションベース アーキテクチャ設計

**作成日**: 2025年11月27日  
**目的**: reCAPTCHA対応のため、品川区・港区ともにセッションID方式に統一  
**将来性**: reCAPTCHA導入時も影響を受けない設計

---

## 📋 目次

1. [背景と目的](#背景と目的)
2. [アーキテクチャ概要](#アーキテクチャ概要)
3. [実装仕様](#実装仕様)
4. [ユーザーフロー](#ユーザーフロー)
5. [実装タスク](#実装タスク)

---

## 背景と目的

### 現在の問題

1. **港区**: reCAPTCHA v2が既に実装されている
   - 自動ログインが不可能
   - パスワード方式では動作しない

2. **品川区**: 将来的にreCAPTCHA導入のリスク
   - 現在は動作しているが、導入された瞬間にシステムが停止
   - 予防的な対応が必要

### 解決策: セッションID方式への統一

- ユーザーがブラウザで手動ログイン（reCAPTCHAを解決）
- システムは既存セッションIDを使用
- ログイン処理を完全に排除
- reCAPTCHA導入時も影響を受けない

---

## アーキテクチャ概要

### 従来方式（パスワードログイン）

```
[Workers] → ログインAPI → reCAPTCHA ❌ → ログイン失敗
          ↓
      ID/Password
```

**問題点**:
- reCAPTCHAを突破できない
- サーバーサイドからの自動ログインが不可能

---

### 新方式（セッションID方式）

```
[ユーザー] → ブラウザでログイン → reCAPTCHA ✅ → セッション確立
                                                    ↓
                                              JSESSIONID Cookie
                                                    ↓
[PWA] → Cookie取得 → セッションID抽出 → Workers KVに保存
                                            ↓
[Workers] → セッションIDを使用 → 空き状況チェック ✅
           → セッションIDを使用 → 予約実行 ✅
```

**メリット**:
- ✅ reCAPTCHA問題を回避
- ✅ 将来的なreCAPTCHA導入にも対応
- ✅ パスワード保存不要（セキュリティ向上）

---

## 実装仕様

### 1. データモデル

#### KV保存形式
```json
{
  "settings:userId": {
    "shinagawa": {
      "sessionId": "ABC123...",
      "lastUpdated": 1732608000000,
      "expiresAt": 1732694400000
    },
    "minato": {
      "sessionId": "XYZ789...",
      "lastUpdated": 1732608000000,
      "expiresAt": 1732694400000
    }
  }
}
```

#### TypeScript型定義
```typescript
interface SiteSession {
  sessionId: string;
  lastUpdated: number; // タイムスタンプ
  expiresAt?: number; // 有効期限（推定値）
}

interface UserSettings {
  shinagawa?: SiteSession;
  minato?: SiteSession;
  reservationLimits?: {
    perWeek?: number;
    perMonth?: number;
  };
}
```

---

### 2. API仕様

#### セッションID保存API
```typescript
// POST /api/settings
{
  "shinagawaSessionId": "ABC123...", // optional
  "minatoSessionId": "XYZ789..."     // optional
}

// Response
{
  "success": true,
  "message": "Session saved successfully"
}
```

#### 空き状況チェックAPI（内部実装）
```typescript
async function checkAvailabilityWithSession(
  site: 'shinagawa' | 'minato',
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string
): Promise<AvailabilityResult> {
  const baseUrl = site === 'shinagawa' 
    ? 'https://www.cm9.eprs.jp/shinagawa/web'
    : 'https://web101.rsv.ws-scs.jp/web';
  
  const searchParams = new URLSearchParams({
    'rsvWOpeInstSrchVacantForm.instCd': facilityId,
    'rsvWOpeInstSrchVacantForm.srchDate': date,
  });
  
  const searchResponse = await fetch(
    `${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, 
    {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 ...',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeHomeAction.do`,
      },
    }
  );
  
  const htmlText = await searchResponse.text();
  
  // セッション期限切れチェック
  if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
    throw new Error('Session expired');
  }
  
  // 空き状況を解析
  const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×取])`));
  const currentStatus = statusMatch ? statusMatch[1] : '×';
  
  return {
    available: currentStatus === '○',
    facilityId,
    facilityName: site === 'shinagawa' ? '品川区施設' : '港区施設',
    date,
    timeSlot,
    currentStatus,
    changedToAvailable: currentStatus === '○',
  };
}
```

---

### 3. UI仕様

#### 設定画面（品川区）

```tsx
<div className="bg-white rounded-lg shadow p-6">
  <h2 className="text-lg font-bold text-gray-900 mb-4">
    品川区予約サイト セッション設定
  </h2>
  
  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
    <p className="text-sm text-blue-800">
      ℹ️ セッションID方式を使用します。
      将来的にreCAPTCHAが導入されても動作を継続できます。
    </p>
  </div>
  
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        セットアップ手順
      </label>
      <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
        <li>
          <a href="https://www.cm9.eprs.jp/shinagawa/web/" 
             target="_blank" 
             className="text-emerald-600 underline">
            品川区予約サイト
          </a>
          を新しいタブで開く
        </li>
        <li>利用者番号・パスワードを入力してログイン</li>
        <li>ログイン成功後、下の「セッション取得」ボタンをクリック</li>
      </ol>
    </div>
    
    <button
      onClick={handleGetShinagawaSession}
      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
    >
      セッション取得
    </button>
    
    {shinagawaSession && (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-sm text-green-800 font-medium">
          ✓ セッション設定済み
        </p>
        <p className="text-xs text-green-600 mt-1">
          最終更新: {new Date(shinagawaSession.lastUpdated).toLocaleString('ja-JP')}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          ※ セッションが切れた場合は再度取得してください
        </p>
      </div>
    )}
  </div>
</div>
```

#### 設定画面（港区）

```tsx
<div className="bg-white rounded-lg shadow p-6">
  <h2 className="text-lg font-bold text-gray-900 mb-4">
    港区予約サイト セッション設定
  </h2>
  
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
    <p className="text-sm text-yellow-800">
      ⚠️ 港区はreCAPTCHA対応のため、セッションID方式を使用します。
    </p>
  </div>
  
  <div className="space-y-4">
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">
        セットアップ手順
      </label>
      <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
        <li>
          <a href="https://web101.rsv.ws-scs.jp/web/" 
             target="_blank" 
             className="text-emerald-600 underline">
            港区予約サイト
          </a>
          を新しいタブで開く
        </li>
        <li>利用者番号・パスワードを入力してログイン</li>
        <li>reCAPTCHA（「私はロボットではありません」）をチェック</li>
        <li>ログイン成功後、下の「セッション取得」ボタンをクリック</li>
      </ol>
    </div>
    
    <button
      onClick={handleGetMinatoSession}
      className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
    >
      セッション取得
    </button>
    
    {minatoSession && (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <p className="text-sm text-green-800 font-medium">
          ✓ セッション設定済み
        </p>
        <p className="text-xs text-green-600 mt-1">
          最終更新: {new Date(minatoSession.lastUpdated).toLocaleString('ja-JP')}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          ※ セッションが切れた場合は再度取得してください
        </p>
      </div>
    )}
  </div>
</div>
```

---

### 4. セッション取得ロジック

```typescript
// pwa/app/dashboard/settings/page.tsx

const handleGetShinagawaSession = async () => {
  try {
    // Cookie Store APIを使用（Chrome 87+）
    if (!navigator.cookieStore) {
      alert('お使いのブラウザはCookie Store APIに対応していません。Chrome/Edgeをご利用ください。');
      return;
    }
    
    // 品川区サイトのCookieを取得
    const cookies = await navigator.cookieStore.getAll({
      domain: '.cm9.eprs.jp' // 品川区ドメイン
    });
    
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    
    if (!jsessionCookie) {
      alert('品川区サイトにログインしていません。先に品川区サイトでログインしてください。');
      // 品川区サイトを開く
      window.open('https://www.cm9.eprs.jp/shinagawa/web/', '_blank');
      return;
    }
    
    // WorkersにセッションIDを送信
    const response = await apiClient.saveSettings({
      shinagawaSessionId: jsessionCookie.value,
    });
    
    if (response.success) {
      setShinagawaSession({
        sessionId: jsessionCookie.value,
        lastUpdated: Date.now(),
      });
      alert('品川区のセッションIDを保存しました');
    }
  } catch (err) {
    console.error('Session fetch error:', err);
    alert(`セッション取得に失敗しました: ${err.message}`);
  }
};

const handleGetMinatoSession = async () => {
  try {
    if (!navigator.cookieStore) {
      alert('お使いのブラウザはCookie Store APIに対応していません。Chrome/Edgeをご利用ください。');
      return;
    }
    
    // 港区サイトのCookieを取得
    const cookies = await navigator.cookieStore.getAll({
      domain: '.rsv.ws-scs.jp' // 港区ドメイン
    });
    
    const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
    
    if (!jsessionCookie) {
      alert('港区サイトにログインしていません。先に港区サイトでログインしてください。');
      // 港区サイトを開く
      window.open('https://web101.rsv.ws-scs.jp/web/', '_blank');
      return;
    }
    
    // WorkersにセッションIDを送信
    const response = await apiClient.saveSettings({
      minatoSessionId: jsessionCookie.value,
    });
    
    if (response.success) {
      setMinatoSession({
        sessionId: jsessionCookie.value,
        lastUpdated: Date.now(),
      });
      alert('港区のセッションIDを保存しました');
    }
  } catch (err) {
    console.error('Session fetch error:', err);
    alert(`セッション取得に失敗しました: ${err.message}`);
  }
};
```

---

## ユーザーフロー

### 初回セットアップ

```
1. PWAの設定画面を開く
   ↓
2. 「品川区予約サイト」リンクをクリック（新しいタブで開く）
   ↓
3. 品川区サイトで利用者番号・パスワードを入力してログイン
   ↓
4. PWAに戻り「セッション取得」ボタンをクリック
   ↓
5. 「セッション設定済み」と表示される
   ↓
6. 港区も同様に設定（reCAPTCHAチェックが追加で必要）
```

### 監視動作

```
[Workers Cron: 毎分実行]
   ↓
1. KVから全ユーザーの監視設定を取得
   ↓
2. 各ユーザーのセッションIDを取得
   ↓
3. セッションIDを使って空き状況をチェック
   ↓
4. 空きが見つかった場合:
   - プッシュ通知を送信
   - (オプション) 既存セッションで自動予約
   ↓
5. セッション期限切れの場合:
   - ユーザーにプッシュ通知（再ログイン要求）
```

### セッション期限切れ時

```
1. Workersがセッション期限切れを検知
   ↓
2. プッシュ通知「セッションが切れました。再ログインしてください。」
   ↓
3. ユーザーが通知をクリック → PWA設定画面へ
   ↓
4. 各サイトで再ログイン
   ↓
5. 「セッション取得」ボタンをクリック
   ↓
6. 監視再開
```

---

## 実装タスク

### Phase 1: Workers修正（4時間） ✅ **80% 完了**

#### タスク1.1: セッションID保存API ✅ **完了**
```typescript
// workers/src/index.ts

async function handleSaveSettings(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as {
    shinagawaSessionId?: string;
    minatoSessionId?: string;
    // ... 既存フィールド
  };
  
  // 既存設定を取得
  const existingSettings = await env.USERS.get(`settings:${userId}`);
  const updatedSettings = existingSettings ? JSON.parse(existingSettings) : {};
  
  // 品川区セッション更新
  if (body.shinagawaSessionId) {
    updatedSettings.shinagawa = {
      sessionId: body.shinagawaSessionId,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 推定24時間
    };
  }
  
  // 港区セッション更新
  if (body.minatoSessionId) {
    updatedSettings.minato = {
      sessionId: body.minatoSessionId,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 推定24時間
    };
  }
  
  await env.USERS.put(`settings:${userId}`, JSON.stringify(updatedSettings));
  return jsonResponse({ success: true });
}
```

#### タスク1.2: scraper.ts修正 ✅ **完了**
```typescript
// workers/src/scraper.ts (line 123-200, 207-270)

// ✅ 実装完了: checkShinagawaAvailability()
export async function checkShinagawaAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string, // ✅ credentials → sessionId に変更済み
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  // 既存予約チェック（維持）
  const isAlreadyReserved = existingReservations?.some(...);
  if (isAlreadyReserved) { return ...; }
  
  // ✅ ログイン処理削除済み
  
  // ✅ 既存セッションで空き状況チェック実装済み
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
  const searchResponse = await fetch(..., {
    headers: { 'Cookie': `JSESSIONID=${sessionId}` }
  });
  
  const htmlText = await searchResponse.text();
  
  // ✅ セッション期限切れチェック実装済み
  if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
    throw new Error('Session expired');
  }
  
  // ✅ 空き状況解析実装済み
  const statusMatch = htmlText.match(...);
  return { ... };
}

// ✅ 実装完了: checkMinatoAvailability()
export async function checkMinatoAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,  // ✅ credentials → sessionId に変更済み
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  // ✅ ダミー実装（Math.random()）削除済み
  // ✅ 実際のスクレイピング実装済み
  
  const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
  const searchResponse = await fetch(..., {
    headers: { 'Cookie': `JSESSIONID=${sessionId}` }
  });
  
  // ✅ セッション期限切れ検知実装済み
  if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
    throw new Error('Session expired');
  }
  
  // ✅ 港区ステータス解析実装済み（○×のみ）
  const statusMatch = htmlText.match(/([○×])/);
  return { ... };
}

// ❌ ログイン関数を削除（または非推奨化）
// export async function loginToShinagawa(...) { ... } // 削除
// export async function loginToMinato(...) { ... } // 削除
```

#### タスク1.3: index.ts修正（Cron実行部分） ✅ **完了**
```typescript
// workers/src/index.ts (line 1246-1400)

// ✅ Cron実行時の処理修正済み
for (const target of targets) {
  const settings = await env.USERS.get(`settings:${target.userId}`);
  if (!settings) { continue; }
  
  const settingsData = JSON.parse(settings);
  const siteSession = target.site === 'shinagawa' 
    ? settingsData.shinagawa 
    : settingsData.minato;
  
  // ✅ セッション存在チェック実装済み
  if (!siteSession?.sessionId) {
    console.error(`[Cron] No session for ${target.site}`);
    continue;
  }
  
  // ✅ セッション期限切れチェック実装済み
  if (siteSession.expiresAt && siteSession.expiresAt < Date.now()) {
    console.warn(`[Cron] Session expired for ${target.site}`);
    // ✅ セッション期限切れ通知関数呼び出し実装済み
    // ❌ sendPushNotification関数自体は未実装（Priority 1）
    await sendSessionExpiredNotification(target.userId, target.site, env);
    continue;
  }
  
  // ✅ セッションIDで空き状況チェック実装済み
  const result = target.site === 'shinagawa'
    ? await checkShinagawaAvailability(
        target.facilityId,
        target.date,
        target.timeSlot,
        siteSession.sessionId, // ✅ セッションIDを渡す実装済み
        existingReservations
      )
    : await checkMinatoAvailability(
        target.facilityId,
        target.date,
        target.timeSlot,
        siteSession.sessionId, // ✅ セッションIDを渡す実装済み
        existingReservations
      );
}
```

---

### Phase 2: PWA修正（5時間） 🔄 **40% 完了**

#### タスク2.1: API Client修正 ✅ **完了**
```typescript
// pwa/lib/api/client.ts (line 156-170)

// ✅ 実装完了
async saveSettings(settings: {
  shinagawaSessionId?: string;  // ✅ パラメータ追加済み
  minatoSessionId?: string;     // ✅ パラメータ追加済み
  // ... 既存フィールド
}) {
  const response = await this.client.post('/api/settings', settings);
  return response.data;
}
```

#### タスク2.2: 設定画面UI追加 ❌ **未完了（Priority 2）**
```typescript
// pwa/app/dashboard/settings/page.tsx

// ❌ セッション取得UI未実装
// ❌ Cookie Store API統合未実装
// ❌ セッション状態表示未実装

const [shinagawaSession, setShinagawaSession] = useState<SiteSession | null>(null);
const [minatoSession, setMinatoSession] = useState<SiteSession | null>(null);

// セッション取得ハンドラを実装（上記の実装例参照）
const handleGetShinagawaSession = async () => { ... };
const handleGetMinatoSession = async () => { ... };

// UIコンポーネントを追加（上記のUI仕様参照）
```

---

### Phase 3: テスト・検証（3時間）

#### タスク3.1: 品川区セッション方式テスト
```
□ 品川区サイトで手動ログイン
□ PWAでセッション取得
□ Workersで空き状況チェックが動作することを確認
□ セッション期限切れの動作確認
```

#### タスク3.2: 港区セッション方式テスト
```
□ 港区サイトで手動ログイン（reCAPTCHAチェック）
□ PWAでセッション取得
□ Workersで空き状況チェックが動作することを確認
□ セッション期限切れの動作確認
```

#### タスク3.3: 通知テスト
```
□ 空き検知時のプッシュ通知
□ セッション期限切れ通知
```

---

### Phase 4: ドキュメント更新（1時間）

```
□ USER_GUIDE.md にセッション設定手順を追記
□ SYSTEM_OVERVIEW.md にセッションベースアーキテクチャを追記
□ CRITICAL_ISSUE_CAPTCHA.md を更新（選択肢A採用）
```

---

## 📊 まとめ

### 実装時間
- **Phase 1**: Workers修正（4時間） ✅ **80% 完了** - 残: sendPushNotification実装、予約関数変換
- **Phase 2**: PWA修正（5時間） 🔄 **40% 完了** - 残: セッション取得UI、Cookie Store API
- **Phase 3**: テスト・検証（3時間） ⏳ **未着手**
- **Phase 4**: ドキュメント更新（1時間） 🔄 **進行中** - CRITICAL_ISSUE_CAPTCHA.md修正中

**元の見積**: 13時間（約2日）  
**現在の進捗**: 約60%完了  
**残り時間**: 約5時間

### メリット
- ✅ 将来的なreCAPTCHA導入に対応
- ✅ 品川区・港区両方の監視が可能
- ✅ パスワード保存不要（セキュリティ向上）
- ✅ 統一されたアーキテクチャ

### デメリット
- ⚠️ 初回セットアップでユーザー操作が必要
- ⚠️ セッション期限切れ時に再ログイン必要

---

**最終更新**: 2025年11月27日  
**推奨**: 即座に実装開始
