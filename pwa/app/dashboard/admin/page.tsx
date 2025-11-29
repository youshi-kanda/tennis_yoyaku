'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface SystemStats {
  totalUsers: number;
  totalMonitoringTargets: number;
  activeMonitoring: number;
  pausedMonitoring: number;
  totalReservations: number;
  successfulReservations: number;
  kvMetrics: {
    reads: number;
    writes: number;
    cacheHitRate: number;
  };
}

export default function AdminDashboard() {
  const { isAdmin } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) {
      router.push('/dashboard');
      return;
    }
    loadStats();
  }, [isAdmin, router]);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      const { apiClient } = await import('@/lib/api/client');
      const response = await apiClient.getAdminStats();
      
      setStats({
        totalUsers: response.users.total,
        totalMonitoringTargets: response.monitoring.total,
        activeMonitoring: response.monitoring.active,
        pausedMonitoring: response.monitoring.paused,
        totalReservations: response.reservations.total,
        successfulReservations: response.reservations.success,
        kvMetrics: {
          reads: response.kv.reads,
          writes: response.kv.writes,
          cacheHitRate: parseFloat(response.kv.cacheHitRate),
        },
      });
    } catch (error) {
      console.error('Failed to load admin stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* ヘッダー */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          🛡️ 管理者ダッシュボード
        </h1>
        <p className="text-gray-600 mt-2">
          システム全体の状況を監視・管理します
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* 総ユーザー数 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">総ユーザー数</h3>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </div>
          ) : (
            <p className="text-3xl font-bold text-gray-900">{stats?.totalUsers || 0}</p>
          )}
        </div>

        {/* 監視設定数 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">監視設定数</h3>
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900">{stats?.totalMonitoringTargets || 0}</p>
              <p className="text-xs text-gray-500 mt-1">
                アクティブ: {stats?.activeMonitoring || 0} / 停止: {stats?.pausedMonitoring || 0}
              </p>
            </>
          )}
        </div>

        {/* 予約数 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">予約数</h3>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900">{stats?.totalReservations || 0}</p>
              <p className="text-xs text-gray-500 mt-1">
                成功: {stats?.successfulReservations || 0}
              </p>
            </>
          )}
        </div>

        {/* KVメトリクス */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">KV使用量</h3>
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900">
                {((stats?.kvMetrics.cacheHitRate || 0) * 100).toFixed(0)}%
              </p>
              <p className="text-xs text-gray-500 mt-1">キャッシュヒット率</p>
            </>
          )}
        </div>
      </div>

      {/* クイックアクション */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/dashboard/admin/users">
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">ユーザー管理</h3>
                <p className="text-sm text-gray-600">ユーザー一覧・詳細</p>
              </div>
            </div>
          </div>
        </Link>

        <Link href="/dashboard/admin/logs">
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">システムログ</h3>
                <p className="text-sm text-gray-600">Cron・エラーログ</p>
              </div>
            </div>
          </div>
        </Link>

        <Link href="/dashboard/admin/maintenance">
          <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 hover:shadow-lg transition-shadow cursor-pointer">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
                <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900">保守点検</h3>
                <p className="text-sm text-gray-600">システムチェック</p>
              </div>
            </div>
          </div>
        </Link>
      </div>

      {/* システム情報 */}
      <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
        <h2 className="text-lg font-bold text-gray-900 mb-4">システム情報</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">Workers バージョン</p>
            <p className="font-mono text-sm text-gray-900 mt-1">622eb032-9b88-43c4-8099-19fbd9379f68</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">Cron 実行間隔</p>
            <p className="font-mono text-sm text-gray-900 mt-1">*/1 * * * * (毎分)</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">環境</p>
            <p className="font-mono text-sm text-gray-900 mt-1">Production</p>
          </div>
          <div>
            <p className="text-sm text-gray-600">最終デプロイ</p>
            <p className="font-mono text-sm text-gray-900 mt-1">{new Date().toLocaleString('ja-JP')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
