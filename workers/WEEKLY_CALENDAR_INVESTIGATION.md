# 週間カレンダー取得調査ガイド

## 目的
週間カレンダーから空き状況を一括取得し、自動予約までのフローを実現する

## 現状の問題
直接URLアクセスでエラーページ（pawfa1000.jsp）が返される
```
URL: https://www2.*********.jp/rsvWOpeInstSrchVacantAction.do?instCd=1&srchDate=2025-01-10
結果: エラーページ（5539バイト）
```

---

## 調査項目

### 1. ブラウザで正規フローを記録

#### 手順
1. ブラウザの開発者ツール（F12）を開く
2. Networkタブを有効化
3. 以下の操作を実行：
   ```
   ログイン
   ↓
   トップメニュー
   ↓
   施設検索/選択
   ↓
   週間カレンダー表示
   ```

#### 記録すべき情報（各リクエストごと）
- [ ] URL
- [ ] HTTPメソッド（GET/POST）
- [ ] Request Headers
  - [ ] `Cookie`（JSESSIONID以外にもトークンがあるか？）
  - [ ] `Referer`（前の画面のURL）
  - [ ] `User-Agent`
  - [ ] `Content-Type`（POSTの場合）
- [ ] Request Body（POSTの場合）
  - [ ] すべてのフォームパラメータ
  - [ ] hidden fields（`org.apache.struts.taglib.html.TOKEN`など）
- [ ] Response Headers
  - [ ] `Set-Cookie`（新しいCookieが設定されるか？）
- [ ] Response Body
  - [ ] HTMLに含まれるhidden form fields

#### 記録例（Markdown形式）
```markdown
#### リクエスト1: ログイン
- URL: https://www2.*********.jp/login.do
- Method: POST
- Headers:
  - Cookie: JSESSIONID=...
  - Referer: https://www2.*********.jp/
- Body:
  - username=...
  - password=...
  - org.apache.struts.taglib.html.TOKEN=...

#### リクエスト2: メニュー表示
...
```

---

### 2. 週間カレンダーHTML構造の解析

#### 確認済みの情報
```html
<td id="20250110_1800-2000" class="...">
  <div class="...">○</div>
</td>
```
- セルID形式: `YYYYMMDD_HHMM-HHMM`
- ステータス: `○`, `×`, `取`

#### 追加確認項目
- [ ] セルクリック時のJavaScript処理
  ```javascript
  // ブラウザのConsoleで確認
  document.querySelector('#20250110_1800-2000').onclick
  ```
- [ ] 予約フォームのhidden fields
  ```html
  <form name="reservationForm" action="...">
    <input type="hidden" name="..." value="..." />
  </form>
  ```
- [ ] CSRF対策トークン
- [ ] ページ内のJavaScript変数
  ```javascript
  // Consoleで確認
  console.log(window);
  // グローバル変数を探す
  ```

---

### 3. 予約フォーム送信パラメータの特定

#### 現在の実装（個別日付チェック経由）
```typescript
instCd=1
rsvDateYMD=20250110
startTimeHHMM=1800
endTimeHHMM=2000
UseCnt=2
```

#### 週間カレンダー経由で追加される可能性
- [ ] `org.apache.struts.taglib.html.TOKEN`
- [ ] `srchDate`（週間カレンダー表示時の基準日）
- [ ] セッション状態を示すパラメータ
- [ ] 前画面からの引き継ぎパラメータ

#### 確認方法
1. 週間カレンダーで「○」のセルをクリック
2. 予約フォームに遷移
3. フォーム送信時のPOSTパラメータを記録

---

### 4. セッション状態の要件特定

#### 仮説
サイトは以下のいずれかでセッション状態を管理：
1. **Refererチェック**: 前の画面から遷移したかを確認
2. **Hidden Token**: 各画面でトークンを発行し、次の画面で検証
3. **Cookie追加**: JSESSIONID以外の状態管理Cookie
4. **セッション属性**: サーバー側でフロー状態を記録

#### 検証方法
- [ ] Refererを変更してリクエスト → 拒否されるか？
- [ ] hidden tokenなしでリクエスト → 拒否されるか？
- [ ] Cookieを最小限にしてリクエスト → どのCookieが必須か？

---

### 5. 最小再現コードの作成

#### 目標
Node.js/TypeScriptで週間カレンダーを取得できる最小コード

#### 実装例
```typescript
async function getWeeklyCalendar(
  sessionId: string,
  facilityId: string,
  startDate: string,
  token?: string
): Promise<string> {
  const url = `https://www2.*********.jp/rsvWOpeInstSrchVacantAction.do`;
  
  const params = new URLSearchParams({
    instCd: facilityId,
    srchDate: startDate,
    ...(token && { 'org.apache.struts.taglib.html.TOKEN': token })
  });
  
  const response = await fetch(`${url}?${params}`, {
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': '適切なReferer',
      'User-Agent': '...',
    }
  });
  
  const html = await response.text();
  
  // エラーページかチェック
  if (html.includes('pawfa1000.jsp')) {
    throw new Error('Session state invalid');
  }
  
  return html;
}
```

---

## 成功基準

### ✅ Phase 1: 週間カレンダー取得成功
- 直接URL or 最小限の画面遷移で週間カレンダーHTMLを取得
- エラーページ（pawfa1000.jsp）ではなく、正常なカレンダーHTML

### ✅ Phase 2: 空き状況パース成功
```typescript
{
  "2025-01-10": {
    "1800-2000": "○",
    "2000-2200": "×"
  },
  "2025-01-11": { ... }
}
```

### ✅ Phase 3: 週間カレンダー経由の予約成功
- 週間カレンダーから取得した情報を使って予約フォーム送信
- 予約完了画面に到達

---

## 次のステップ

1. 上記の調査を実施し、結果をこのファイルに追記
2. 必要なHTTPリクエスト数を計算
3. Cloudflare Workers制限（1000 subrequests）との整合性確認
4. 実装計画の策定

---

## 参考情報

### 現在の個別チェック実装
- ファイル: `/workers/src/scraper.ts`
- 関数: `checkShinagawaAvailability`, `checkMinatoAvailability`
- リクエスト数: 1日×1時間帯 = 1リクエスト

### 週間一括取得の理想
- 1施設×7日×6時間帯 = 1リクエスト
- 効率: 42倍改善（42リクエスト → 1リクエスト）

### 実現可能性の閾値
- 追加リクエスト数 < 3: ✅ 実装推奨
- 追加リクエスト数 3-5: ⚠️ 効果を要評価
- 追加リクエスト数 > 5: ❌ 個別チェックと変わらない
