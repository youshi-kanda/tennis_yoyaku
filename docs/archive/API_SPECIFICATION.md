# API仕様書 - テニスコート自動予約システム

**バージョン**: 2.0  
**ベースURL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev  
**認証方式**: JWT Bearer Token

---

## 目次

1. [認証API](#認証api)
2. [設定API](#設定api)
3. [監視API](#監視api)
4. [予約履歴API](#予約履歴api)
5. [施設API](#施設api)
6. [プッシュ通知API](#プッシュ通知api)
7. [エラーコード](#エラーコード)

---

## 認証API

### POST /api/auth/register

新規ユーザー登録

**リクエスト**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "adminKey": "tennis_admin_2025" // 管理者登録の場合のみ
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_abc123",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

---

### POST /api/auth/login

ログイン

**リクエスト**
```json
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**レスポンス**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user_abc123",
      "email": "user@example.com",
      "role": "user"
    }
  }
}
```

---

## 設定API

### POST /api/settings

ユーザー設定を保存（マージ更新）

**認証**: 必須  
**リクエスト**
```json
{
  "shinagawaSessionId": "ABC123XYZ789...",
  "minatoSessionId": "DEF456UVW012...",
  "shinagawa": {
    "username": "84005349",
    "password": "encrypted_password" // 後方互換性のみ
  },
  "minato": {
    "username": "minato_user",
    "password": "encrypted_password" // 後方互換性のみ
  },
  "reservationLimits": {
    "perWeek": 2,
    "perMonth": 8
  }
}
```

**レスポンス**
```json
{
  "success": true,
  "message": "設定を保存しました"
}
```

**注意事項**:
- セッションID方式を推奨（品川区・港区両方）
- ID/パスワード方式は後方互換性のみ（非推奨）
- 部分更新可能（指定したフィールドのみ更新）

---

### GET /api/settings

ユーザー設定を取得

**認証**: 必須  
**レスポンス**
```json
{
  "success": true,
  "data": {
    "shinagawa": {
      "username": "84005349",
      "sessionId": "ABC123XYZ789...",
      "lastUpdated": 1701234567890,
      "expiresAt": 1701320967890
    },
    "minato": {
      "username": "minato_user",
      "sessionId": "DEF456UVW012...",
      "lastUpdated": 1701234567890,
      "expiresAt": 1701320967890
    },
    "reservationLimits": {
      "perWeek": 2,
      "perMonth": 8
    }
  }
}
```

**注意**: パスワードは返却されません（セキュリティ）

---

## 監視API

### POST /api/monitoring/create

監視ターゲットを作成

**認証**: 必須  
**リクエスト**
```json
{
  "site": "shinagawa",
  "facilityId": "1010101",
  "facilityName": "しながわ中央公園 庭球場A",
  "startDate": "2025-12-01",
  "endDate": "2025-12-31",
  "timeSlots": ["09:00-11:00", "11:00-13:00"],
  "selectedWeekdays": [0, 6], // 日曜日と土曜日
  "priority": 4,
  "autoReserve": true,
  "reservationStrategy": "priority",
  "maxReservationsPerDay": 1
}
```

**フィールド説明**:
| フィールド | 型 | 必須 | 説明 |
|-----------|-----|-----|------|
| site | string | ✅ | "shinagawa" or "minato" |
| facilityId | string | ✅ | 施設ID |
| facilityName | string | ✅ | 施設名 |
| startDate | string | ✅ | 監視開始日（YYYY-MM-DD） |
| endDate | string | ⭕ | 監視終了日（省略時は無期限） |
| date | string | ⭕ | 単一日付モード（後方互換性） |
| timeSlots | string[] | ✅ | 時間帯リスト |
| selectedWeekdays | number[] | ⭕ | 監視する曜日（0=日, 6=土） |
| priority | number | ⭕ | 優先度（1-5、デフォルト3） |
| autoReserve | boolean | ✅ | 自動予約の有効/無効 |
| reservationStrategy | string | ⭕ | "all" or "priority" |
| maxReservationsPerDay | number | ⭕ | 1日の最大予約数 |

**レスポンス**
```json
{
  "success": true,
  "data": {
    "id": "target_xyz789",
    "userId": "user_abc123",
    "site": "shinagawa",
    "facilityId": "1010101",
    "facilityName": "しながわ中央公園 庭球場A",
    "startDate": "2025-12-01",
    "endDate": "2025-12-31",
    "timeSlots": ["09:00-11:00", "11:00-13:00"],
    "priority": 4,
    "autoReserve": true,
    "status": "active",
    "createdAt": 1701234567890
  }
}
```

---

### GET /api/monitoring/list

監視ターゲット一覧を取得

**認証**: 必須  
**レスポンス**
```json
{
  "success": true,
  "data": [
    {
      "id": "target_xyz789",
      "userId": "user_abc123",
      "site": "shinagawa",
      "facilityId": "1010101",
      "facilityName": "しながわ中央公園 庭球場A",
      "startDate": "2025-12-01",
      "endDate": "2025-12-31",
      "timeSlots": ["09:00-11:00"],
      "priority": 4,
      "autoReserve": true,
      "status": "active",
      "lastChecked": 1701234567890,
      "createdAt": 1701234567890
    }
  ]
}
```

---

### DELETE /api/monitoring/:id

監視ターゲットを削除

**認証**: 必須  
**パラメータ**: `id` - ターゲットID

**レスポンス**
```json
{
  "success": true,
  "message": "監視を削除しました"
}
```

---

## 予約履歴API

### GET /api/reservations/history

予約履歴を取得

**認証**: 必須  
**クエリパラメータ**:
- `limit` (optional): 取得件数（デフォルト50）

**レスポンス**
```json
{
  "success": true,
  "data": [
    {
      "id": "reservation_abc123",
      "userId": "user_abc123",
      "targetId": "target_xyz789",
      "site": "shinagawa",
      "facilityId": "1010101",
      "facilityName": "しながわ中央公園 庭球場A",
      "date": "2025-12-15",
      "timeSlot": "09:00-11:00",
      "status": "success",
      "message": "予約に成功しました",
      "createdAt": 1701234567890
    }
  ]
}
```

**status値**:
- `success`: 予約成功
- `failed`: 予約失敗
- `cancelled`: キャンセル

---

## 施設API

### GET /api/facilities/shinagawa

品川区の施設一覧を取得

**認証**: 必須  
**レスポンス**
```json
{
  "success": true,
  "data": [
    {
      "facilityId": "1010101",
      "facilityName": "しながわ中央公園 庭球場A",
      "category": "テニスコート",
      "isTennisCourt": true,
      "buildingId": "1010",
      "buildingName": "しながわ中央公園",
      "areaCode": "1400",
      "areaName": "品川地区"
    }
  ]
}
```

---

### GET /api/facilities/minato

港区の施設一覧を取得

**認証**: 必須  
**レスポンス**
```json
{
  "success": true,
  "data": [
    {
      "facilityId": "202001",
      "facilityName": "麻布運動場 テニスコートA",
      "category": "テニスコート",
      "isTennisCourt": true
    }
  ]
}
```

---

## プッシュ通知API

### POST /api/push/subscribe

プッシュ通知を登録

**認証**: 必須  
**リクエスト**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "BNcRdreALRFXTkOOUHK1EtK2wtaz...",
    "auth": "tBHItJI5svbpez7KI4CCXg=="
  }
}
```

**レスポンス**
```json
{
  "success": true,
  "message": "プッシュ通知を登録しました"
}
```

---

### POST /api/push/unsubscribe

プッシュ通知を解除

**認証**: 必須  
**レスポンス**
```json
{
  "success": true,
  "message": "プッシュ通知を解除しました"
}
```

---

## エラーコード

### HTTP ステータスコード

| コード | 意味 | 説明 |
|-------|------|------|
| 200 | OK | 成功 |
| 201 | Created | リソース作成成功 |
| 400 | Bad Request | リクエストが不正 |
| 401 | Unauthorized | 認証が必要 |
| 403 | Forbidden | 権限がない |
| 404 | Not Found | リソースが見つからない |
| 500 | Internal Server Error | サーバーエラー |

### エラーレスポンス形式

```json
{
  "success": false,
  "error": "エラーメッセージ",
  "code": "ERROR_CODE"
}
```

### エラーコード一覧

| コード | 意味 |
|-------|------|
| INVALID_CREDENTIALS | 認証情報が不正 |
| USER_ALREADY_EXISTS | ユーザーが既に存在 |
| INVALID_TOKEN | トークンが無効 |
| SESSION_EXPIRED | セッションが期限切れ |
| RESERVATION_LIMIT_REACHED | 予約上限に達している |
| FACILITY_NOT_FOUND | 施設が見つからない |
| TARGET_NOT_FOUND | 監視ターゲットが見つからない |

---

## 認証ヘッダー

すべての認証が必要なエンドポイントには、以下のヘッダーが必要です：

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## レート制限

- **無料プラン**: 1,000 requests/日
- **超過時**: 429 Too Many Requests

---

## Webhooks（将来実装予定）

現在は未実装。将来的に以下のイベントをサポート予定：

- `reservation.success`: 予約成功
- `reservation.failed`: 予約失敗
- `availability.changed`: 空き状況変更
- `session.expired`: セッション期限切れ

---

**最終更新**: 2025年11月29日
