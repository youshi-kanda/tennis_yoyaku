#!/bin/bash

# 予約実行時のデバッグログを監視するスクリプト

echo "========================================"
echo "🔍 予約実行デバッグログ監視"
echo "========================================"
echo ""
echo "このスクリプトは予約実行時のレスポンスHTMLを監視します"
echo "空き枠が検知されて予約が実行されると、詳細なログが表示されます"
echo ""
echo "監視中... (Ctrl+C で終了)"
echo "========================================"
echo ""

cd "$(dirname "$0")"

# ログをリアルタイムで監視
npx wrangler tail --format pretty 2>&1 | while read line; do
  # 予約関連のログのみ表示
  if echo "$line" | grep -qE "(Reserve|Reservation|DEBUG|Shinagawa|Minato|予約)"; then
    # タイムスタンプ付きで表示
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $line"
    
    # 重要なログをハイライト
    if echo "$line" | grep -q "DEBUG: Response HTML"; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "🔥 レスポンスHTMLを検出！上記のログを確認してください"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    
    if echo "$line" | grep -q "Keyword search results"; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "🔍 キーワード検索結果を確認中..."
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
    
    if echo "$line" | grep -q "HINT:"; then
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
      echo "💡 ヒント: 上記のDEBUGログから実際の成功メッセージを特定してください"
      echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    fi
  fi
done
