# 品川区予約フロー解析（HARファイルより）

## 📋 予約フロー全体像

```
1. ログイン画面取得 (rsvWTransUserLoginAction.do)
   ↓
2. ログイン実行 (rsvWUserAttestationLoginAction.do)
   ↓
3. 週間カレンダー表示 (rsvWOpeInstSrchVacantAction.do) ← **ここが重要**
   ↓
4. 別の施設のカレンダー表示 (rsvWOpeInstSrchVacantAction.do)
   ↓
5. 予約申込画面 (rsvWOpeReservedApplyAction.do)
   ↓
6. 利用規約同意・予約確定 (rsvWInstUseruleRsvApplyAction.do)
```

---

## 🔍 各ステップの詳細解析

### Step 1: ログイン画面取得
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWTransUserLoginAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWTransUserAttestationEndAction.do`

**POST Parameters**:
```
date=4
daystart=2025-12-03
days=31
dayofweekClearFlg=0
timezoneClearFlg=0
selectAreaBcd=
selectIcd=
selectPpsClPpscd=
displayNo=pawab2000
displayNoFrm=pawab2000
ValidEndPWYMD=0
... (大量のエラーメッセージ定義)
```

---

### Step 2: ログイン実行
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWUserAttestationLoginAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWTransUserLoginAction.do`

**重要なPOST Parameters**:
```
userId=84005349
password=Aa1234567890
fcflg=
displayNo=pawab2100
loginJKey=c9ded279e496a749ceb3740b27009850640fcfc7f4b265614bb534d62e941ac472758019a7dad428e1d1063d5fb79b4108589f996e8b360792c55c4d534fd61e
loginCharPass=A
loginCharPass=a
loginCharPass=1
... (パスワードの各文字を個別に送信)
```

**🔑 重要発見**:
- `loginJKey`: ログイン画面で生成される一時トークン
- `loginCharPass`: パスワードの各文字を個別のパラメータとして送信
- このステップでJSESSIONIDが発行される

---

### Step 3: 週間カレンダー表示（施設検索後の初回）
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWUserAttestationLoginAction.do`

**重要なPOST Parameters**:
```
date=4
daystart=2025-12-03
days=31
dayofweekClearFlg=1
timezoneClearFlg=1
selectAreaBcd=1400_0
selectIcd=
selectPpsClPpscd=31000000_31011700
displayNo=pawab2000
displayNoFrm=pawab2000
```

**✅ 成功パターン**:
- Referer: ログイン画面 (`rsvWUserAttestationLoginAction.do`)
- POST送信（GETではない！）
- 地域・目的コードを含む

---

### Step 4: 週間カレンダー表示（施設切り替え）
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do`

**重要なPOST Parameters**:
```
date=4
daystart=2025-12-03
days=31
dayofweekClearFlg=1
timezoneClearFlg=1
selectAreaBcd=1500_0  ← 地域変更
selectIcd=
selectPpsClPpscd=31000000_31011700
displayNo=prwrc2000  ← 画面IDが変わった
displayNoFrm=prwrc2000
selectSize=0
selectBldCd=1010
selectBldName=%82%B5%82%C8%82%AA%82%ED%92%86%89%9B%8C%F6%89%80
selectBldUrl=https%3A%2F%2Fwww.city.shinagawa.tokyo.jp%2Fcontentshozon2019%2Ftyuou.pdf
selectInstCd=10100020  ← 施設コード
selectInstName=%92%EB%8B%85%8F%EA%82a
useDay=20251217  ← 表示開始日
selectPpsClsCd=31000000
selectPpsCd=31011700
viewDay1=20251217  ← 7日分の日付
viewDay2=20251218
viewDay3=20251219
viewDay4=20251220
viewDay5=20251221
viewDay6=20251222
viewDay7=20251223
applyFlg=0
validendymd=20271118
```

**🔑 重要発見**:
- `selectInstCd`: 施設コード（10100020 = テニス場B）
- `useDay`: 週間カレンダーの基準日（YYYYMMDD）
- `viewDay1`～`viewDay7`: 7日分の日付リスト
- `applyFlg=0`: まだ予約申込していない
- `displayNo`: 画面遷移で変化（`pawab2000` → `prwrc2000`）

---

### Step 5: 予約申込画面（空き枠クリック）
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeReservedApplyAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do`

**重要なPOST Parameters**:
```
date=4
daystart=2025-12-03
days=31
dayofweekClearFlg=0
timezoneClearFlg=0
selectAreaBcd=1500_0
selectIcd=
selectPpsClPpscd=31000000_31011700
displayNo=prwrc2000
displayNoFrm=prwrc2000
selectSize=1  ← 1枠選択
selectBldCd=1030
selectBldName=%94%AA%92%AA%96k%8C%F6%89%80
selectBldUrl=https%3A%2F%2Fwww.city.shinagawa.tokyo.jp%2Fcontentshozon2019%2Fyashiokita.pdf
selectInstCd=10300030  ← 施設変更（テニス場C）
selectInstName=%92%EB%8B%85%8F%EA%82b
useDay=20251217
selectPpsClsCd=31000000
selectPpsCd=31011700
viewDay1=20251217
viewDay2=20251218
viewDay3=20251219
viewDay4=20251220
viewDay5=20251221
viewDay6=20251222
viewDay7=20251223
applyFlg=1  ← 予約申込中
validendymd=20271118
```

**🔑 重要発見**:
- `applyFlg=1`: 予約申込モードに遷移
- `selectSize=1`: 選択した枠数
- 前画面のパラメータを全て引き継ぐ

---

### Step 6: 利用規約同意・予約確定
**URL**: `POST https://www.cm9.eprs.jp/shinagawa/web/rsvWInstUseruleRsvApplyAction.do`

**Referer**: `https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeReservedApplyAction.do`

**POST Parameters**:
```
ruleFg=1  ← 利用規約に同意
e411050=%8A%D9%82%F0%82%B2%97%98%97p%82%C9%82%C8%82%E9%82%C9%82%CD...
displayNo=prwcd1000
```

**🔑 重要発見**:
- `ruleFg=1`: 利用規約同意フラグ
- シンプルなパラメータで予約確定

---

## ✅ 週間カレンダー取得の実現方法

### 必要な条件
1. **POST送信**（GETではない）
2. **正しいReferer**: ログイン画面またはカレンダー画面自身
3. **必須パラメータ**:
   ```
   selectInstCd=10100020  // 施設コード
   useDay=20251217        // 基準日（YYYYMMDD）
   selectPpsClsCd=31000000
   selectPpsCd=31011700
   displayNo=prwrc2000    // 画面ID
   ```

### 週間カレンダーから取得できる情報
- `viewDay1`～`viewDay7`: 7日分の日付
- 各日付×各時間帯のセル: `id="YYYYMMDD_HHMM-HHMM"`
- ステータス: `○`, `×`, `取`

---

## 🚀 実装計画

### Phase 1: 週間カレンダー取得関数の修正

```typescript
async function getWeeklyCalendar(
  facilityId: string,
  startDate: string,  // YYYY-MM-DD
  sessionId: string
): Promise<string> {
  const url = 'https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do';
  
  // YYYY-MM-DD → YYYYMMDD
  const useDay = startDate.replace(/-/g, '');
  
  const params = new URLSearchParams({
    date: '4',
    daystart: new Date().toISOString().split('T')[0],
    days: '31',
    dayofweekClearFlg: '1',
    timezoneClearFlg: '1',
    selectAreaBcd: '1500_0',  // 地域コード（施設により異なる）
    selectIcd: '',
    selectPpsClPpscd: '31000000_31011700',  // テニス目的
    displayNo: 'prwrc2000',
    displayNoFrm: 'prwrc2000',
    selectInstCd: facilityId,
    useDay: useDay,
    selectPpsClsCd: '31000000',
    selectPpsCd: '31011700',
    applyFlg: '0',
  });
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': 'https://www.cm9.eprs.jp/shinagawa/web/rsvWUserAttestationLoginAction.do',
    },
    body: params.toString(),
  });
  
  return await response.text();
}
```

### Phase 2: 予約フロー実装

```typescript
async function makeReservationFromCalendar(
  facilityId: string,
  date: string,  // YYYYMMDD
  timeSlot: string,  // "1800-2000"
  sessionId: string
): Promise<boolean> {
  // 1. 週間カレンダーを表示（セッション状態を作る）
  const calendarHtml = await getWeeklyCalendar(facilityId, date, sessionId);
  
  // 2. 予約申込画面に遷移
  const applyUrl = 'https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeReservedApplyAction.do';
  const applyParams = new URLSearchParams({
    // カレンダー表示時のパラメータを引き継ぐ
    selectInstCd: facilityId,
    useDay: date,
    applyFlg: '1',  // 予約申込モード
    selectSize: '1',
    // ... 他のパラメータ
  });
  
  const applyResponse = await fetch(applyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': 'https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeInstSrchVacantAction.do',
    },
    body: applyParams.toString(),
  });
  
  // 3. 利用規約同意・予約確定
  const confirmUrl = 'https://www.cm9.eprs.jp/shinagawa/web/rsvWInstUseruleRsvApplyAction.do';
  const confirmParams = new URLSearchParams({
    ruleFg: '1',
    displayNo: 'prwcd1000',
  });
  
  const confirmResponse = await fetch(confirmUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': 'https://www.cm9.eprs.jp/shinagawa/web/rsvWOpeReservedApplyAction.do',
    },
    body: confirmParams.toString(),
  });
  
  // 予約完了確認
  const resultHtml = await confirmResponse.text();
  return resultHtml.includes('予約が完了しました');
}
```

---

## 📊 リクエスト数の試算

### 現在の個別チェック方式
```
1施設 × 7日 × 6時間帯 = 42リクエスト
```

### 週間カレンダー方式
```
ログイン: 1リクエスト
週間カレンダー取得: 1リクエスト
週間カレンダー取得: 1リクエスト (次の週)
...
合計: 1 + (予約可能日数 / 7) リクエスト
```

**例**: 90日予約可能の場合
- 現在: 90日 × 6時間帯 = 540リクエスト
- 週間方式: 1 + (90 / 7) = 14リクエスト
- **削減率: 97.4%** 🎉

---

## ⚠️ 注意点

### 1. 地域コード（selectAreaBcd）
施設ごとに異なる可能性あり:
- しながわ中央公園: `1400_0`
- 八潮北公園: `1500_0`

### 2. 画面ID（displayNo）
画面遷移により変化:
- ログイン後: `pawab2000`
- カレンダー表示: `prwrc2000`
- 予約確定: `prwcd1000`

### 3. セッション維持
- JSESSIONID を全リクエストで送信
- Referer を正しく設定

---

## 🎯 次のステップ

1. ✅ HAR解析完了
2. [ ] `getWeeklyCalendar`関数の実装
3. [ ] 週間カレンダーHTML解析関数の修正
4. [ ] 予約フロー全体の実装
5. [ ] テスト実行
