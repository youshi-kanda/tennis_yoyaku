#!/bin/bash

echo "==================================================="
echo "🔍 集中監視状態チェック"
echo "==================================================="
echo ""

npx wrangler kv:key get "MONITORING:b007d9e5-356c-4743-b274-92de3350bb15" \
  --namespace-id=5a8f67abf49546b58f6113e18a5b2443 2>&1 | \
  python3 -c "
import sys, json, datetime

data = json.load(sys.stdin)
targets = data.get('targets', [])
now = datetime.datetime.now()
jst_now = now + datetime.timedelta(hours=9)

print(f'現在時刻(JST): {jst_now.strftime(\"%Y-%m-%d %H:%M:%S\")}')
print(f'総ターゲット数: {len(targets)}件\n')

# 集中監視中のターゲットを検索
intensive_targets = [t for t in targets if t.get('detectedStatus') == '取']

if len(intensive_targets) == 0:
    print('❌ 現在、集中監視中のターゲットはありません\n')
    print('【集中監視をテストする方法】')
    print('1. PWAで監視設定を追加')
    print('2. 品川区サイトで該当日時を「取」予約')
    print('3. 次のCron実行（1分以内）を待つ')
    print('4. このスクリプトを再実行')
else:
    print(f'🔥 集中監視中のターゲット: {len(intensive_targets)}件\n')
    
    for i, t in enumerate(intensive_targets, 1):
        print(f'[集中監視ターゲット {i}]')
        print(f'  施設: {t.get(\"facilityName\", \"N/A\")}')
        print(f'  対象日付: {t.get(\"intensiveMonitoringDate\", \"N/A\")}')
        print(f'  対象時間: {t.get(\"intensiveMonitoringTimeSlot\", \"N/A\")}')
        
        nextCheck = t.get('nextIntensiveCheckTime')
        if nextCheck:
            jst_next = datetime.datetime.fromtimestamp(nextCheck/1000 + 9*3600)
            diff_seconds = (nextCheck/1000 - now.timestamp())
            diff_minutes = int(diff_seconds / 60)
            
            print(f'  次回監視時刻: {jst_next.strftime(\"%H:%M:%S\")}')
            
            if diff_seconds > 0:
                print(f'  次回監視まで: {diff_minutes}分{int(diff_seconds % 60)}秒')
                
                # 前後15秒以内か判定
                if abs(diff_seconds) <= 15:
                    print(f'  ⚠️  まもなく監視開始！（前後15秒以内）')
            else:
                print(f'  ⚠️  監視時刻を過ぎています（{abs(diff_minutes)}分{int(abs(diff_seconds) % 60)}秒前）')
        
        print()

# 並列処理の確認
print('=' * 50)
print('並列処理の状態確認')
print('=' * 50)

checked_count = 0
recent_check_count = 0

for t in targets:
    lc = t.get('lastCheck')
    if lc:
        checked_count += 1
        diff = (now.timestamp() - lc/1000)
        if diff < 120:  # 2分以内
            recent_check_count += 1

print(f'チェック済みターゲット: {checked_count}/{len(targets)}件')
print(f'直近2分以内のチェック: {recent_check_count}/{len(targets)}件')

if recent_check_count == len(targets):
    print('✅ 全ターゲットが最近チェックされています（並列処理正常）')
elif recent_check_count > 0:
    print('⚠️  一部のターゲットのみ最近チェックされています')
else:
    print('❌ 最近チェックされたターゲットがありません（次のCronを待機中）')
"

echo ""
echo "==================================================="
