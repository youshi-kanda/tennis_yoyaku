'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { usePushNotification } from '@/lib/hooks/usePushNotification';

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'warning' | 'error';
  message: string;
  details?: any;
}

interface MaintenanceStatus {
  maintenanceMode: {
    enabled: boolean;
    message: string;
  };
  monitoring: {
    total: number;
    active: number;
    paused: number;
  };
}

export default function AdminMaintenancePage() {
  const { isAdmin } = useAuthStore();
  const router = useRouter();
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [monitoringStats, setMonitoringStats] = useState<any>(null);
  const [allTargets, setAllTargets] = useState<any[]>([]);
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);
  const [customMessage, setCustomMessage] = useState('システムメンテナンス中です。しばらくお待ちください。');
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkingTargetId, setCheckingTargetId] = useState<string | null>(null);
  const { subscribe, isSupported } = usePushNotification();

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadMaintenanceStatus();
      loadSystemHealth();
    }
  }, [isAdmin]);

  const loadMaintenanceStatus = async () => {
    try {
      const response = await apiClient.getMaintenanceStatus();
      setMaintenanceStatus(response);
    } catch (error) {
      console.error('Failed to load maintenance status:', error);
    }
  };

  const loadSystemHealth = async () => {
    try {
      setLoading(true);
      const checks: HealthCheckResult[] = [];

      // メンテナンス状態を取得
      await loadMaintenanceStatus();

      // KVメトリクスチェック
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'}/api/metrics/kv`);
        const kvData = await response.json();
        checks.push({
          service: 'KV Namespace',
          status: kvData.cacheHitRate > 0.5 ? 'healthy' : 'warning',
          message: `キャッシュヒット率: ${(kvData.cacheHitRate * 100).toFixed(1)}%`,
          details: kvData,
        });
      } catch (error) {
        checks.push({
          service: 'KV Namespace',
          status: 'error',
          message: 'メトリクス取得失敗',
        });
      }

      // 監視設定チェック
      try {
        const monitoringResponse = await apiClient.getAdminMonitoring();
        const monitoring = monitoringResponse.monitoring;
        const activeCount = monitoring.filter((m: any) => m.status === 'active').length;
        const pausedCount = monitoring.filter((m: any) => m.status === 'paused').length;

        setMonitoringStats({
          total: monitoring.length,
          active: activeCount,
          paused: pausedCount,
        });
        setAllTargets(monitoring);

        checks.push({
          service: '監視設定',
          status: 'healthy',
          message: `稼働中: ${activeCount}件、一時停止: ${pausedCount}件`,
          details: { total: monitoring.length, active: activeCount, paused: pausedCount },
        });
      } catch (error) {
        checks.push({
          service: '監視設定',
          status: 'error',
          message: '監視設定の取得に失敗',
        });
      }

      // APIヘルスチェック
      try {
        const healthResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'}/api/health`);
        const healthData = await healthResponse.json();
        checks.push({
          service: 'Workers API',
          status: healthData.status === 'ok' ? 'healthy' : 'error',
          message: `API正常: ${new Date(healthData.timestamp).toLocaleString('ja-JP')}`,
          details: healthData,
        });
      } catch (error) {
        checks.push({
          service: 'Workers API',
          status: 'error',
          message: 'APIに接続できません',
        });
      }

      setHealthChecks(checks);
    } catch (error) {
      console.error('Failed to load system health:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('メモリキャッシュをクリアします。よろしいですか?\n\n実行時メモリのキャッシュと統計情報がリセットされます。')) return;

    try {
      setLoading(true);
      await apiClient.clearMonitoringCache();
      alert('✅ キャッシュをクリアしました');
      await loadSystemHealth(); // 再チェック
    } catch (error: any) {
      console.error('Failed to clear cache:', error);
      alert('❌ キャッシュクリアに失敗しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestNotification = async () => {
    if (!confirm('プッシュ通知のテストを送信します。よろしいですか?\n\n自分のアカウントにテスト通知が送信されます。')) return;

    try {
      setLoading(true);
      const result = await apiClient.sendTestNotification();
      if (result.success) {
        alert('✅ テスト通知を送信しました\n\nプッシュ通知を有効にしている場合は、数秒以内に通知が届きます。');
      } else {
        alert('⚠️ 通知送信に失敗しました\n\nプッシュ通知が有効になっているか確認してください。');
      }
    } catch (error: any) {
      console.error('Failed to send test notification:', error);
      alert('❌ テスト通知の送信に失敗しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetSessions = async () => {
    if (!confirm('全ユーザーのセッションをリセットします。よろしいですか?\n\n⚠️ 全ユーザーが再ログインを求められる可能性があります。')) return;

    try {
      setLoading(true);
      const result = await apiClient.resetAllSessions();
      alert(`✅ セッションをリセットしました\n\n${result.count}名分のセッションをクリアしました。`);
      await loadSystemHealth(); // 再チェック
    } catch (error: any) {
      console.error('Failed to reset sessions:', error);
      alert('❌ セッションリセットに失敗しました: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleEnableMaintenance = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      await apiClient.enableMaintenance(customMessage);
      alert('メンテナンスモードを有効にしました\n\n注意: 完全に有効化するには、Workersの再デプロイが必要です');
      await loadMaintenanceStatus();
      setShowConfirm(null);
    } catch (error: any) {
      console.error('Failed to enable maintenance:', error);
      alert('メンテナンスモードの有効化に失敗しました: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDisableMaintenance = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      await apiClient.disableMaintenance();
      alert('メンテナンスモードを無効にしました\n\n注意: 完全に無効化するには、Workersの再デプロイが必要です');
      await loadMaintenanceStatus();
      setShowConfirm(null);
    } catch (error: any) {
      console.error('Failed to disable maintenance:', error);
      alert('メンテナンスモードの無効化に失敗しました: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePauseAll = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      const response = await apiClient.pauseAllMonitoring();
      alert(`全監視対象を一括停止しました\n\n停止: ${response.details.paused}件\n既に停止済み: ${response.details.skipped}件\nエラー: ${response.details.errors}件`);
      await loadMaintenanceStatus();
      await loadSystemHealth();
      setShowConfirm(null);
    } catch (error: any) {
      console.error('Failed to pause all monitoring:', error);
      alert('監視一括停止に失敗しました: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResumeAll = async () => {
    if (isProcessing) return;
    try {
      setIsProcessing(true);
      const response = await apiClient.resumeAllMonitoring();
      alert(`全監視対象を一括再開しました\n\n再開: ${response.details.resumed}件\n既にアクティブ: ${response.details.skipped}件\nエラー: ${response.details.errors}件`);
      await loadMaintenanceStatus();
      await loadSystemHealth();
      setShowConfirm(null);
    } catch (error: any) {
      console.error('Failed to resume all monitoring:', error);
      alert('監視一括再開に失敗しました: ' + error.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualCheck = async (target: any) => {
    if (!confirm(`監視ターゲット「${target.facilityName} (${target.date})」の手動チェックを実行しますか？\n\n・即座に施設の空き状況を確認します。\n・Cronを待たずに実行されます。\n・結果は履歴またはログで確認してください。`)) return;

    try {
      setCheckingTargetId(target.id);
      await apiClient.adminMonitoringCheck(target.id, target.userId);
      alert('✅ チェックリクエストを送信しました。\n結果はログまたは履歴を確認してください。');
    } catch (error: any) {
      console.error('Failed to manual check:', error);
      alert('❌ 手動チェックに失敗しました: ' + error.message);
    } finally {
      setCheckingTargetId(null);
    }
  };

  const handleManualCheck = async (target: any) => {
    if (!confirm(`監視ターゲット「${target.facilityName} (${target.date})」の手動チェックを実行しますか？\n\n・即座に施設の空き状況を確認します。\n・Cronを待たずに実行されます。\n・結果は履歴またはログで確認してください。`)) return;

    try {
      setCheckingTargetId(target.id);
      await apiClient.adminMonitoringCheck(target.id, target.userId);
      alert('✅ チェックリクエストを送信しました。\n結果はログまたは履歴を確認してください。');
    } catch (error: any) {
      console.error('Failed to manual check:', error);
      alert('❌ 手動チェックに失敗しました: ' + error.message);
    } finally {
      setCheckingTargetId(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">🛠️ 保守点検・メンテナンス管理</h1>
        <button
          onClick={loadSystemHealth}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? '確認中...' : '🔄 再チェック'}
        </button>
      </div>

      {/* メンテナンスモードコントロール */}
      <div className="bg-white rounded-xl shadow-md border">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">🛠️ メンテナンスモード</h2>
          <p className="text-sm text-gray-600 mt-1">システムのメンテナンスモードを制御</p>
        </div>
        <div className="p-6 space-y-4">
          {/* ステータス表示 */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-semibold text-gray-900">メンテナンスモード</p>
              <p className="text-sm text-gray-600 mt-1">
                {maintenanceStatus?.maintenanceMode.enabled
                  ? maintenanceStatus.maintenanceMode.message
                  : '通常運用中'}
              </p>
            </div>
            <div className={`px-4 py-2 rounded-full font-semibold ${maintenanceStatus?.maintenanceMode.enabled
              ? 'bg-orange-100 text-orange-700'
              : 'bg-emerald-100 text-emerald-700'
              }`}>
              {maintenanceStatus?.maintenanceMode.enabled ? '🛠️ 有効' : '✅ 無効'}
            </div>
          </div>

          {/* 監視状態 */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <p className="font-semibold text-gray-900">監視設定状態</p>
              <p className="text-sm text-gray-600 mt-1">
                全{maintenanceStatus?.monitoring.total || 0}件
                (アクティブ: {maintenanceStatus?.monitoring.active || 0}件
                / 停止中: {maintenanceStatus?.monitoring.paused || 0}件)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
              <span className="text-sm font-medium text-gray-700">
                {maintenanceStatus?.monitoring.active || 0}件 稼働中
              </span>
            </div>
          </div>

          {/* メッセージ入力 */}
          {!maintenanceStatus?.maintenanceMode.enabled && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                メンテナンスメッセージ
              </label>
              <input
                type="text"
                value={customMessage}
                onChange={(e) => setCustomMessage(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-transparent"
                placeholder="システムメンテナンス中です。しばらくお待ちください。"
              />
            </div>
          )}

          {/* ボタン */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!maintenanceStatus?.maintenanceMode.enabled ? (
              <button
                onClick={() => setShowConfirm('enable')}
                disabled={isProcessing}
                className="px-6 py-3 bg-orange-500 text-white font-semibold rounded-lg hover:bg-orange-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                🛠️ メンテナンスモード有効化
              </button>
            ) : (
              <button
                onClick={() => setShowConfirm('disable')}
                disabled={isProcessing}
                className="px-6 py-3 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              >
                ✅ メンテナンスモード無効化
              </button>
            )}

            <button
              onClick={() => setShowConfirm('pauseAll')}
              disabled={isProcessing || (maintenanceStatus?.monitoring.active || 0) === 0}
              className="px-6 py-3 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              ⏸️ 全監視を一括停止
            </button>

            <button
              onClick={() => setShowConfirm('resumeAll')}
              disabled={isProcessing || (maintenanceStatus?.monitoring.paused || 0) === 0}
              className="px-6 py-3 bg-emerald-500 text-white font-semibold rounded-lg hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              ▶️ 全監視を一括再開
            </button>
          </div>

          {/* 注意事項 */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              <strong>⚠️ 重要:</strong> メンテナンスモードの完全な有効化/無効化には、
              wrangler.tomlの<code className="px-1 bg-yellow-100 rounded">MAINTENANCE_MODE</code>変数を
              変更してWorkersを再デプロイする必要があります。
            </p>
          </div>
        </div>
      </div>

      {/* システムヘルスチェック */}
      <div className="bg-white rounded-xl shadow-md border">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">システムヘルスチェック</h2>
          <p className="text-sm text-gray-600 mt-1">各サービスの稼働状況を確認</p>
        </div>
        <div className="p-6 space-y-4">
          {loading && healthChecks.length === 0 ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">ヘルスチェック実行中...</p>
            </div>
          ) : (
            healthChecks.map((check, index) => (
              <div
                key={index}
                className={`p-4 rounded-lg border-l-4 ${check.status === 'healthy'
                  ? 'bg-green-50 border-green-500'
                  : check.status === 'warning'
                    ? 'bg-yellow-50 border-yellow-500'
                    : 'bg-red-50 border-red-500'
                  }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">
                        {check.status === 'healthy'
                          ? '✅'
                          : check.status === 'warning'
                            ? '⚠️'
                            : '❌'}
                      </span>
                      <h3 className="font-semibold text-gray-900">{check.service}</h3>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">{check.message}</p>
                    {check.details && (
                      <details className="mt-2">
                        <summary className="text-xs text-gray-600 cursor-pointer hover:text-gray-900">
                          詳細を表示
                        </summary>
                        <pre className="text-xs bg-gray-100 p-2 rounded mt-2 overflow-x-auto">
                          {JSON.stringify(check.details, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* システム統計 */}
      {monitoringStats && (
        <div className="bg-white rounded-xl shadow-md border">
          <div className="p-6 border-b">
            <h2 className="text-xl font-bold text-gray-900">システム統計</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg">
                <div className="text-sm text-blue-600 font-medium">総監視設定</div>
                <div className="text-3xl font-bold text-blue-900 mt-1">
                  {monitoringStats.total}
                </div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <div className="text-sm text-green-600 font-medium">稼働中</div>
                <div className="text-3xl font-bold text-green-900 mt-1">
                  {monitoringStats.active}
                </div>
              </div>
              <div className="p-4 bg-yellow-50 rounded-lg">
                <div className="text-sm text-yellow-600 font-medium">一時停止</div>
                <div className="text-3xl font-bold text-yellow-900 mt-1">
                  {monitoringStats.paused}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* メンテナンスツール */}
      <div className="bg-white rounded-xl shadow-md border">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">メンテナンスツール</h2>
          <p className="text-sm text-gray-600 mt-1">システムメンテナンス操作</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">キャッシュクリア</h3>
              <p className="text-sm text-gray-600">メモリキャッシュをクリアして最新データを取得</p>
            </div>
            <button
              onClick={handleClearCache}
              className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition"
            >
              🗑️ クリア
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">通知テスト</h3>
              <p className="text-sm text-gray-600">プッシュ通知の動作確認</p>
            </div>
            <button
              onClick={handleTestNotification}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              📱 テスト送信
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">通知設定の修復</h3>
              <p className="text-sm text-gray-600">ブラウザとサーバーの通知設定を同期</p>
            </div>
            <button
              onClick={async () => {
                if (!confirm('通知設定を再同期しますか？')) return;
                try {
                  setIsProcessing(true);
                  const result = await subscribe();
                  if (result) {
                    alert('✅ 通知設定を修復・同期しました');
                  } else {
                    alert('⚠️ 通知設定の修復に失敗しました。通知がブロックされていないか確認してください。');
                  }
                } catch (e: any) {
                  alert('❌ エラー: ' + e.message);
                } finally {
                  setIsProcessing(false);
                }
              }}
              disabled={isProcessing || !isSupported}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
            >
              🔄 修復・同期
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">Workersログ確認</h3>
              <p className="text-sm text-gray-600">Cloudflare Workers のリアルタイムログを確認</p>
            </div>
            <button
              onClick={() => window.open('https://dash.cloudflare.com', '_blank')}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
            >
              🔗 Cloudflare開く
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">セッション一括リセット</h3>
              <p className="text-sm text-gray-600">全ユーザーのログインセッションをクリア</p>
            </div>
            <button
              onClick={handleResetSessions}
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50"
            >
              🔄 リセット
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <h3 className="font-semibold text-gray-900">デプロイ情報</h3>
              <p className="text-sm text-gray-600">Workers・PWAのデプロイ状況を確認</p>
            </div>
            <button
              onClick={() => alert('Workers: wrangler deploy\nPWA: vercel --prod')}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
            >
              📋 コマンド表示
            </button>
          </div>
        </div>
      </div>

      {/* 手動監視実行ツール */}
      <div className="bg-white rounded-xl shadow-md border">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold text-gray-900">手動監視実行 (テスト予約)</h2>
          <p className="text-sm text-gray-600 mt-1">
            アクティブな監視ターゲットを選択して、即座に空き確認を実行します。
          </p>
        </div>
        <div className="p-6">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID / ユーザー</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">施設 / 日付</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {allTargets.filter(t => t.status === 'active').map((target) => (
                  <tr key={target.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="font-mono text-xs text-gray-500">{target.id.substring(0, 8)}...</div>
                      <div className="text-xs text-blue-600">{target.userId}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      <div className="font-medium">{target.facilityName}</div>
                      <div className="text-gray-500 text-xs text-nowrap">
                        {target.date || `${target.startDate}~`}
                        {target.timeSlots && ` (${target.timeSlots.length})`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs">
                        {target.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleManualCheck(target)}
                        disabled={!!checkingTargetId}
                        className="px-3 py-1 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition disabled:opacity-50 text-nowrap"
                      >
                        {checkingTargetId === target.id ? '実行中...' : '▶️ テスト'}
                      </button>
                    </td>
                  </tr>
                ))}
                {allTargets.filter(t => t.status === 'active').length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                      アクティブな監視設定がありません
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div >

      {/* 注意事項 */}
      < div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6" >
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-yellow-900">メンテナンス時の注意</h3>
            <ul className="text-sm text-yellow-800 mt-2 space-y-1">
              <li>• キャッシュクリアはWorkers再デプロイで自動実行されます</li>
              <li>• 深夜早朝(24:00-3:15)はログイン不可のため予約処理に影響があります</li>
              <li>• セッションは3:15に自動リセットされます</li>
              <li>• Cronは毎分実行され、5:00に一斉予約処理が行われます</li>
              <li>• メンテナンスモード有効時はCron実行がスキップされます</li>
            </ul>
          </div>
        </div>
      </div >

      {/* 確認ダイアログ */}
      {
        showConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">
                {showConfirm === 'enable' && '🛠️ メンテナンスモード有効化'}
                {showConfirm === 'disable' && '✅ メンテナンスモード無効化'}
                {showConfirm === 'pauseAll' && '⏸️ 全監視一括停止'}
                {showConfirm === 'resumeAll' && '▶️ 全監視一括再開'}
              </h3>
              <p className="text-gray-700 mb-6 whitespace-pre-wrap">
                {showConfirm === 'enable' && 'メンテナンスモードを有効にしますか？\nCron実行時の監視処理が全てスキップされます。'}
                {showConfirm === 'disable' && 'メンテナンスモードを無効にしますか？\n通常の監視処理が再開されます。'}
                {showConfirm === 'pauseAll' && `全ての監視設定を一括停止しますか？\n${maintenanceStatus?.monitoring.active || 0}件の監視が停止されます。`}
                {showConfirm === 'resumeAll' && `全ての監視設定を一括再開しますか？\n${maintenanceStatus?.monitoring.paused || 0}件の監視が再開されます。`}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirm(null)}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={() => {
                    if (showConfirm === 'enable') handleEnableMaintenance();
                    if (showConfirm === 'disable') handleDisableMaintenance();
                    if (showConfirm === 'pauseAll') handlePauseAll();
                    if (showConfirm === 'resumeAll') handleResumeAll();
                  }}
                  disabled={isProcessing}
                  className={`flex-1 px-4 py-2 text-white font-semibold rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors ${showConfirm === 'enable' || showConfirm === 'pauseAll'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-emerald-500 hover:bg-emerald-600'
                    }`}
                >
                  {isProcessing ? '処理中...' : '実行'}
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}
