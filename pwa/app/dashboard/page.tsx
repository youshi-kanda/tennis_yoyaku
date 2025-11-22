'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { apiClient } from '@/lib/api/client';
import Link from 'next/link';

interface Stats {
  activeMonitoring: number;
  totalReservations: number;
  successRate: number;
}

export default function DashboardHome() {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<Stats>({
    activeMonitoring: 0,
    totalReservations: 0,
    successRate: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setIsLoading(true);
      
      // 監視数を取得
      const monitoringResponse = await apiClient.getMonitoringList();
      const activeCount = monitoringResponse.data?.filter((t: { status: string }) => t.status === 'active').length || 0;
      
      // 予約履歴を取得
      const historyResponse = await apiClient.getReservationHistory(100);
      const reservations = historyResponse.data || [];
      const successCount = reservations.filter((r: { status: string }) => r.status === 'success').length;
      const successRate = reservations.length > 0 ? Math.round((successCount / reservations.length) * 100) : 0;
      
      setStats({
        activeMonitoring: activeCount,
        totalReservations: reservations.length,
        successRate,
      });
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">
          ダッシュボード
        </h1>
        <p className="text-gray-600 mt-2">
          ようこそ、{user?.email}さん
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* 監視中の施設 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">監視中の施設</h3>
            <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900 mb-1">{stats.activeMonitoring}</p>
              <p className="text-sm text-gray-500">アクティブな監視</p>
            </>
          )}
        </div>

        {/* 予約履歴 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">予約履歴</h3>
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900 mb-1">{stats.totalReservations}</p>
              <p className="text-sm text-gray-500">合計予約数</p>
            </>
          )}
        </div>

        {/* 成功率 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-600">予約成功率</h3>
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
          {isLoading ? (
            <div className="animate-pulse">
              <div className="h-8 bg-gray-200 rounded w-16 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-24"></div>
            </div>
          ) : (
            <>
              <p className="text-3xl font-bold text-gray-900 mb-1">{stats.successRate}%</p>
              <p className="text-sm text-gray-500">成功した予約</p>
            </>
          )}
        </div>
      </div>

      {/* クイックアクション */}
      <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">クイックアクション</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link 
            href="/dashboard/monitoring"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-emerald-500 hover:bg-emerald-50 transition-colors group"
          >
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-emerald-200">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">監視を追加</h3>
              <p className="text-sm text-gray-600">新しい施設を監視開始</p>
            </div>
          </Link>

          <Link 
            href="/dashboard/history"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-blue-200">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">予約履歴</h3>
              <p className="text-sm text-gray-600">過去の予約を確認</p>
            </div>
          </Link>

          <Link 
            href="/dashboard/settings"
            className="flex items-center p-4 border border-gray-200 rounded-lg hover:border-purple-500 hover:bg-purple-50 transition-colors group"
          >
            <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mr-4 group-hover:bg-purple-200">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">設定</h3>
              <p className="text-sm text-gray-600">アカウント設定を変更</p>
            </div>
          </Link>
        </div>
      </div>

      {/* お知らせ */}
      <div className="bg-linear-to-r from-emerald-50 to-teal-50 rounded-xl p-6 border border-emerald-200">
        <div className="flex items-start">
          <div className="shrink-0">
            <svg className="w-6 h-6 text-emerald-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-emerald-900 mb-1">使い方のヒント</h3>
            <ul className="text-sm text-emerald-800 space-y-1">
              <li>• 監視設定で「自動予約」をONにすると、空きを検知した際に自動で予約を試みます</li>
              <li>• 設定ページで品川区・港区の予約サイトのログイン情報を登録してください</li>
              <li>• 監視は60秒間隔で自動実行されます</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
