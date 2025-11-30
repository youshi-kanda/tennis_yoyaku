'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'warning' | 'error';
  message: string;
  details?: any;
}

export default function AdminMaintenancePage() {
  const { isAdmin } = useAuthStore();
  const router = useRouter();
  const [healthChecks, setHealthChecks] = useState<HealthCheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [monitoringStats, setMonitoringStats] = useState<any>(null);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
    }
  }, [isAdmin, router]);

  useEffect(() => {
    if (isAdmin) {
      loadSystemHealth();
    }
  }, [isAdmin]);

  const loadSystemHealth = async () => {
    try {
      setLoading(true);
      const checks: HealthCheckResult[] = [];

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

  if (!isAdmin) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">🔧 保守点検</h1>
        <button
          onClick={loadSystemHealth}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
        >
          {loading ? '確認中...' : '🔄 再チェック'}
        </button>
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
                className={`p-4 rounded-lg border-l-4 ${
                  check.status === 'healthy'
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

      {/* 注意事項 */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <span className="text-2xl">⚠️</span>
          <div>
            <h3 className="font-semibold text-yellow-900">メンテナンス時の注意</h3>
            <ul className="text-sm text-yellow-800 mt-2 space-y-1">
              <li>• キャッシュクリアはWorkers再デプロイで自動実行されます</li>
              <li>• 深夜早朝(24:00-3:15)はログイン不可のため予約処理に影響があります</li>
              <li>• セッションは3:15に自動リセットされます</li>
              <li>• Cronは毎分実行され、5:00に一斉予約処理が行われます</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
