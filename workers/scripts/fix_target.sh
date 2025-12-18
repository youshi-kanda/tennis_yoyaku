#!/bin/bash
TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiMDA3ZDllNS0zNTZjLTQ3NDMtYjI3NC05MmRlMzM1MGJiMTUiLCJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIiwicm9sZSI6ImFkbWluIiwiZXhwIjoxNzk3NjI1NDE5fQ.v4XD3UAQapl0jbtij8X9z8VF9PzT3MxLsCEEqCSzFnM"
API_URL="https://tennis-yoyaku-api.kanda02-1203.workers.dev/api/monitoring"

echo "1. Creating new target (2025-12-20)..."
curl -s -X POST "$API_URL/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "site": "shinagawa",
    "facilityId": "10400010",
    "facilityName": "しながわ区民公園",
    "date": "2025-12-20",
    "timeSlot": "19:00-21:00",
    "priority": 3,
    "status": "active",
    "userId": "b007d9e5-356c-4743-b274-92de3350bb15"
  }' | cat

echo -e "\n2. Deleting old target (2025-12-01)..."
# Old ID from previous dump
OLD_ID="25997e4f-3254-46e5-9b64-3a1b3c75e0cd"
curl -s -X DELETE "$API_URL/$OLD_ID" \
  -H "Authorization: Bearer $TOKEN" | cat

echo -e "\nDone."
