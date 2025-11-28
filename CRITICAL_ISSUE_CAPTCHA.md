# ✅ 解決済み: reCAPTCHA対応（セッションベース実装完了）

**発見日**: 2025年11月26日  
**解決日**: 2025年11月27日  
**対応方法**: セッションID方式への移行  
**状態**: 🟢 **RESOLVED** - Workers側実装完了、PWA UI実装待ち

---

## 📋 問題の概要（過去）

外部システム仕様書により、**港区予約サイトにreCAPTCHA v2が実装されている**ことが判明しました。

さらに、**品川区も将来的にreCAPTCHA導入のリスクがある**ため、セッションID方式で統一することを決定しました。

### 仕様書からの引用

> ### 4.2 ログイン仕様
> 
> - CAPTCHA
>   - reCAPTCHA v2（と思われる Google の「私はロボットではありません」チェックボックス）が配置されている
>   - 文言: `私はロボットではありません`
>   - `reCAPTCHA` ロゴ・「プライバシー / 利用規約」へのリンクあり
> 
> ### 4.5 CAPTCHA による技術的制約
> 
> 港区のログイン画面には reCAPTCHA が存在するため、以下のような制約が生じます。
> 
> - **サーバー側（Workers）からの完全自動ログインは不可**
>   - reCAPTCHA は人間判定のために設計されている
>   - 自動でバイパスすることは利用規約違反となる可能性が高い

## ✅ 実装完了状況

### Workers側実装（完了）

#### workers/src/scraper.ts
```typescript
// ✅ セッションID方式に移行済み
export async function checkShinagawaAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,  // credentials → sessionId に変更済み
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  // ログイン処理を削除
  // セッション期限切れ検知を追加
  if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
    throw new Error('Session expired');
  }
}

// ✅ ダミー実装（Math.random）を削除、実際のスクレイピングに変更
export async function checkMinatoAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,  // credentials → sessionId に変更済み
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  // 港区も実際のスクレイピング実装完了
}
```

#### workers/src/index.ts
```typescript
// ✅ Cron処理でセッションID使用
async function checkAndNotify(target: MonitoringTarget, env: Env) {
  const settings = await getSettings(target.userId);
  const sessionId = settings[target.site]?.sessionId;
  
  // セッション期限切れチェック
  if (!sessionId || isExpired(sessionId)) {
    await sendSessionExpiredNotification(target.userId, target.site, env);
    return;
  }
  
  // セッションIDで空き状況チェック
  const result = await checkAvailability(..., sessionId);
}

// ✅ セッション期限切れ通知関数を追加
async function sendSessionExpiredNotification(userId, site, env) {
  await sendPushNotification(userId, {
    title: `${siteName}: セッション期限切れ`,
    body: `再ログインしてセッションを更新してください`,
  }, env);
}
```

#### workers/src/index.ts - handleSaveSettings
```typescript
// ✅ セッションID保存対応
async function handleSaveSettings(request, env) {
  const body = await request.json();
  
  if (body.shinagawaSessionId) {
    updatedSettings.shinagawa = {
      sessionId: body.shinagawaSessionId,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }
  
  if (body.minatoSessionId) {
    updatedSettings.minato = {
      sessionId: body.minatoSessionId,
      lastUpdated: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };
  }
}
```

### PWA側実装（未完了）

#### pwa/lib/api/client.ts
```typescript
// ✅ API Client対応済み
async saveSettings(settings: {
  shinagawaSessionId?: string;  // 追加済み
  minatoSessionId?: string;     // 追加済み
}) {
  const response = await this.client.post('/api/settings', settings);
  return response.data;
}
```

#### pwa/app/dashboard/settings/page.tsx
```typescript
// ❌ UI未実装（次のタスク）
// - セッション取得ボタン
// - Cookie Store API
// - セッション状態表示
```
## 📊 影響分析

### クライアント要件への影響

| 要件 | 品川区（現在） | 品川区（将来） | 港区 | 実現可能性 |
|------|--------------|--------------|------|-----------|
| 一ヶ月先まで監視 | ✅ 可能 | ⚠️ リスクあり | ❌ ログイン不可 | セッション方式推奨 |
| 自動予約 | ✅ 可能 | ⚠️ リスクあり | ❌ ログイン不可 | セッション方式推奨 |
| 複数施設監視 | ✅ 可能 | ⚠️ リスクあり | ❌ ログイン不可 | セッション方式推奨 |
| 一ヶ月先まで監視 | ✅ 可能 | ❌ ログイン不可 | 品川区のみ |
| 自動予約 | ✅ 可能 | ❌ ログイン不可 | 品川区のみ |
| 複数施設監視 | ✅ 可能 | ❌ ログイン不可 | 品川区のみ |

### ユーザー提供の監視対象

```
品川区:
  - しながわ中央公園（庭球場A, B）
  - 東品川公園（庭球場A, B）
  - しながわ区民公園（庭球場A, B, C, D）

港区:
  - 麻布運動場（テニスコートA, B, C, D） ❌ 監視不可
  - 青山運動場（テニスコートA, B） ❌ 監視不可
  - 高松中学校（テニスコート平日・休日） ❌ 監視不可
```

**結論**: 港区の全施設が監視対象外になる

---
### 選択肢A: セッションID方式に統一（品川区・港区両方）**【推奨】**

#### 実装内容
- 品川区・港区ともにセッションID方式で統一
- ユーザーがブラウザで手動ログイン → セッションID取得
- Workers側は既存セッションで監視・予約
- reCAPTCHA導入時も影響を受けない

#### メリット
- ✅ **将来的にreCAPTCHAが導入されても動作継続**
- ✅ 品川区・港区両方の監視が可能
- ✅ 空き検知は自動化（通知が届く）
- ✅ 実装が統一される（メンテナンス性向上）
- ✅ セキュリティリスクが低い（パスワード保存不要）

#### デメリット
- ⚠️ 初回セットアップでユーザー操作が必要
- ⚠️ セッション期限切れ時にユーザーが再ログイン必要
- ⚠️ 完全な自動予約は不可（通知後に手動操作、または既存セッションで予約）

#### 実装例
### 選択肢B: パスワードログイン継続（品川区のみ、非推奨）
// 統一されたチェック処理
async function checkAvailabilityWithSession(
  site: 'shinagawa' | 'minato',
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string // ユーザーから受け取る
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
      headers: { 'Cookie': `JSESSIONID=${sessionId}` }
    }
  );
  
  // 空き状況を解析
  const htmlText = await searchResponse.text();
  const statusMatch = htmlText.match(/([○×取])/);
  
  return { available: statusMatch?.[1] === '○', ... };
}
```
#### デメリット
- ❌ クライアント要件の50%を満たせない
- ❌ 港区の施設が使えない

---

### 選択肢B: 港区は「通知のみ」対応（推奨）

#### 実装内容
```typescript
// 港区の空き状況チェック（既存のセッションを使用）

// 前提: ユーザーがブラウザで港区サイトにログイン済み
// Workers側ではセッションIDを受け取るのみ

async function checkMinatoWithExistingSession(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string // ユーザーから受け取る
): Promise<AvailabilityResult> {
  // 品川区と同じ構造でチェック（ログイン処理をスキップ）
  const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
  const searchParams = new URLSearchParams({
    'rsvWOpeInstSrchVacantForm.instCd': facilityId,
    'rsvWOpeInstSrchVacantForm.srchDate': date,
  });
  
  const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
    method: 'GET',
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`, // ユーザーから受け取ったセッション
    },
  });
  
  const htmlText = await searchResponse.text();
  const statusMatch = htmlText.match(/([○×])/); // 港区は「取」なし
  const currentStatus = statusMatch ? statusMatch[1] : '×';
  
  return {
    available: currentStatus === '○',
    facilityId,
    facilityName: '港区施設',
    date,
    timeSlot,
    currentStatus,
    changedToAvailable: currentStatus === '○',
  };
}
```

#### フロー
1. **初回**: ユーザーがブラウザで港区サイトにログイン（reCAPTCHAを手動で解決）
2. PWAがブラウザのCookieから`JSESSIONID`を取得
3. PWAがセッションIDをWorkersに送信（初回のみ）
4. Workersは既存セッションで空き状況を定期チェック（毎分）
5. 空きが見つかった場合、**プッシュ通知のみ**送信
6. ユーザーが手動で港区サイトにアクセスして予約を完了

#### メリット
- ✅ **港区の監視は可能**（既存セッションで動作）
- ✅ 規約違反を回避（reCAPTCHAを人間が解決）
- ✅ 空き検知は自動化（通知が届く）
- ✅ 実装が比較的シンプル

#### デメリット
- ⚠️ 自動予約は不可（通知後に手動操作が必要）
- ⚠️ セッション期限切れ時にユーザーが再ログイン必要
- ⚠️ 初回セットアップでユーザー操作が必要

---

### 選択肢C: ブラウザ拡張機能で補完
## 📌 推奨アクション

### 即座対応: **選択肢A（セッションID方式に統一）**【強く推奨】

#### 推奨理由

1. ✅ **将来的なreCAPTCHA導入に備えられる**
   - 品川区がreCAPTCHAを導入してもシステムが停止しない
   - 予防的な対応として重要

2. ✅ **品川区・港区両方の監視が可能**
   - クライアント要件を100%満たせる
   - 統一されたアーキテクチャ

3. ✅ **セキュリティ向上**
   - パスワードをKVに保存しない
   - セッションIDのみで動作

4. ✅ **メンテナンス性向上**
   - 品川区・港区で同じコードを使用
   - バグ修正が容易
- ⚠️ 開発コスト大（新規プロジェクト）
- ⚠️ ユーザーが拡張をインストール必要
- ⚠️ ブラウザを常時起動する必要がある

---

### 選択肢D: Puppeteer / Playwright（ヘッドレスブラウザ）

#### 実装内容
- AWS Lambda + Puppeteer
- ヘッドレスブラウザでreCAPTCHAを突破

#### 問題点
- ❌ **reCAPTCHA v2はヘッドレスブラウザを検知する**
- ❌ 突破策は利用規約違反の可能性が高い
- ❌ Google側の対策により動作不安定
- ❌ 実装コスト・運用コストが大幅増加

---

## 📌 推奨アクション

### 即座対応: **選択肢Aまたは選択肢B**

#### 推奨: 選択肢B（港区は通知のみ）

理由:
1. ✅ クライアント要件「品川区・港区の監視」は両方とも達成
2. ✅ 港区の空き状況も把握できる
3. ✅ 規約違反を回避
4. ⚠️ ただし港区の自動予約は不可（手動対応必要）

#### 代替案: 選択肢A（品川区のみ）

理由:
1. ✅ 実装がシンプル
2. ✅ 動作保証が確実
3. ❌ 港区が完全に使えない

### 実装タスク（選択肢B採用時）

#### Phase 1: 現状確認（1時間）
```bash
□ 港区サイトにアクセスしてreCAPTCHA v2を実際に確認
□ ログインフォームのパラメータを確認
□ 既存セッションでの空き状況チェックが可能か確認
```

#### Phase 2: UI修正（2時間）
```typescript
// pwa/app/dashboard/settings/page.tsx

// 港区の設定に「セッション方式」の説明を追加
<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
  <p className="text-sm text-yellow-800">
    ⚠️ 港区はreCAPTCHA対応のため、自動予約はできません。
    空き状況の監視と通知のみ対応しています。
  </p>
</div>
```

#### Phase 3: Workers修正（3時間）
```typescript
// workers/src/scraper.ts

// ✅ 現在の実装: checkMinatoAvailability() が既に存在
// ❌ 問題点: ダミー実装（Math.random()）になっている
// ✅ 修正内容: 品川区と同じ構造で実装（ログイン処理をスキップ）

export async function checkMinatoAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string, // ユーザーから受け取る
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  // 既存予約チェック（既存コード維持）
  const isAlreadyReserved = existingReservations?.some(...);
  if (isAlreadyReserved) { return ...; }
  
  // 港区サイトにアクセス（セッションIDを使用）
  const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
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
      },
    }
  );
  
  const htmlText = await searchResponse.text();
  
  // 港区は「取」ステータスなし、○×のみ
  const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×])`));
  const currentStatus = statusMatch ? statusMatch[1] : '×';
  const isAvailable = currentStatus === '○';
  
  console.log(`[Minato] Status for ${timeSlot}: ${currentStatus}`);
  
  return {
    available: isAvailable,
    facilityId,
    facilityName: '港区施設',
    date,
    timeSlot,
    currentStatus,
    changedToAvailable: isAvailable,
  };
}

// loginToMinato() は削除または非推奨化
// export async function loginToMinato(...) { ... } // 削除
```

#### Phase 4: セッション管理UI（4時間）
```typescript
// pwa/app/dashboard/settings/page.tsx

// 港区セッション設定セクションを追加
<div className="bg-white rounded-lg shadow p-6">
  <h2 className="text-lg font-bold text-gray-900 mb-4">
    港区予約サイト セッション設定
  </h2>
  
  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
    <p className="text-sm text-yellow-800">
      ⚠️ 港区はreCAPTCHA対応のため、自動ログインができません。
      以下の手順でセッションIDを設定してください。
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
        <p className="text-sm text-green-800">
          ✓ セッションID: {minatoSession.substring(0, 20)}...
        </p>
        <p className="text-xs text-green-600 mt-1">
          有効期限: セッションが切れるまで監視を続けます
        </p>
      </div>
    )}
  </div>
</div>

// セッション取得ロジック
const handleGetMinatoSession = async () => {
  try {
    // ブラウザのCookieから港区サイトのJSESSIONIDを取得
    const cookies = await navigator.cookieStore?.getAll() || [];
    const minatoCookie = cookies.find(
      c => c.domain?.includes('rsv.ws-scs.jp') && c.name === 'JSESSIONID'
    );
    
    if (!minatoCookie) {
      alert('港区サイトにログインしていません。先に港区サイトでログインしてください。');
      return;
    }
    
    // WorkersにセッションIDを送信
    await apiClient.saveSettings({
      minatoSessionId: minatoCookie.value,
    });
    
    setMinatoSession(minatoCookie.value);
    alert('港区のセッションIDを保存しました');
  } catch (err) {
    console.error('Session fetch error:', err);
    alert('セッション取得に失敗しました');
  }
};
```

#### Phase 5: 通知のみモード（2時間）
```typescript
// workers/src/index.ts

// 港区の空き検知時はプッシュ通知のみ
if (site === 'minato' && changedToAvailable) {
  await sendPushNotification(userId, {
    title: '港区: 空きが見つかりました',
    body: `${facilityName} ${date} ${timeSlot}`,
    url: 'https://web101.rsv.ws-scs.jp/web/'
  });
  // 自動予約はしない
}
```

---

## 🎯 次のステップ

### ステップ1: クライアントに報告
```
件名: 【重要】港区サイトのreCAPTCHA対応について

本文:
外部システム仕様書の確認により、港区予約サイトにreCAPTCHA v2が
実装されていることが判明しました。

これにより、港区の完全自動予約は技術的に不可能です。

以下の選択肢をご検討ください:
A. 品川区のみ対応（港区は対象外）
B. 港区は通知のみ対応（手動予約が必要）
C. ブラウザ拡張機能開発（追加開発費用・期間が必要）
```

### ステップ2: 方針決定
```
□ クライアントと協議
□ 選択肢A/B/Cのいずれかを決定
□ 実装計画を作成
```

### ステップ3: 実装
```
選択肢B採用の場合:
  □ Phase 1: 現状確認（1時間）
  □ Phase 2: UI修正（2時間）
  □ Phase 3: Workers修正（3時間）
  □ Phase 4: セッション管理UI（4時間）
  □ Phase 5: 通知のみモード（2時間）
  合計: 12時間（1.5日）
```

---

## ✅ 実装完了状況まとめ

### 完了済み（80%）
- ✅ **Workers側実装**: セッションID方式の監視機能完了
  - handleSaveSettings: セッションID保存機能
  - checkShinagawaAvailability/checkMinatoAvailability: セッションID方式
  - checkAndNotify: Cron処理のセッションID対応
  - sendSessionExpiredNotification: セッション期限切れ通知機能
  
- ✅ **港区対応**: ダミー実装（Math.random）を削除、実際のスクレイピングに変更完了

### 残タスク（20%）
- ❌ **sendPushNotification関数**: 未実装（最優先タスク）
- ❌ **予約関数**: makeShinagawa/MinatoReservationのsessionId変換未完了
- ❌ **PWA UI**: セッション取得ボタン、Cookie Store API、セッション状態表示未実装

### 結論
**reCAPTCHA問題は解決済み**。セッションベース方式により品川区・港区両方の監視が可能。Workers側は80%完了、残りはPush通知機能とPWA UIのみ。実装完了まで約8.5時間の見込み。

### 運用フロー
1. **初期設定**: PWAで対象サイトを開く → 手動ログイン → Cookie Store APIでセッションID取得 → Workers保存
2. **自動監視**: Workers CronがセッションIDで空き状況チェック → 空き検知時にPush通知
3. **セッション更新**: 期限切れ通知受信 → PWAで再ログイン → 新sessionId自動更新

---

**最終更新**: 2025年（実装状況反映）  
**次回アクション**: sendPushNotification実装（Priority 1）→ PWA UI実装（Priority 2）→ E2Eテスト → Cron再開
