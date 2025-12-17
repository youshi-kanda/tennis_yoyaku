#!/bin/bash
# monitoring_loop.sh - Stable log collection with auto-reconnection
# Usage: ./monitoring_loop.sh

cd "$(dirname "$0")"

LOG_FILE="monitoring_combined.log"
echo "=== Starting Wrangler Tail Monitoring ===" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Press Ctrl+C to stop" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

while true; do
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[${timestamp}] Starting wrangler tail..." | tee -a "$LOG_FILE"
  
  # Run wrangler tail and append to log
  wrangler tail --format=json >> "$LOG_FILE" 2>&1
  
  exit_code=$?
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[${timestamp}] Disconnected (exit code: ${exit_code}). Restarting in 3s..." | tee -a "$LOG_FILE"
  
  sleep 3
done
