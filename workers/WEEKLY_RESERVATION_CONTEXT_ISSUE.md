# 週間カレンダー経由の予約フロー実装計画

## 現状の問題

週間カレンダー(`checkShinagawaWeeklyAvailability`)で空きを検知した後、
予約関数(`makeShinagawaReservation`)は個別日付チェック用のURLを使用している。

週間カレンダー経由の予約には、カレンダー表示時のコンテキスト（パラメータ）を引き継ぐ必要がある。

---

## 必要な修正

### 1. 週間カレンダー関数で予約に必要な情報を保持

`checkShinagawaWeeklyAvailability`のレスポンスに以下を追加：

```typescript
interface WeeklyAvailabilityResult {
  facilityId: string;
  facilityName: string;
  weekStartDate: string;
  availability: Map<string, string>;
  fetchedAt: number;
  
  // ✨ 追加: 予約に必要なコンテキスト
  reservationContext?: {
    selectBldCd: string;      // 建物コード
    selectBldName: string;    // 建物名
    selectInstCd: string;     // 施設コード
    selectInstName: string;   // 施設名
    selectPpsClsCd: string;   // 目的分類コード
    selectPpsCd: string;      // 目的コード
    viewDays: string[];       // 7日分の日付
  };
}
```

### 2. 週間カレンダーHTMLから予約フォームのhidden fieldsを抽出

```typescript
// HTMLから予約に必要なフォーム情報を抽出
const selectBldCdMatch = html.match(/name="selectBldCd"[^>]*value="([^"]*)"/);
const selectBldNameMatch = html.match(/name="selectBldName"[^>]*value="([^"]*)"/);
// ... 他のフィールドも同様に抽出
```

### 3. 予約関数で週間カレンダーコンテキストを使用

```typescript
export async function makeShinagawaReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,
  target: { applicantCount?: number },
  weeklyContext?: ReservationContext  // ✨ 追加
): Promise<{ success: boolean; message: string }>
```

週間カレンダー経由の場合：
```typescript
if (weeklyContext) {
  // 週間カレンダーのコンテキストを使用
  // rsvWOpeReservedApplyAction.doに全パラメータを送信
} else {
  // 従来の個別チェック方式
}
```

---

## 実装優先度

### 🔴 高優先度（現在動作しない）
- [ ] 週間カレンダーHTMLからフォーム情報を抽出
- [ ] 予約関数で週間コンテキストを使用

### 🟡 中優先度（フォールバック動作）
- [x] 週間取得エラー時に個別チェックにフォールバック（実装済み）

### 🟢 低優先度（最適化）
- [ ] 複数週間の一括取得
- [ ] キャッシュ戦略

---

## テスト計画

1. **個別チェック方式（現行）**: ✅ 動作確認済み
2. **週間取得 + 個別予約**: ⚠️ 要検証
3. **週間取得 + 週間コンテキスト予約**: ❌ 未実装

---

## 結論

**現時点では週間一括取得で空きを検知できても、予約に必要なコンテキストが不足しているため、
予約段階でエラーになる可能性が高い。**

**推奨対応:**
1. まずフォールバック（個別チェック）で予約が正常に動作することを確認
2. 週間カレンダーHTMLから予約フォーム情報を抽出する機能を実装
3. 予約関数を週間コンテキスト対応に拡張
