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

interface MonitoringGroup {
  key: string;
  site: 'shinagawa' | 'minato';
  targets: MonitoringTarget[];
  timeSlots: string[];
  selectedWeekdays: number[];
  includeHolidays: boolean | 'only';
  sites: Set<'shinagawa' | 'minato'>;
}

// facilityIdから施設名を復元する関数
const getFacilityNameFromId = (facilityId: string, savedName: string): string => {
  // 既に完全な施設名（コート情報含む）がある場合はそのまま返す
  if (savedName.includes('庭球場') || savedName.includes('テニスコート')) {
    return savedName;
  }

  // 安全対策: facilityIdがない場合はそのまま返す
  if (!facilityId) return savedName;

  // facilityIdの末尾からコート番号を推定
  // 品川区: 10400010 → A, 10400020 → B, 10400030 → C, 10400040 → D
  // 港区: 1001 → A, 1002 → B, 1003 → C, 1004 → D
  const lastTwo = facilityId.slice(-2);
  const courtMap: { [key: string]: string } = {
    '10': 'Ａ', '20': 'Ｂ', '30': 'Ｃ', '40': 'Ｄ', '50': 'Ｅ',
    '01': 'Ａ', '02': 'Ｂ', '03': 'Ｃ', '04': 'Ｄ',
  };

  const court = courtMap[lastTwo];

  if (court) {
    // 品川区の場合
    if (savedName.includes('しながわ') || savedName.includes('品川') || savedName.includes('八潮') || savedName.includes('大井')) {
      return `${savedName} 庭球場${court}`;
    }
    // 港区の場合
    if (savedName.includes('麻布') || savedName.includes('青山') || savedName.includes('芝浦')) {
      return `${savedName} テニスコート${court}`;
    }
  }

  return savedName;
};

export default function DashboardHome() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [targets, setTargets] = useState<MonitoringTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<MonitoringTarget | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<MonitoringGroup | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{
    show: boolean;
    current: number;
    total: number;
    action: string;
  }>({ show: false, current: 0, total: 0, action: '' });
  const [maintenanceStatus, setMaintenanceStatus] = useState<MaintenanceStatus | null>(null);

  const [minatoSessionStatus, setMinatoSessionStatus] = useState<'valid' | 'expired' | 'unknown'>('unknown');

  useEffect(() => {
    loadData();
    loadMaintenanceStatus();
    loadSettingsStatus();
  }, []);

  const loadSettingsStatus = async () => {
    try {
      const response = await apiClient.getSettings();
      if (response.success && response.data) {
        if (response.data.minatoSessionStatus) {
          setMinatoSessionStatus(response.data.minatoSessionStatus === 'valid' ? 'valid' : 'expired');
        } else {
          // 古いデータ等の場合
          setMinatoSessionStatus('expired');
        }
      }
    } catch (e) {
      console.error('Failed to load settings status', e);
    }
  };

  const loadMaintenanceStatus = async () => {
    try {
      const response = await apiClient.getMaintenanceStatus();
      setMaintenanceStatus(response);
    } catch (error) {
      console.error('Failed to load maintenance status:', error);
    }
  };

  const loadData = async () => {
    try {
      setIsLoading(true);

      // 監視ターゲットを取得
      const monitoringResponse = await apiClient.getMonitoringList();
      const monitoringTargets = monitoringResponse.data || [];
      setTargets(monitoringTargets);

      setTargets(monitoringTargets);
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

  const handleBulkPause = async (groupTargets: MonitoringTarget[]) => {
    const activeTargets = groupTargets.filter(t => t.status === 'active' || t.status === 'monitoring');
    if (activeTargets.length === 0) return;

    if (!confirm(`このグループの${activeTargets.length}件の監視を一時停止しますか？`)) return;

    setBulkProgress({ show: true, current: 0, total: activeTargets.length, action: '停止中' });
    try {
      // 順次処理でKV競合を回避
      for (let i = 0; i < activeTargets.length; i++) {
        await apiClient.pauseMonitoring(activeTargets[i].id);
        setBulkProgress({ show: true, current: i + 1, total: activeTargets.length, action: '停止中' });
      }
      await loadData();
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Failed to bulk pause:', error);
      alert('一括停止に失敗しました');
    } finally {
      setBulkProgress({ show: false, current: 0, total: 0, action: '' });
    }
  };

  const handleBulkResume = async (groupTargets: MonitoringTarget[]) => {
    const pausedTargets = groupTargets.filter(t => t.status === 'paused');
    if (pausedTargets.length === 0) return;

    if (!confirm(`このグループの${pausedTargets.length}件の監視を再開しますか？`)) return;

    setBulkProgress({ show: true, current: 0, total: pausedTargets.length, action: '再開中' });
    try {
      // 順次処理でKV競合を回避
      for (let i = 0; i < pausedTargets.length; i++) {
        await apiClient.resumeMonitoring(pausedTargets[i].id);
        setBulkProgress({ show: true, current: i + 1, total: pausedTargets.length, action: '再開中' });
      }
      await loadData();
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Failed to bulk resume:', error);
      alert('一括再開に失敗しました');
    } finally {
      setBulkProgress({ show: false, current: 0, total: 0, action: '' });
    }
  };

  const handleBulkDelete = async (groupTargets: MonitoringTarget[]) => {
    if (!confirm(`このグループの${groupTargets.length}件の監視設定を削除しますか？\n\n削除すると、このグループによる自動監視が完全に停止されます。`)) return;

    setBulkProgress({ show: true, current: 0, total: groupTargets.length, action: '削除中' });
    try {
      // 順次処理でKV競合を回避（並列実行すると404/500エラー）
      for (let i = 0; i < groupTargets.length; i++) {
        try {
          await apiClient.deleteMonitoring(groupTargets[i].id);
        } catch (err) {
          const error = err as Error;
          // 404は既に削除済みなので無視
          if (error.message?.includes('404') || error.message?.includes('not found')) {
            console.log(`Target ${groupTargets[i].id} already deleted, skipping`);
          } else {
            throw error;
          }
        }
        setBulkProgress({ show: true, current: i + 1, total: groupTargets.length, action: '削除中' });
      }
      await loadData();
      setIsDetailModalOpen(false);
    } catch (error) {
      console.error('Failed to bulk delete:', error);
      alert('一括削除に失敗しました');
    } finally {
      setBulkProgress({ show: false, current: 0, total: 0, action: '' });
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
    <div className="max-w-7xl mx-auto space-y-4 lg:space-y-8">
      {/* メンテナンスモード警告 */}
      {maintenanceStatus?.maintenanceMode.enabled && (
        <div className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded-lg shadow-md">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0">
              <svg className="w-6 h-6 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-orange-800 font-semibold text-lg">🛠️ システムメンテナンス中</h3>
              <p className="text-orange-700 mt-1">
                {maintenanceStatus.maintenanceMode.message}
              </p>
              <p className="text-orange-600 text-sm mt-2">
                現在、自動監視処理は一時停止しています。管理者による作業完了後、自動的に再開されます。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
          ダッシュボード
        </h1>
        <p className="text-gray-600 mt-2">
          ようこそ、{user?.email}さん
        </p>
      </div>

      {/* ⚠️ 港区セッション切れアラート */}
      {minatoSessionStatus === 'expired' && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg shadow-sm animate-in fade-in slide-in-from-top-2">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚨</span>
              <div>
                <h3 className="text-red-800 font-bold">港区のセッションが切れています</h3>
                <p className="text-red-700 text-sm mt-1">
                  現在、港区の自動監視・予約が停止している可能性があります。
                </p>
              </div>
            </div>
            <Button
              onClick={() => router.push('/dashboard/settings')}
              className="bg-red-600 hover:bg-red-700 text-white shadow-sm whitespace-nowrap"
            >
              再取得する
            </Button>
          </div>
        </div>
      )}



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
          <div className="bg-white rounded-xl shadow-md p-8 lg:p-12 text-center border border-gray-200">
            <svg
              className="w-12 h-12 lg:w-16 lg:h-16 text-gray-300 mx-auto mb-4"
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
            {/* グループ化カード表示 */}
            {(() => {
              // 設定グループ化ロジック
              const groupedSettings = new Map<string, {
                targets: MonitoringTarget[];
                timeSlots: string[];
                selectedWeekdays: number[];
                includeHolidays: boolean | 'only';
                sites: Set<'shinagawa' | 'minato'>;
              }>();

              targets.forEach(target => {
                const weekdays = target.selectedWeekdays?.sort().join(',') || 'all';
                const timeSlots = target.timeSlots?.sort().join(',') || 'all';
                const holidays = String(target.includeHolidays ?? 'true');
                const groupKey = `${weekdays}|${timeSlots}|${holidays}`;

                const existing = groupedSettings.get(groupKey);
                if (existing) {
                  existing.targets.push(target);
                  existing.sites.add(target.site);
                } else {
                  groupedSettings.set(groupKey, {
                    targets: [target],
                    timeSlots: target.timeSlots || [],
                    selectedWeekdays: target.selectedWeekdays || [0, 1, 2, 3, 4, 5, 6],
                    includeHolidays: target.includeHolidays ?? true,
                    sites: new Set([target.site]),
                  });
                }
              });

              return (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-gray-600">
                      {groupedSettings.size}グループ・{targets.length}施設を監視中
                      （アクティブ: {targets.filter((t) => t.status === 'active').length}件 /
                      停止中: {targets.filter((t) => t.status === 'paused').length}件）
                    </p>
                    <button
                      onClick={() => setIsDetailModalOpen(true)}
                      className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                    >
                      全て表示
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from(groupedSettings.entries()).map(([groupKey, group]) => {
                      // グループのタイトル生成
                      const weekdayLabels = group.selectedWeekdays.map(d => ['日', '月', '火', '水', '木', '金', '土'][d]);
                      let title = '';

                      if (group.selectedWeekdays.length === 7) {
                        title = '毎日';
                      } else if (group.selectedWeekdays.length === 5 &&
                        JSON.stringify(group.selectedWeekdays) === JSON.stringify([1, 2, 3, 4, 5])) {
                        title = '平日';
                      } else if (group.selectedWeekdays.length === 2 &&
                        JSON.stringify(group.selectedWeekdays) === JSON.stringify([0, 6])) {
                        title = '週末';
                      } else {
                        title = weekdayLabels.join('・');
                      }

                      if (group.includeHolidays === 'only') {
                        title = '祝日のみ';
                      } else if (group.includeHolidays === false && title === '平日') {
                        title = '平日（祝日除外）';
                      } else if (group.includeHolidays === true && title === '週末') {
                        title = '週末・祝日';
                      }

                      const activeCount = group.targets.filter(t => t.status === 'active').length;
                      const pausedCount = group.targets.filter(t => t.status === 'paused').length;

                      return (
                        <div
                          key={groupKey}
                          className="bg-white border-2 border-gray-200 rounded-xl shadow-md hover:shadow-xl hover:border-emerald-400 transition-all duration-200"
                        >
                          {/* カードヘッダー */}
                          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 p-4 rounded-t-xl border-b border-gray-200">
                            <div className="flex items-start justify-between mb-2">
                              <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                              <div className="flex items-center gap-1">
                                {Array.from(group.sites).map(site => (
                                  <span
                                    key={site}
                                    className={`px-2 py-1 rounded-full text-xs font-bold ${site === 'shinagawa' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                                      }`}
                                  >
                                    {site === 'shinagawa' ? '品川' : '港区'}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-white border border-gray-300 rounded-full text-xs font-semibold text-gray-700">
                                🏢 {group.targets.length}施設
                              </span>
                              {activeCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 border border-emerald-300 rounded-full text-xs font-semibold text-emerald-700">
                                  ● {activeCount}件稼働中
                                </span>
                              )}
                              {pausedCount > 0 && (
                                <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 border border-gray-300 rounded-full text-xs font-semibold text-gray-600">
                                  ⏸ {pausedCount}件停止中
                                </span>
                              )}
                            </div>
                          </div>

                          {/* カード本文 */}
                          <div className="p-4">
                            {/* 時間帯 */}
                            <div className="mb-3">
                              <div className="text-xs text-gray-600 mb-1">🕐 時間帯</div>
                              <div className="flex flex-wrap gap-1">
                                {group.timeSlots.length === 6 ? (
                                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                                    全時間帯 (9:00-21:00)
                                  </span>
                                ) : (
                                  group.timeSlots.slice(0, 3).map((slot, idx) => (
                                    <span
                                      key={idx}
                                      className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium"
                                    >
                                      {slot}
                                    </span>
                                  ))
                                )}
                                {group.timeSlots.length > 3 && group.timeSlots.length !== 6 && (
                                  <span className="px-2 py-1 text-gray-500 text-xs">
                                    +{group.timeSlots.length - 3}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 施設リスト（最初の3つ） */}
                            <div className="mb-3">
                              <div className="text-xs text-gray-600 mb-1">📍 施設</div>
                              <div className="space-y-1">
                                {group.targets.slice(0, 3).map((target) => (
                                  <div
                                    key={target.id}
                                    className="flex items-center gap-2 text-xs"
                                  >
                                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${target.status === 'active' ? 'bg-emerald-500' : 'bg-gray-400'
                                      }`} />
                                    <span className="text-gray-700 truncate">
                                      {getFacilityNameFromId(target.facilityId, target.facilityName)}
                                    </span>
                                  </div>
                                ))}
                                {group.targets.length > 3 && (
                                  <div className="text-xs text-gray-500 pl-3.5">
                                    他 {group.targets.length - 3}施設
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* 詳細ボタン */}
                            <button
                              onClick={() => {
                                setSelectedGroup({
                                  key: groupKey,
                                  site: group.targets[0].site,
                                  targets: group.targets,
                                  timeSlots: group.timeSlots,
                                  selectedWeekdays: group.selectedWeekdays,
                                  includeHolidays: group.includeHolidays,
                                  sites: group.sites,
                                });
                                setIsDetailModalOpen(true);
                              }}
                              className="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium"
                            >
                              詳細を見る
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* 詳細モーダル */}
      <MonitoringDetailModal
        selectedGroup={selectedGroup}
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedGroup(null);
        }}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPause={handlePause}
        onResume={handleResume}
        onBulkPause={handleBulkPause}
        onBulkResume={handleBulkResume}
        onBulkDelete={handleBulkDelete}
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

      {/* 一括操作進捗ダイアログ */}
      {bulkProgress.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {bulkProgress.action}...
            </h3>
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-600 mb-2">
                <span>進捗状況</span>
                <span className="font-semibold">
                  {bulkProgress.current} / {bulkProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                <div
                  className="bg-emerald-500 h-3 rounded-full transition-all duration-300"
                  style={{
                    width: `${(bulkProgress.current / bulkProgress.total) * 100}%`,
                  }}
                />
              </div>
            </div>
            <p className="text-sm text-gray-600 text-center">
              {bulkProgress.current === bulkProgress.total
                ? '完了しました。データを更新しています...'
                : 'しばらくお待ちください...'}
            </p>
          </div>
        </div>
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
