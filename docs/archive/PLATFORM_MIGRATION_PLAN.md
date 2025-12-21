# プラットフォーム移行計画

## ✅ 結論: Cloudflare Workers 継続可能（2024年12月 最適化実施済み）

### 🎉 週単位バルク取得最適化により、Cloudflare Workers で十分スケール可能

#### 最適化前の問題
```
❌ 旧仮定: 1ターゲット × 30日 × 3時間帯 = 90リクエスト/ターゲット
❌ 100ターゲット × 90 = 9,000リクエスト >> 1,000 制限 ❌
```

#### 最適化後の現実
```
✅ 実態: 1リクエストで1週間（7日）× 全時間帯（6-7枠）を一括取得
✅ 60日分 ÷ 7日 = 9リクエスト/ターゲット
✅ 100ターゲット × 9 = 900リクエスト < 1,000 制限 ✅
```

#### 最適化の根拠（実サイト検証済み）

品川区・港区の予約システム(EPRS)はカレンダーUI:
- **1リクエスト = 7日 × 全時間帯**のHTML返却
- セルID形式: `id="YYYYMMDD_TimeCode"` (例: `id="20260114_10"`)
- ステータス: `<img alt="空き">`, `<img alt="予約あり">`, `<img alt="取消処理中">`

**品川区**: 6時間帯（09:00, 11:00, 13:00, 15:00, 17:00, 19:00）→ TimeCode 10-60  
**港区**: 7時間帯（08:00, 10:00, 12:00, 13:00, 15:00, 17:00, 19:00）→ TimeCode 10-70

#### 施設数上限計算
```
1,000 subrequests - 20 (ログイン等オーバーヘッド) = 980
980 ÷ 9 (週リクエスト/ターゲット) ≈ 108 ターゲット監視可能
```

---

## 📊 現状の構成（最適化済み）

### Cloudflare Workers (有料プラン $5/月) ✅ 採用継続
- ✅ KV統合、Edge配信、低レイテンシ
- ✅ 1,000 subrequest/実行 → **週単位取得で97%削減**
- ✅ 約100ターゲット監視可能（十分なキャパシティ）
- ✅ コスト: **$5/月固定**

### 最適化実装 (scraper.ts)
```typescript
// 週単位で7日×全時間帯を一括取得
checkShinagawaWeeklyAvailability(facilityId, weekStartDate, sessionId)
checkMinatoWeeklyAvailability(facilityId, weekStartDate, sessionId)

// 時間帯マッピング
SHINAGAWA_TIMESLOT_MAP = { 10: '09:00', 20: '11:00', ... }
MINATO_TIMESLOT_MAP = { 10: '08:00', 20: '10:00', ... }
```

---

## 📋 以下は参考情報（移行が必要になった場合）

## 🎯 移行先候補の比較

### Option 1: AWS Lambda + DynamoDB ⭐️⭐️⭐️⭐️⭐️ (最推奨)

#### メリット
- ✅ **無制限の外部リクエスト** (HTTPリクエスト制限なし)
- ✅ スケーラビリティ: 1000ターゲット以上でも対応可能
- ✅ 安定性: AWS東京リージョン、99.95% SLA
- ✅ コスト: 無料枠 100万リクエスト/月 (実質$0)
- ✅ Cron: EventBridge で完全互換 (1分間隔可能)
- ✅ データベース: DynamoDB (KVと類似、高速)
- ✅ Push通知: SNS/SESで実装可能
- ✅ 既存コードの移植性: 高い (Node.js/TypeScript)

#### 構成
```
EventBridge (Cron) → Lambda → DynamoDB
                    ↓
              外部サイト (品川区/港区)
                    ↓
              SNS → プッシュ通知
```

#### ⚠️ コスト試算 (詳細版)

**AWS Lambda 無料枠:**
- 実行回数: 100万回/月
- コンピューティング時間: 40万GB秒/月 (メモリ1GBで40万秒 = 111時間)

**実際の使用量計算:**

##### シナリオA: 小規模 (50ユーザー、150ターゲット)
```
Cron実行: 1,440回/日 × 30日 = 43,200回/月
外部リクエスト: 150ターゲット × 30日 × 3時間帯 × 1,440回 = 19,440,000リクエスト/月
実行時間: 30秒/回 × 43,200回 = 36時間/月 (メモリ1GB想定 = 36,000 GB秒)

- Lambda実行回数: 43,200回/月 → 無料枠内 ✅
- Lambda実行時間: 36,000 GB秒 → 無料枠内 ✅
- DynamoDB読取: 648,000回/月 → 約$13/月 ❌
- DynamoDB書込: 20,000回/月 → 約$2.5/月

合計: 約$15-20/月
```

##### シナリオB: 中規模 (100ユーザー、300ターゲット)
```
Cron実行: 43,200回/月
外部リクエスト: 300ターゲット × 30日 × 3時間帯 × 1,440回 = 38,880,000リクエスト/月
実行時間: 60秒/回 × 43,200回 = 72時間/月 (メモリ1GB = 72,000 GB秒)

- Lambda実行回数: 43,200回/月 → 無料枠内 ✅
- Lambda実行時間: 72,000 GB秒 → 超過32,000 GB秒 → 約$0.64/月
- DynamoDB読取: 1,296,000回/月 → 約$26/月 ❌
- DynamoDB書込: 40,000回/月 → 約$5/月

合計: 約$30-35/月
```

##### シナリオC: 大規模 (300ユーザー、900ターゲット)
```
Cron実行: 43,200回/月
外部リクエスト: 900ターゲット × 30日 × 3時間帯 × 1,440回 = 116,640,000リクエスト/月
実行時間: 120秒/回 × 43,200回 = 144時間/月 (144,000 GB秒)

- Lambda実行回数: 43,200回/月 → 無料枠内 ✅
- Lambda実行時間: 144,000 GB秒 → 超過104,000 GB秒 → 約$2.08/月
- DynamoDB読取: 3,888,000回/月 → 約$78/月 ❌❌
- DynamoDB書込: 120,000回/月 → 約$15/月

合計: 約$95-100/月 ❌❌
```

**⚠️ 結論: AWS Lambdaも大規模運用ではコスト高**
- Lambda自体は無料枠で収まる
- **DynamoDBの読み取り課金が致命的** (300ターゲットで$26/月、900で$78/月)

#### 移行工数
- データ移行: DynamoDB設計 + KV → DynamoDB 移行スクリプト (8時間)
- Lambda実装: 既存コードをLambda用に調整 (16時間)
- EventBridge設定: Cron設定 (2時間)
- プッシュ通知: SNS統合 (4時間)
- テスト・デプロイ: 動作確認、本番移行 (8時間)
- **合計: 約38時間 (5営業日)**

---

### Option 2: Google Cloud Run + Firestore ⭐️⭐️⭐️⭐️

#### メリット
- ✅ **無制限の外部リクエスト**
- ✅ コンテナベース: Dockerで柔軟な環境構築
- ✅ 自動スケール: 0→Nインスタンス
- ✅ Cron: Cloud Scheduler (1分間隔可能)
- ✅ データベース: Firestore (NoSQL、リアルタイム)
- ✅ 無料枠: 200万リクエスト/月

#### 構成
```
Cloud Scheduler → Cloud Run → Firestore
                    ↓
              外部サイト (品川区/港区)
                    ↓
              Firebase Cloud Messaging
```

#### コスト試算
- Cloud Run: 無料枠内 (200万リクエスト/月)
- Firestore: 約$5-10/月
- **合計: 約$5-10/月**

#### 移行工数
- Docker化: Dockerfile作成 (4時間)
- Firestore移行: スキーマ設計 + データ移行 (8時間)
- Cloud Run設定: デプロイ設定 (4時間)
- FCM統合: プッシュ通知実装 (4時間)
- **合計: 約20時間 (3営業日)**

---

### Option 3: Vercel Cron + Vercel KV ⭐️⭐️⭐️

#### メリット
- ✅ 外部リクエスト制限なし (Edge Functions)
- ✅ Vercel KV: Cloudflare KVと互換性高い
- ✅ Next.js統合: PWAと同一プラットフォーム
- ✅ 既存のVercelアカウント活用

#### デメリット
- ⚠️ Cron頻度制限: Pro以上で1分間隔可能 ($20/月)
- ⚠️ Vercel KV: 有料プラン必須 ($20/月)
- ⚠️ コスト高: 合計$40/月

#### 移行工数
- KV移行: Cloudflare → Vercel KV (4時間)
- API Routes実装: /api/cron エンドポイント (8時間)
- **合計: 約12時間 (2営業日)**

---

### Option 4: Railway + PostgreSQL ⭐️⭐️⭐️

#### メリット
- ✅ 無制限の外部リクエスト
- ✅ PostgreSQL: リレーショナルDB (高度なクエリ可能)
- ✅ Cron: 組み込みCron機能あり
- ✅ シンプルなデプロイ

#### デメリット
- ⚠️ 無料枠終了 (2024年8月以降)
- ⚠️ コスト: 約$20/月 (Hobby Plan)
- ⚠️ PostgreSQL学習コスト

#### 移行工数
- PostgreSQL設計: テーブル設計 (8時間)
- ORM導入: Prisma導入 (4時間)
- Railway設定: デプロイ (4時間)
- **合計: 約16時間 (2営業日)**

---

### Option 5: 自前VPS (ConoHa/さくらVPS) ⭐️⭐️⭐️⭐️⭐️ (コスト面で最推奨)

#### メリット
- ✅ **固定コスト**: 月$10-15で無制限 (1000ターゲットでも同額)
- ✅ **コスト予測可能**: 従量課金なし
- ✅ 完全な制御: PostgreSQL/Redis/Node.js自由に構成
- ✅ 高性能: 2vCPU/4GB RAM でも$15/月程度
- ✅ スケーリング余地: メモリ8GBまで簡単アップグレード

#### デメリット
- ⚠️ インフラ管理: OS更新、セキュリティ対応（月1時間程度）
- ⚠️ 冗長化なし: SPOF (単一障害点) ※ただしテニス予約は許容範囲
- ⚠️ 初期設定: Docker Compose環境構築

#### 推奨構成: ConoHa VPS
```
プラン: 2GB (2vCPU, 2GB RAM, 100GB SSD)
月額: ¥1,848 (約$12/月)
OS: Ubuntu 22.04 LTS
構成: Docker Compose (Node.js + PostgreSQL + Redis)
```

#### コスト比較 (300ターゲット想定)
```
VPS: $12/月 (固定)
AWS Lambda: $30-35/月 (従量)
Google Cloud Run: $15-20/月 (従量)
Vercel: $40/月 (固定)

→ VPS が最安で固定コスト
```

#### 移行工数
- サーバー構築: ConoHa申込 + Ubuntu初期設定 (2時間)
- Docker Compose: docker-compose.yml作成 (4時間)
- データ移行: PostgreSQL + データ移行スクリプト (8時間)
- Nginx + SSL: Let's Encrypt設定 (2時間)
- テスト・デプロイ: 動作確認、本番切替 (4時間)
- **合計: 約20時間 (3営業日)**

---

## 🏆 推奨プラン: 自前VPS (ConoHa/さくらVPS) ⭐️⭐️⭐️⭐️⭐️

### 理由（コスト再計算後）
1. **固定コスト**: 月$10-15で無制限
2. **スケーラビリティ**: 1000ターゲットでも追加コスト$0
3. **制御**: PostgreSQL、Redis、Node.jsを自由に構成
4. **コスト予測可能**: 従量課金なし
5. **長期的に最安**: 100ユーザー以上なら圧倒的に安い

### AWS Lambdaの問題点（再評価）
- ❌ **DynamoDBの読み取り課金が高額** (300ターゲットで$26/月)
- ❌ スケールするほどコスト増加 (900ターゲットで$100/月)
- ❌ コスト予測困難（従量課金）

### 移行スケジュール (5営業日)

#### Day 1: 設計・準備 (8時間)
- DynamoDBテーブル設計
  - Users: userId (PK)
  - Monitoring: targetId (PK), userId (GSI)
  - Sessions: sessionKey (PK)
  - Reservations: reservationId (PK)
- Lambda関数設計
  - `cronHandler`: EventBridgeトリガー
  - `apiHandler`: API Gateway REST API
- 環境構築: AWS CLI、SAM CLI

#### Day 2-3: 実装 (16時間)
- DynamoDB CRUD操作実装
- Lambda関数実装
  - Cron監視ロジック移植
  - セッション管理移植
  - スクレイピングロジック移植
- API Gateway設定

#### Day 4: プッシュ通知・テスト (8時間)
- SNS統合 (プッシュ通知)
- 単体テスト
- 統合テスト (Staging環境)

#### Day 5: データ移行・本番切替 (6時間)
- Cloudflare KV → DynamoDB データ移行
- DNS切り替え (API endpoint)
- 本番監視
- Cloudflare Workers停止

---

## 🔧 AWS Lambda 実装例

### DynamoDB テーブル設計

```typescript
// Users Table
{
  PK: "USER#${userId}",
  SK: "PROFILE",
  email: string,
  shinagawa: { username, password },
  minato: { username, password },
  createdAt: number
}

// Monitoring Table
{
  PK: "TARGET#${targetId}",
  SK: "CONFIG",
  GSI1PK: "USER#${userId}",  // UserごとのTarget検索用
  GSI1SK: "TARGET#${targetId}",
  site: "shinagawa" | "minato",
  facilityId: string,
  facilityName: string,
  status: "active" | "paused",
  dateMode: "single" | "range" | "continuous",
  // ... その他の設定
}

// Sessions Table
{
  PK: "SESSION#${userId}#${site}",
  SK: "CURRENT",
  sessionId: string,
  cookies: object,
  expiresAt: number,
  TTL: number  // DynamoDB TTL機能
}
```

### Lambda Handler 例

```typescript
// lambda/cron-handler.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const dynamodb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event: any) => {
  console.log('[Cron] Started');
  
  // 1. アクティブな監視ターゲット取得
  const targets = await dynamodb.send(new ScanCommand({
    TableName: 'Monitoring',
    FilterExpression: '#status = :active',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: { ':active': 'active' }
  }));
  
  // 2. 並列処理で監視実行
  await Promise.all(
    targets.Items?.map(target => checkAndNotify(target)) || []
  );
  
  console.log('[Cron] Completed');
};

async function checkAndNotify(target: any) {
  // 既存のcheckAndNotify()ロジックをそのまま移植
  // ...
}
```

### EventBridge Cron 設定

```yaml
# template.yaml (AWS SAM)
Resources:
  CronRule:
    Type: AWS::Events::Rule
    Properties:
      ScheduleExpression: "cron(* * * * ? *)"  # 毎分実行
      Targets:
        - Arn: !GetAtt CronHandlerFunction.Arn
          Id: "CronHandler"
  
  CronHandlerFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: cron-handler.handler
      Runtime: nodejs20.x
      Timeout: 300  # 5分タイムアウト
      MemorySize: 1024
      Environment:
        Variables:
          DYNAMODB_TABLE: !Ref MonitoringTable
```

---

## 📋 移行チェックリスト

### 準備
- [ ] AWSアカウント作成
- [ ] IAMユーザー作成 (管理者権限)
- [ ] AWS CLI設定
- [ ] SAM CLI インストール

### 実装
- [ ] DynamoDBテーブル作成
- [ ] Lambda関数実装
- [ ] API Gateway設定
- [ ] EventBridge Cron設定
- [ ] SNS統合 (プッシュ通知)

### テスト
- [ ] ローカルテスト (SAM local)
- [ ] Staging環境デプロイ
- [ ] 統合テスト
- [ ] 負荷テスト (100ターゲット同時実行)

### 本番移行
- [ ] データ移行スクリプト実行
- [ ] DNS切り替え (API endpoint)
- [ ] PWA環境変数更新 (API_BASE_URL)
- [ ] 監視開始
- [ ] Cloudflare Workers停止
- [ ] 1週間監視

---

## 💰 コスト比較 (正確版)

### 小規模 (50ユーザー、150ターゲット)
| プラットフォーム | 月額コスト | 初期工数 | スケーラビリティ |
|---|---|---|---|
| **自前VPS** | **$12 (固定)** ⭐️ | 20時間 | 1000ターゲットまで対応 |
| Cloudflare Workers | $5 | 0時間 | ❌ **制限あり** (1,000 req) |
| AWS Lambda | $15-20 | 38時間 | ✅ 無制限だがコスト増 |
| Google Cloud Run | $10-15 | 20時間 | ✅ 無制限だがコスト増 |
| Vercel Cron | $40 | 12時間 | ✅ 無制限 |

### 中規模 (100ユーザー、300ターゲット)
| プラットフォーム | 月額コスト | 1ターゲットあたり | コスト効率 |
|---|---|---|---|
| **自前VPS** | **$12 (固定)** ⭐️⭐️⭐️ | $0.04 | 最安 |
| Cloudflare Workers | 不可能 | - | ❌ 制限超過 |
| AWS Lambda | $30-35 | $0.10 | 中 |
| Google Cloud Run | $15-20 | $0.05-0.07 | 良 |
| Vercel Cron | $40 | $0.13 | 高 |

### 大規模 (300ユーザー、900ターゲット)
| プラットフォーム | 月額コスト | 1ターゲットあたり | コスト効率 |
|---|---|---|---|
| **自前VPS** | **$15-20 (固定)** ⭐️⭐️⭐️⭐️⭐️ | $0.017-0.022 | 圧倒的最安 |
| Cloudflare Workers | 不可能 | - | ❌ 制限超過 |
| AWS Lambda | $95-100 | $0.11 | ❌ 高コスト |
| Google Cloud Run | $40-50 | $0.04-0.06 | 中 |
| Vercel Cron | $40 | $0.04 | 良 |

**結論: 100ターゲット以上なら自前VPSが圧倒的に安い**

---

## 🚀 次のアクション

### 即座の対応
1. **メンテナンスモード有効化** (現在のシステム停止)
   ```bash
   cd workers
   npx wrangler kv:key put "SYSTEM:MAINTENANCE" '{"enabled":true,"message":"システム移行作業中"}' --namespace-id=5a8f67abf49546b58f6113e18a5b2443
   ```

2. **ユーザー通知** (PWAダッシュボードに表示)
   - "現在システム移行作業中です。12/7頃に再開予定"

### 移行作業
3. **AWS Lambda移行開始** (推奨5日間プラン)
   - Day 1: 設計
   - Day 2-3: 実装
   - Day 4: テスト
   - Day 5: 本番切替

---

**結論**: AWS Lambdaへの移行を強く推奨します。コスト・スケーラビリティ・安定性のバランスが最も優れています。
