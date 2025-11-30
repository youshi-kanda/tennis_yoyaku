#!/bin/bash

echo "==================================================="
echo "🔍 集中監視・並列処理の動作確認スクリプト"
echo "==================================================="
echo ""

# 監視対象の確認
echo "📊 Step 1: 現在の監視ターゲット確認"
echo "---------------------------------------------------"
npx wrangler kv:key get "MONITORING:b007d9e5-356c-4743-b274-92de3350bb15" \
  --namespace-id=5a8f67abf49546b58f6113e18a5b2443 2>&1 | \
  python3 -c "
import sys, json, datetime
data = json.load(sys.stdin)
targets = data.get('targets', [])
print(f'総ターゲット数: {len(targets)}件')
active = len([t for t in targets if t.get('status') == 'active'])
intensive = len([t for t in targets if t.get('detectedStatus') == '取'])
print(f'  アクティブ: {active}件')
print(f'  集中監視中: {intensive}件')
"
echo ""

# 次のCron実行を待機
echo "⏳ Step 2: 次のCron実行を待機中..."
echo "---------------------------------------------------"
current_second=$(date +%S)
wait_seconds=$((60 - current_second + 5))
echo "次のCron実行まで約${wait_seconds}秒待機します..."
sleep $wait_seconds
echo ""

# 実行後の状態確認
echo "✅ Step 3: Cron実行後の状態確認"
echo "---------------------------------------------------"
npx wrangler kv:key get "MONITORING:b007d9e5-356c-4743-b274-92de3350bb15" \
  --namespace-id=5a8f67abf49546b58f6113e18a5b2443 2>&1 | \
  python3 -c "
import sys, json, datetime
data = json.load(sys.stdin)
targets = data.get('targets', [])
print(f'総ターゲット数: {len(targets)}件\n')

now = datetime.datetime.now()
for i, t in enumerate(targets, 1):
    lc = t.get('lastCheck')
    if lc:
        jst_lc = datetime.datetime.fromtimestamp(lc/1000 + 9*3600)
        diff = (now.timestamp() - lc/1000)
        print(f'[ターゲット {i}] {t.get(\"facilityName\", \"N/A\")}')
        print(f'  最終チェック: {jst_lc.strftime(\"%H:%M:%S\")} ({diff:.0f}秒前)')
        print(f'  ステータス: {t.get(\"lastStatus\", \"N/A\")}')
        
        if t.get('detectedStatus') == '取':
            print(f'  🔥 集中監視中')
            nextCheck = t.get('nextIntensiveCheckTime')
            if nextCheck:
                jst = datetime.datetime.fromtimestamp(nextCheck/1000 + 9*3600)
                print(f'  次回監視: {jst.strftime(\"%H:%M:%S\")}')
        print()
"
echo ""

# 並列処理の確認
echo "🚀 Step 4: 並列処理の確認（全ターゲットがチェックされているか）"
echo "---------------------------------------------------"
npx wrangler kv:key get "MONITORING:b007d9e5-356c-4743-b274-92de3350bb15" \
  --namespace-id=5a8f67abf49546b58f6113e18a5b2443 2>&1 | \
  python3 -c "
import sys, json, datetime
data = json.load(sys.stdin)
targets = data.get('targets', [])

checked_count = 0
not_checked_count = 0
intensive_count = 0

for t in targets:
    if t.get('lastCheck'):
        checked_count += 1
    else:
        not_checked_count += 1
    
    if t.get('detectedStatus') == '取':
        intensive_count += 1

print(f'チェック済み: {checked_count}件')
print(f'未チェック: {not_checked_count}件')
print(f'集中監視中: {intensive_count}件')
print()

if checked_count == len(targets):
    print('✅ 全ターゲットがチェックされています（並列処理正常）')
elif checked_count > 0:
    print('⚠️  一部のターゲットのみチェックされています')
else:
    print('❌ どのターゲットもチェックされていません')
"
echo ""

echo "==================================================="
echo "✅ 確認完了"
echo "==================================================="
