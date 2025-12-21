# KV最適化 - Cronバッチ処理実装計画

**⚠️ 注意**: このドキュメントは無料プラン時代の最適化計画です。

## ✅ 現在の状況（2025年11月29日更新）

**Cloudflare Workers 有料プラン契約済み** ($5/月)
- KV書き込み: **実質無制限**
- サブリクエスト: **1,000回/実行**（無料プランの20倍）
- CPU時間: **30秒/実行**（無料プランの3,000倍）

以下の最適化計画は参考情報として残していますが、現在は制限を気にせず実装可能です。

---

## 旧）現状の問題（無料プラン時代）
```typescript
// 問題：各チェックごとにKV.put
for (const target of targets) {
  await checkAndNotify(target, env);  // 内部でKV.put
}
```

## 旧）改善案
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

## 旧）効果試算（無料プラン時代）
**現在**:
- 5ユーザー × 1ターゲット × 5分ごと = 60回/時間
- 状態変更時にKV.put → 1,440回/日（無料プランの上限）

**改善後**:
- 5ユーザー × 1回/実行 × 12回/時間 = 60回/時間
- 変更があったユーザーのみ → 最大720回/日（50%削減）

---

## ✅ 有料プラン移行後の実装状況

### 実装済みの最適化
1. ✅ ユーザー単位でのKV保存（`MONITORING:{userId}`）
2. ✅ メモリキャッシュの活用（セッション、監視リスト）
3. ✅ バッチ書き込み処理

### 現在の運用状況
- KV書き込み制限: **実質的に気にする必要なし**
- 実装の柔軟性: **制限を意識せず機能追加可能**
- パフォーマンス: **良好**

---

## 参考）旧実装手順（無料プラン時代）
1. `getAllActiveTargetsByUser()` を追加（ユーザーごとにグループ化）
2. `checkAndNotify()` をメモリ更新のみに変更
3. `scheduled()` でバッチ書き込み実装
4. テスト・デプロイ

**最終更新**: 2025年11月29日（有料プラン移行済み）
