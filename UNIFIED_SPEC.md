# テニスコート自動予約システム - 統一仕様書

**作成日**: 2025年11月24日  
**バージョン**: 2.0.0  
**ステータス**: ✅ 本番稼働中

---

## 📋 目次

1. [システム概要](#システム概要)
2. [技術スタック](#技術スタック)
3. [アーキテクチャと責務分担](#アーキテクチャと責務分担)
4. [監視戦略（統一版）](#監視戦略統一版)
5. [セッション管理（統一版）](#セッション管理統一版)
6. [データモデル（統一版）](#データモデル統一版)
7. [予約フロー詳細](#予約フロー詳細)
8. [施設ID管理](#施設id管理)
9. [デプロイ情報](#デプロイ情報)

---

## システム概要

### 目的
品川区・港区のテニスコート予約サイトを監視し、キャンセル枠が出た際に自動で予約を行うシステム

### 対象サイト
- **品川区**: https://www.shinagawa-yoyaku.jp/
- **港区**: https://yoyaku.city.minato.tokyo.jp/

### 現在の実装状態
- ✅ PWA実装完了
- ✅ 通常監視（5分間隔）稼働中
- ✅ 自動予約機能実装済み
- ❌ 集中監視（Lambda）未実装

---

## 技術スタック

### フロントエンド (PWA)
| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | 15.1.0 | React フレームワーク |
| React | 19.x | UI ライブラリ |
| TypeScript | 5.x | 型安全性 |
| Tailwind CSS | 3.x | スタイリング |
| Zustand | 最新 | 状態管理 |
| Service Worker | - | オフライン対応・プッシュ通知 |

### バックエンド
| 技術 | 用途 | 実装状態 |
|------|------|---------|
| Cloudflare Workers | API・通常監視 | ✅ 稼働中 |
| Cloudflare KV | データストレージ | ✅ 稼働中 |
| AWS Lambda | 集中監視（予定） | ❌ 未実装 |

### インフラ
| サービス | 用途 | URL |
|---------|------|-----|
| Vercel | PWAホスティング | https://pwa-p8ukvu1np-kys-projects-ed1892e5.vercel.app |
| Cloudflare Workers | APIサーバー | https://tennis-yoyaku-api.kanda02-1203.workers.dev |
| Cloudflare KV | データベース | 4 Namespaces |

---

## アーキテクチャと責務分担

### 層別責務マトリックス

| 層 | 責務 | 実装技術 | 実装状態 |
|----|------|---------|---------|
| **PWA** | 設定UI、通知受信、IndexedDB | Next.js 15 + Service Worker | ✅ 完了 |
| **Workers** | 通常監視、セッション管理、予約API、Push送信 | Cloudflare Workers + KV | ✅ 完了 |
| **Lambda** | 集中監視のみ（10秒間隔） | AWS Lambda (予定) | ❌ 未実装 |

### データフロー
```
┌─────────────────────────────────────────────────────────────┐
│                      User (Browser)                         │
│                   PWA (Next.js 15 App)                      │
│  • 設定UI（3ステップウィザード）                            │
│  • 通知受信（Web Push）                                     │
│  • オフラインキャッシュ（Service Worker + IndexedDB）       │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS REST API
┌─────────────────────▼───────────────────────────────────────┐
│              Cloudflare Workers                             │
│  • JWT認証                                                  │
│  • セッション管理（5:00自動ログイン、24時間維持）          │
│  • 通常監視（5分間隔 Cron）                                │
│  • 予約実行                                                 │
│  • プッシュ通知送信                                         │
│                                                             │
│  KV Namespaces:                                             │
│  • USERS: ユーザー情報・設定                                │
│  • SESSIONS: ログインセッション                             │
│  • MONITORING: 監視ターゲット                               │
│  • RESERVATIONS: 予約履歴                                   │
└─────────────────────┬───────────────────────────────────────┘
                      │ HTTPS (スクレイピング)
┌─────────────────────▼───────────────────────────────────────┐
│              Target Reservation Sites                       │
│  • 品川区: shinagawa-yoyaku.jp                              │
│  • 港区: yoyaku.city.minato.tokyo.jp                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│            AWS Lambda (集中監視 - 未実装)                   │
│  • EventBridge Trigger: 抽選10分前〜結果確定後10分          │
│  • 10秒間隔監視（「取→○」検知）                            │
│  • Workers API経由で予約実行                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 監視戦略（統一版）

### ⚠️ 重要: 監視間隔の定義

複数の仕様書で監視間隔が異なっていましたが、**現在の実装と今後の計画を明確化**します。

| 監視タイプ | 間隔 | 実装場所 | 対象 | 実装状態 |
|-----------|------|---------|------|---------|
| **通常監視** | **5分** | Cloudflare Workers Cron | 全施設（×→○） | ✅ **稼働中** |
| **集中監視** | **10秒** | AWS Lambda (予定) | 品川区「取→○」のみ | ❌ 未実装 |

### 通常監視の詳細

#### 現在の実装（5分間隔）
```toml
# wrangler.toml
[triggers]
crons = ["*/5 * * * *"]
```

**選定理由**:
- Cloudflare Workers の無料枠（100,000リクエスト/日）に収まる
- 5分 = 1日288回 × 監視ターゲット数
- 実用上、キャンセル検知に十分な頻度
- コスト: **完全無料**

**処理フロー**:
```typescript
// 5分ごとに自動実行
async scheduled(event: ScheduledEvent, env: Env) {
  // 1. アクティブな監視ターゲット取得
  const targets = await getAllActiveTargets(env);
  
  // 2. セッションチェック（期限切れなら再ログイン）
  for (const site of ['shinagawa', 'minato']) {
    await ensureValidSession(site, env);
  }
  
  // 3. 各ターゲットの空き状況確認
  for (const target of targets) {
    const status = await checkAvailability(target);
    
    // 4. 「×→○」検知で自動予約
    if (status === '○' && target.lastStatus === '×') {
      await attemptReservation(target, env);
    }
  }
}
```

#### 過去の検討（1分間隔）
- **FINAL_SPEC.md**: 60秒間隔を提案
- **理由**: より高い検知精度
- **却下理由**: 
  - 5分間隔でも実用上問題なし
  - 無料枠を効率的に使用
  - システム負荷を抑制

### 集中監視の詳細（未実装）

#### 目的
品川区の「取」（抽選予約中）→「○」（予約可能）の切り替わりを高精度で捕捉

#### 実装予定（Lambda + EventBridge）
```yaml
# 監視間隔: 10秒
# 実行タイミング: 抽選結果確定の10分刻み前後
# 例: 10:09:50 → 10:10:00 → 10:10:10 → ... → 10:10:30

監視ウィンドウ: 
  - 開始: 抽選10分刻み時刻の10秒前
  - 終了: 抽選10分刻み時刻の30秒後
  - 計4回チェック（10秒×4 = 40秒間）
```

**EventBridge スケジュール例**:
```
# 毎時0分、10分、20分、30分、40分、50分の前後
cron(50 * * * ? *)  # xx:09:50
cron(0 * * * ? *)   # xx:10:00
cron(10 * * * ? *)  # xx:10:10
cron(20 * * * ? *)  # xx:10:20
cron(30 * * * ? *)  # xx:10:30
```

**成功率と費用**:
| 間隔 | 成功率 | 月間実行回数 | AWS費用 |
|------|--------|-------------|---------|
| 1秒 | 90% | ~260,000 | $0.09/月 |
| **10秒** | **85%** | **~26,000** | **$0.01/月** |
| 60秒 | 70% | ~4,300 | $0.50/月 |

**推奨**: 10秒間隔（コストパフォーマンス最高）

---

## セッション管理（統一版）

### ⚠️ 重要: セッション仕様の統一

複数の仕様書でセッション管理が矛盾していましたが、**実装に基づいた正確な仕様**を定義します。

### サイト側のセッション制約

#### ログイン可能時間
```
5:00 - 24:00  : ログイン可能
24:00 - 3:15  : ログイン不可、既存セッション継続可能
3:15          : システムリセット（全セッション強制切断）
3:15 - 5:00   : ログイン不可
```

#### セッションの有効期限
```
実測値: 約30分（推定）
※ サイト側の正確な仕様は非公開
※ Workers側で疑似的に管理
```

### Workers側のセッション管理戦略

#### 1. 基本方針
```typescript
// Workers KV でセッション情報を管理
interface SiteSession {
  jsessionid: string;      // セッションID
  loginTime: number;       // ログイン時刻（timestamp）
  expiresAt: number;       // 期限（loginTime + 30分）
  site: 'shinagawa' | 'minato';
}

// セッション保存
await env.SESSIONS.put(
  `session:${userId}:${site}`, 
  JSON.stringify(session),
  { expirationTtl: 1800 }  // 30分
);
```

#### 2. 時間帯別戦略

##### 通常時間帯（5:00-24:00）
```typescript
async function ensureValidSession(userId: string, site: string, env: Env) {
  const sessionKey = `session:${userId}:${site}`;
  const sessionData = await env.SESSIONS.get(sessionKey);
  
  if (sessionData) {
    const session = JSON.parse(sessionData);
    const now = Date.now();
    
    // セッション有効
    if (now < session.expiresAt) {
      return session.jsessionid;
    }
  }
  
  // セッション期限切れ → 再ログイン
  const newSession = await loginToSite(userId, site, env);
  return newSession.jsessionid;
}
```

##### 深夜時間帯（24:00-3:15）
```typescript
// ログイン不可だが、既存セッションは使用可能
async function nightTimeStrategy(userId: string, site: string, env: Env) {
  const session = await env.SESSIONS.get(`session:${userId}:${site}`);
  
  if (session) {
    // 既存セッションで予約試行
    return JSON.parse(session);
  } else {
    // セッションなし → 5:00まで待機
    await addToPendingQueue(userId, site, env);
    return null;
  }
}
```

##### 早朝時間帯（3:15-5:00）
```typescript
// システムリセット後、ログイン不可
// 監視のみ継続、予約は5:00に実行
async function earlyMorningStrategy() {
  // 空き検知 → KVに保存
  // 5:00のCronで自動実行
}
```

#### 3. 5:00自動ログイン
```typescript
// 5:00:00のCron実行時
async function morningAutoLogin(env: Env) {
  // 全ユーザーの自動ログイン
  const users = await getAllUsers(env);
  
  for (const user of users) {
    if (user.settings.shinagawa.username) {
      await loginToSite(user.id, 'shinagawa', env);
    }
    if (user.settings.minato.username) {
      await loginToSite(user.id, 'minato', env);
    }
  }
  
  // 待機中の予約を実行
  await processPendingReservations(env);
}
```

---

## データモデル（統一版）

### ⚠️ 重要: データモデルの統一

SYSTEM_OVERVIEW.md と FINAL_SPEC.md でデータモデルが異なっていましたが、**現在の実装に基づいた正確なモデル**を定義します。

### User（ユーザー）
```typescript
interface User {
  id: string;                    // ユーザーID (UUID)
  email: string;                 // メールアドレス
  password: string;              // ハッシュ化パスワード（bcrypt）
  role: 'user' | 'admin';        // ロール
  createdAt: number;             // 作成日時（timestamp）
}

// KV格納例
// Key: `user:${email}`
// Value: JSON.stringify(user)
```

### UserSettings（ユーザー設定）
```typescript
interface UserSettings {
  shinagawa: SiteCredentials;    // 品川区ログイン情報
  minato: SiteCredentials;       // 港区ログイン情報
  notifications: NotificationSettings;
  monitoring: MonitoringSettings;
}

interface SiteCredentials {
  username: string;              // 利用者ID（平文）
  password: string;              // パスワード（平文）
  facilities: string[];          // 選択した施設ID
}
// ⚠️ 注意: 現在は平文保存、将来的にAES暗号化を検討

interface NotificationSettings {
  pushEnabled: boolean;          // プッシュ通知有効
  types: NotificationType[];     // 通知タイプ
  pushSubscription?: PushSubscriptionJSON;
}

interface MonitoringSettings {
  enabled: boolean;              // 監視有効
  autoReserve: boolean;          // 自動予約有効
}

// KV格納例
// Key: `settings:${userId}`
// Value: JSON.stringify(settings)
```

### MonitoringTarget（監視ターゲット）
```typescript
interface MonitoringTarget {
  id: string;                    // ターゲットID (UUID)
  userId: string;                // ユーザーID
  site: 'shinagawa' | 'minato';  // サイト
  facilityId: string;            // 施設ID
  facilityName: string;          // 施設名
  
  // 日付設定
  date: string;                  // 日付（後方互換、非推奨）
  startDate?: string;            // 開始日（YYYY-MM-DD）
  endDate?: string;              // 終了日（YYYY-MM-DD）
  dateMode?: 'single' | 'range' | 'continuous';
  
  // 時間帯設定
  timeSlot: string;              // 時間帯（後方互換、非推奨）
  timeSlots?: string[];          // 時間帯リスト（推奨）
  
  // 曜日・祝日設定
  selectedWeekdays?: number[];   // [0,1,2,...] (0=日曜)
  includeHolidays?: boolean | 'only';
  
  // ステータス
  status: 'active' | 'monitoring' | 'detected' | 'reserved' | 'failed';
  autoReserve: boolean;          // 自動予約ON/OFF
  
  // タイムスタンプ
  createdAt: number;
  updatedAt?: number;
  lastCheck?: number;
  lastStatus?: string;           // '×' or '○' or '取'
}

// KV格納例
// Key: `monitoring:all_targets`
// Value: JSON.stringify(targets[])  // 配列で一括管理
```

### ReservationHistory（予約履歴）
```typescript
interface ReservationHistory {
  id: string;
  userId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;                  // YYYY-MM-DD
  timeSlot: string;              // '09:00-11:00'
  status: 'success' | 'failed';
  message: string;               // 結果メッセージ
  createdAt: number;
}

// KV格納例
// Key: `history:${userId}`
// Value: JSON.stringify(histories[])  // ユーザーごとの配列
```

### Session（セッション）
```typescript
interface SiteSession {
  jsessionid: string;            // セッションID
  loginTime: number;             // ログイン時刻
  expiresAt: number;             // 期限（loginTime + 30分）
  site: 'shinagawa' | 'minato';
}

// KV格納例
// Key: `session:${userId}:${site}`
// Value: JSON.stringify(session)
// TTL: 1800秒（30分）
```

---

## 予約フロー詳細

### ⚠️ 重要: 予約フロー仕様の統一

予約フローの詳細は各仕様書で記載レベルが異なっていましたが、**実装に必要な正確な情報**をまとめます。

### 品川区の予約フロー

#### 1. ログイン
```http
POST /shinagawa/web/rsvWUserAttestationLoginAction.do
Content-Type: application/x-www-form-urlencoded

riyosyaCd=${username}&password=${password}
```

**レスポンス**: Set-Cookie: JSESSIONID=...

#### 2. 空き検索
```http
POST /shinagawa/web/rsvWOpeInstSrchVacantAction.do
Cookie: JSESSIONID=${sessionId}
Content-Type: application/x-www-form-urlencoded

selectDate=${date}&selectAreaBcd=${facilityId}&selectInstBcd=&...
```

**レスポンス**: HTML（空き状況テーブル）

#### 3. 予約申込
```http
POST /shinagawa/web/rsvWOpeReservedApplyAction.do
Cookie: JSESSIONID=${sessionId}
Content-Type: application/x-www-form-urlencoded

selectDate=${date}&selectInstBcd=${facilityId}&selectTimeKbn=${timeSlot}&...
```

**レスポンス**: 予約完了画面 or エラー

### 港区の予約フロー

#### 1. ログイン
```http
POST /web/rsvWUserAttestationLoginAction.do
Content-Type: application/x-www-form-urlencoded

riyosyaCd=${username}&password=${password}
```

#### 2. 空き検索
```http
POST /web/rsvWOpeInstSrchVacantAction.do
Cookie: JSESSIONID=${sessionId}
Content-Type: application/x-www-form-urlencoded

selectDate=${date}&selectAreaBcd=${facilityId}&...
```

#### 3. 予約申込
```http
POST /web/rsvWOpeReservedApplyAction.do
Cookie: JSESSIONID=${sessionId}
Content-Type: application/x-www-form-urlencoded

selectDate=${date}&selectInstBcd=${facilityId}&selectTimeKbn=${timeSlot}&...
```

### 共通の注意事項

#### 文字コード
- **エンコーディング**: Shift_JIS
- **Content-Type**: `application/x-www-form-urlencoded`
- **実装**: `iconv-lite` で変換

```typescript
import iconv from 'iconv-lite';

const bodyString = new URLSearchParams(params).toString();
const bodyShiftJIS = iconv.encode(bodyString, 'shift_jis');
```

#### ステータス判定
```typescript
// HTML解析でステータスを判定
const statusMap = {
  '×': '予約不可',
  '○': '予約可能',
  '取': '抽選予約中（品川区のみ）',
  '△': '残りわずか',
  '-': '休館日'
};
```

---

## 施設ID管理

### ⚠️ 重要: 施設IDの統一

SYSTEM_OVERVIEW.md では `facilityId` として管理していますが、実際のHTMLでは `selectAreaBcd` として送信されます。

### 施設IDの決定方法

#### 1. HTML構造から抽出
```html
<!-- 品川区の例 -->
<select name="selectAreaBcd">
  <option value="10001">しながわ中央公園</option>
  <option value="10002">東品川公園</option>
  ...
</select>
```

#### 2. Workers側での管理
```typescript
// 施設マスタをハードコード or API取得
const FACILITIES = {
  shinagawa: [
    { id: '10001', name: 'しながわ中央公園', courts: 'A〜E（5コート）' },
    { id: '10002', name: '東品川公園', courts: 'A（1コート）' },
    ...
  ],
  minato: [
    { id: '20001', name: '麻布運動公園', courts: 'A〜D（4コート）' },
    { id: '20002', name: '青山運動場', courts: 'A〜D（4コート）' },
    ...
  ]
};
```

#### 3. API経由で取得
```typescript
// GET /api/facilities/shinagawa
// GET /api/facilities/minato

export async function getShinagawaFacilities() {
  const html = await fetch('https://www.shinagawa-yoyaku.jp/...');
  const $ = cheerio.load(html);
  
  const facilities = [];
  $('select[name="selectAreaBcd"] option').each((i, el) => {
    const id = $(el).attr('value');
    const name = $(el).text();
    if (id && name) {
      facilities.push({ id, name });
    }
  });
  
  return facilities;
}
```

---

## デプロイ情報

### 現在のバージョン

#### PWA (Frontend)
- **URL**: https://pwa-p8ukvu1np-kys-projects-ed1892e5.vercel.app
- **Platform**: Vercel
- **Framework**: Next.js 15
- **Last Deploy**: 2025年11月24日

#### Workers (Backend)
- **URL**: https://tennis-yoyaku-api.kanda02-1203.workers.dev
- **Platform**: Cloudflare Workers
- **Version ID**: `44736dc4-8c3b-48ac-8815-a5946e092ee0`
- **Compatibility Date**: 2024-01-01
- **Cron**: `*/5 * * * *` (5分間隔)
- **Last Deploy**: 2025年11月24日

#### KV Namespaces
| Namespace | ID | 用途 |
|-----------|----|----|
| USERS | `2bb51589e95d448abc4f6821a5898865` | ユーザー情報 |
| SESSIONS | `2111997ed58e4f5080074fc0a95cacf0` | ログインセッション |
| MONITORING | `5a8f67abf49546b58f6113e18a5b2443` | 監視ターゲット |
| RESERVATIONS | `6e26433ee30b4ad0bc0a8749a67038be` | 予約履歴 |

---

## 今後の実装予定

### Phase 1: 集中監視（Lambda）
- [ ] AWS Lambda関数作成
- [ ] EventBridge スケジュール設定
- [ ] 10秒間隔監視実装
- [ ] Workers API連携

### Phase 2: パスワード暗号化
- [ ] AES暗号化実装
- [ ] マイグレーションスクリプト作成

### Phase 3: エラーハンドリング強化
- [ ] リトライロジック実装
- [ ] エラー通知改善

---

## 参照ドキュメント

### 有効なドキュメント
- ✅ **UNIFIED_SPEC.md** (このファイル) - 統一仕様書
- ✅ **SYSTEM_OVERVIEW.md** - システム概要（補足資料）
- ✅ **README.md** - プロジェクト概要

### 参考ドキュメント（部分的に古い情報を含む）
- ⚠️ **FINAL_SPEC.md** - 1分監視の提案（現在は5分）
- ⚠️ **INTENSIVE_MONITORING.md** - Lambda実装（未実装）
- ⚠️ **SPECIFICATION.md** - 初期技術調査（一部更新必要）
- ⚠️ **SESSION_STRATEGY.md** - セッション管理（基本方針のみ参照）

### 矛盾の解決方針
各仕様書に矛盾がある場合は、**このUNIFIED_SPEC.mdを正とする**。

---

**最終更新**: 2025年11月24日  
**バージョン**: 2.0.0  
**Workers Version**: `44736dc4-8c3b-48ac-8815-a5946e092ee0`  
**PWA Version**: Latest on Vercel
