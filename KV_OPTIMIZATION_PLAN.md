# KV最適化 - Cronバッチ処理実装計画

## 現状の問題
```typescript
// 問題：各チェックごとにKV.put
for (const target of targets) {
  await checkAndNotify(target, env);  // 内部でKV.put
}
```

## 改善案
```typescript
// 解決策：ユーザー単位でバッチ処理
const userUpdates = new Map<string, UserMonitoringState>();

for (const user of uniqueUsers) {
  const state = await getUserMonitoringState(user.id, env.MONITORING);
  const updates = { targets: state.targets, changed: false };
  
  for (const target of state.targets) {
    // メモリ上でステータス更新
    const result = await checkAvailability(target, env);
    if (result.statusChanged) {
      target.lastStatus = result.newStatus;
      updates.changed = true;
    }
  }
  
  // 変更があったユーザーのみ保存
  if (updates.changed) {
    userUpdates.set(user.id, state);
  }
}

// 最後にまとめて書き込み（最大3回/ユーザー）
for (const [userId, state] of userUpdates) {
  await saveUserMonitoringState(userId, state, env.MONITORING);
}
```

## 効果試算
**現在**:
- 5ユーザー × 1ターゲット × 5分ごと = 60回/時間
- 状態変更時にKV.put → 1,440回/日

**改善後**:
- 5ユーザー × 1回/実行 × 12回/時間 = 60回/時間
- 変更があったユーザーのみ → 最大720回/日（50%削減）

## 実装手順
1. `getAllActiveTargetsByUser()` を追加（ユーザーごとにグループ化）
2. `checkAndNotify()` をメモリ更新のみに変更
3. `scheduled()` でバッチ書き込み実装
4. テスト・デプロイ

## 次回セッション
明日朝9:00（KVリセット後）に実装・テスト
