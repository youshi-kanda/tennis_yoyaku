'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { apiClient } from '@/lib/api/client';
import { MonitoringCalendar } from '@/components/monitoring/MonitoringCalendar';
import { MonitoringCard } from '@/components/monitoring/MonitoringCard';
import { MonitoringDetailModal } from '@/components/monitoring/MonitoringDetailModal';
import { MonitoringEditModal } from '@/components/monitoring/MonitoringEditModal';
import { MonitoringTarget } from '@/lib/types';
import { useRouter } from 'next/navigation';

interface Stats {
  activeMonitoring: number;
  totalReservations: number;
  successRate: number;
}

export default function DashboardHome() {
  const { user } = useAuthStore();
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    activeMonitoring: 0,
    totalReservations: 0,
    successRate: 0,
  });
  const [targets, setTargets] = useState<MonitoringTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<MonitoringTarget | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);
      
      // 監視ターゲットを取得
      const monitoringResponse = await apiClient.getMonitoringList();
      const monitoringTargets = monitoringResponse.data || [];
      setTargets(monitoringTargets);
      
      const activeCount = monitoringTargets.filter((t: MonitoringTarget) => t.status === 'active' || t.status === 'monitoring').length;
      
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
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (target: MonitoringTarget) => {
    if (!confirm('この監視設定を削除しますか？\n\n削除すると、この設定による自動監視が完全に停止されます。')) return;
    
    try {
      await apiClient.deleteMonitoring(target.id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete monitoring:', error);
      alert('監視設定の削除に失敗しました');
    }
  };

  const handlePause = async (target: MonitoringTarget) => {
    if (!confirm('この監視を一時停止しますか？\n\n設定は保持されたまま、自動監視のみが停止されます。')) return;
    
    try {
      await apiClient.pauseMonitoring(target.id);
      await loadData();
    } catch (error) {
      console.error('Failed to pause monitoring:', error);
      alert('監視の停止に失敗しました');
    }
  };

  const handleResume = async (target: MonitoringTarget) => {
    if (!confirm('この監視を再開しますか？\n\n設定通りに自動監視が再開されます。')) return;
    
    try {
      await apiClient.resumeMonitoring(target.id);
      await loadData();
    } catch (error) {
      console.error('Failed to resume monitoring:', error);
      alert('監視の再開に失敗しました');
    }
  };

  const handleEdit = (target: MonitoringTarget) => {
    setEditingTarget(target);
    setIsEditModalOpen(true);
    setIsDetailModalOpen(false);
  };

  const handleSaveEdit = async (updates: {
    timeSlots?: string[];
    selectedWeekdays?: number[];
    includeHolidays?: boolean | 'only';
    autoReserve?: boolean;
  }) => {
    if (!editingTarget) return;
    
    try {
      await apiClient.updateMonitoring(editingTarget.id, updates);
      await loadData();
      setIsEditModalOpen(false);
      setEditingTarget(null);
    } catch (error) {
      console.error('Failed to update monitoring:', error);
      throw error;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* ヘッダー */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          ダッシュボード
        </h1>
        <p className="text-gray-600 mt-2">
          ようこそ、{user?.email}さん
        </p>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 監視中の施設 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-900">監視中の施設</h3>
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
              <p className="text-sm text-gray-900">アクティブな監視</p>
            </>
          )}
        </div>

        {/* 予約履歴 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-900">予約履歴</h3>
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
              <p className="text-sm text-gray-900">合計予約数</p>
            </>
          )}
        </div>

        {/* 成功率 */}
        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-900">予約成功率</h3>
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
              <p className="text-sm text-gray-900">成功した予約</p>
            </>
          )}
        </div>
      </div>

      {/* カレンダー */}
      {!isLoading && <MonitoringCalendar targets={targets} />}

      {/* 監視中の設定一覧 */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-gray-900">📋 監視中の設定</h2>
          <Button
            onClick={() => router.push('/dashboard/monitoring')}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            + 新規追加
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse bg-white rounded-lg p-6 border">
                <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-2/3"></div>
              </div>
            ))}
          </div>
        ) : targets.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-12 text-center border border-gray-200">
            <svg
              className="w-16 h-16 text-gray-300 mx-auto mb-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">監視設定がありません</h3>
            <p className="text-gray-500 mb-6">
              右上の「新規追加」ボタンから監視を追加してください
            </p>
            <Button
              onClick={() => router.push('/dashboard/monitoring')}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              監視を追加
            </Button>
          </div>
        ) : (
          <>
            {/* 集約カード */}
            <div className="bg-white rounded-xl shadow-md p-6 border border-gray-200 mb-4">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">
                    監視中の設定 ({targets.length}施設)
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    アクティブ: {targets.filter((t) => t.status === 'active').length}件 / 
                    停止中: {targets.filter((t) => t.status === 'paused').length}件
                  </p>
                </div>
                <button
                  onClick={() => setIsDetailModalOpen(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  詳細を見る
                </button>
              </div>

              {/* 施設の簡易リスト */}
              <div className="space-y-2">
                {targets.slice(0, 5).map((target) => (
                  <div
                    key={target.id}
                    className="flex items-center justify-between py-2 px-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        target.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'
                      }`} />
                      <span className="text-sm text-gray-900 truncate">
                        {target.facilityName}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        ({target.site === 'shinagawa' ? '品川' : '港区'})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {target.timeSlots?.slice(0, 2).map((slot, idx) => (
                        <span
                          key={idx}
                          className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded"
                        >
                          {slot.split('-')[0]}
                        </span>
                      ))}
                      {target.timeSlots && target.timeSlots.length > 2 && (
                        <span className="text-xs text-gray-500">
                          +{target.timeSlots.length - 2}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {targets.length > 5 && (
                  <div className="text-center py-2">
                    <button
                      onClick={() => setIsDetailModalOpen(true)}
                      className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      他 {targets.length - 5}件を表示
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 詳細モーダル */}
      <MonitoringDetailModal
        targets={targets}
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPause={handlePause}
        onResume={handleResume}
      />

      {/* 編集モーダル */}
      {editingTarget && (
        <MonitoringEditModal
          target={editingTarget}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false);
            setEditingTarget(null);
          }}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

function Button({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg font-medium transition-colors ${className}`}
    >
      {children}
    </button>
  );
}
