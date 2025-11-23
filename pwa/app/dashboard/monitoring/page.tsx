'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

// 動的レンダリングを強制
export const dynamic = 'force-dynamic';

interface MonitoringStatus {
  isActive: boolean;
  sites: {
    shinagawa: boolean;
    minato: boolean;
  };
  startedAt?: number;
  reservationStrategy: 'all' | 'priority';
  facilitiesCount: number;
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 時間帯の定義
  const TIME_SLOTS = [
    { id: '09:00-11:00', label: '09:00-11:00（午前早め）' },
    { id: '11:00-13:00', label: '11:00-13:00（午前遅め）' },
    { id: '13:00-15:00', label: '13:00-15:00（午後早め）' },
    { id: '15:00-17:00', label: '15:00-17:00（午後遅め）' },
    { id: '17:00-19:00', label: '17:00-19:00（夕方）' },
    { id: '19:00-21:00', label: '19:00-21:00（夜間）' },
  ];

  // 施設リスト
  const [facilities, setFacilities] = useState<{
    shinagawa: Array<{ id: string; name: string }>;
    minato: Array<{ id: string; name: string }>;
  }>({
    shinagawa: [],
    minato: [],
  });

  // 設定フォーム
  const [config, setConfig] = useState({
    sites: {
      shinagawa: true,
      minato: false,
    },
    selectedFacilities: [] as Array<{ site: 'shinagawa' | 'minato'; id: string; name: string }>,
    dateMode: 'range' as 'single' | 'range' | 'continuous', // 日付指定モード
    startDate: (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    })(),
    endDate: (() => {
      const weekLater = new Date();
      weekLater.setDate(weekLater.getDate() + 8);
      return weekLater.toISOString().split('T')[0];
    })(),
    priority: 3, // 優先度（1-5、5が最優先）デフォルトは3
    reservationStrategy: 'priority' as 'all' | 'priority',
    timeSlots: TIME_SLOTS.map(t => t.id), // デフォルトは全時間帯
  });

  useEffect(() => {
    loadStatus();
    loadFacilities();
  }, []);

  const loadFacilities = async () => {
    try {
      const [shinagawaRes, minatoRes] = await Promise.all([
        apiClient.getShinagawaFacilities(),
        apiClient.getMinatoFacilities(),
      ]);

      setFacilities({
        shinagawa: shinagawaRes.success ? shinagawaRes.data : [],
        minato: minatoRes.success ? minatoRes.data : [],
      });
    } catch (err) {
      console.error('Failed to load facilities:', err);
    }
  };

  const loadStatus = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success && response.data && response.data.length > 0) {
        // 既存の監視がある場合はステータス表示
        const activeTargets = response.data.filter((t: { status: string }) => t.status === 'active');
        if (activeTargets.length > 0) {
          const hasShinagawa = activeTargets.some((t: { site: string }) => t.site === 'shinagawa');
          const hasMinato = activeTargets.some((t: { site: string }) => t.site === 'minato');
          const oldestTarget = activeTargets.reduce((oldest: any, current: any) => 
            (oldest.createdAt < current.createdAt) ? oldest : current
          );
          
          setStatus({
            isActive: true,
            sites: {
              shinagawa: hasShinagawa,
              minato: hasMinato,
            },
            startedAt: oldestTarget.createdAt,
            reservationStrategy: oldestTarget.reservationStrategy,
            facilitiesCount: activeTargets.length,
          });
        }
      }
    } catch (err) {
      console.error('Failed to load status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStart = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (config.selectedFacilities.length === 0) {
        setError('少なくとも1つの施設を選択してください');
        return;
      }

      if (config.timeSlots.length === 0) {
        setError('少なくとも1つの時間帯を選択してください');
        return;
      }

      // 選択された施設を並列で監視登録
      const promises = config.selectedFacilities.map((facility) => {
        const monitoringData: {
          site: 'shinagawa' | 'minato';
          facilityId: string;
          facilityName: string;
          date?: string;
          startDate?: string;
          endDate?: string;
          timeSlots: string[];
          priority?: number;
          autoReserve: boolean;
          reservationStrategy: 'all' | 'priority';
        } = {
          site: facility.site,
          facilityId: facility.id,
          facilityName: facility.name,
          timeSlots: config.timeSlots,
          autoReserve: true,
          reservationStrategy: config.reservationStrategy,
        };

        // 日付モードに応じて設定
        if (config.dateMode === 'range') {
          // 期間指定
          monitoringData.startDate = config.startDate;
          monitoringData.endDate = config.endDate;
        } else if (config.dateMode === 'single') {
          // 単一日付
          monitoringData.date = config.startDate;
        } else {
          // 継続監視（翌日から長期間）
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const farFuture = new Date();
          farFuture.setDate(farFuture.getDate() + 365); // 1年先まで
          monitoringData.startDate = tomorrow.toISOString().split('T')[0];
          monitoringData.endDate = farFuture.toISOString().split('T')[0];
        }

        // 優先度を設定
        monitoringData.priority = config.priority;

        return apiClient.createMonitoring(monitoringData);
      });

      await Promise.all(promises);
      const totalFacilities = config.selectedFacilities.length;

      // ステータス更新
      const hasShinagawa = config.selectedFacilities.some(f => f.site === 'shinagawa');
      const hasMinato = config.selectedFacilities.some(f => f.site === 'minato');

      setStatus({
        isActive: true,
        sites: {
          shinagawa: hasShinagawa,
          minato: hasMinato,
        },
        startedAt: Date.now(),
        reservationStrategy: config.reservationStrategy,
        facilitiesCount: totalFacilities,
      });

      const siteNames = [];
      if (hasShinagawa) siteNames.push('品川区');
      if (hasMinato) siteNames.push('港区');
      alert(`${siteNames.join('・')}の${totalFacilities}施設の監視を開始しました`);
      
    } catch (err: any) {
      console.error('Start monitoring error:', err);
      
      // エラーメッセージを解析
      const errorMessage = err?.response?.data?.error || err?.message || '監視の開始に失敗しました';
      
      if (errorMessage.includes('credentials not found') || errorMessage.includes('Credentials not found')) {
        setError('❗️ 認証情報が未設定です。まず「設定」タブで選択した地区の利用者ID・パスワードを保存してください。');
      } else {
        setError(`監視の開始に失敗: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('すべての監視を停止しますか？\n\n停止すると、設定されている全ての監視対象が削除されます。')) return;

    try {
      setIsLoading(true);
      setError(null);
      
      console.log('[Stop] Fetching monitoring list...');
      const response = await apiClient.getMonitoringList();
      console.log('[Stop] Response:', response);
      
      if (response.success && response.data && response.data.length > 0) {
        console.log(`[Stop] Found ${response.data.length} monitoring targets`);
        
        // すべての監視を削除
        const deletePromises = response.data.map((target: { id: string }) => {
          console.log(`[Stop] Deleting target: ${target.id}`);
          return apiClient.deleteMonitoring(target.id);
        });
        
        const results = await Promise.all(deletePromises);
        console.log('[Stop] Delete results:', results);
        
        setStatus(null);
        alert('監視を停止しました');
        
        // 念のため再読み込み
        await loadStatus();
      } else {
        console.log('[Stop] No monitoring targets found');
        setStatus(null);
        alert('停止する監視が見つかりませんでした');
      }
    } catch (err: any) {
      console.error('Stop monitoring error:', err);
      const errorMessage = err?.response?.data?.error || err?.message || '不明なエラー';
      setError(`監視の停止に失敗しました: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">自動監視・予約</h1>
        <p className="text-sm text-gray-600 mt-1">
          全施設を一括監視して空き枠を自動予約します
        </p>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-600 underline mt-1">
            閉じる
          </button>
        </div>
      )}

      {/* ステータスカード */}
      {status?.isActive ? (
        <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-emerald-500 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <h2 className="text-xl font-bold text-gray-900">監視中</h2>
            </div>
            <div className="flex gap-2">
              {status.sites.shinagawa && (
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
                  品川区
                </span>
              )}
              {status.sites.minato && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                  港区
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-1">監視施設数</p>
              <p className="text-2xl font-bold text-gray-900">{status.facilitiesCount}</p>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-1">予約戦略</p>
              <p className="text-sm font-bold text-gray-900">
                {status.reservationStrategy === 'all' ? '全件予約' : '優先1枠'}
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
            <span>
              開始時刻: {status.startedAt ? new Date(status.startedAt).toLocaleString('ja-JP') : '-'}
            </span>
          </div>

          <div className="mb-3 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              ℹ️ 継続的に翌日以降の空き枠を監視します。監視を終了する場合は下のボタンを押してください。
            </p>
          </div>

          <button
            onClick={handleStop}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? '停止中...' : '監視を停止'}
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">🎾</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">監視を開始しましょう</h2>
            <p className="text-gray-600">
              下記の設定で全施設の空き枠を自動監視・予約します
            </p>
          </div>

          <div className="space-y-4 mb-6">
            {/* 施設選択（複数選択可） */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                監視する施設（複数選択可）
              </label>

              {/* 地区別に施設を表示 */}
              <div className="space-y-4">
                {/* 品川区 */}
                {facilities.shinagawa.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-emerald-700">品川区</h3>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const shinagawaFacilities = facilities.shinagawa.map(f => ({
                              site: 'shinagawa' as const,
                              id: f.id,
                              name: f.name,
                            }));
                            const otherFacilities = config.selectedFacilities.filter(f => f.site !== 'shinagawa');
                            setConfig({ ...config, selectedFacilities: [...otherFacilities, ...shinagawaFacilities] });
                          }}
                          className="text-xs px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded transition"
                        >
                          全選択
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const otherFacilities = config.selectedFacilities.filter(f => f.site !== 'shinagawa');
                            setConfig({ ...config, selectedFacilities: otherFacilities });
                          }}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition"
                        >
                          解除
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                      {facilities.shinagawa.map((facility) => (
                        <label
                          key={facility.id}
                          className="flex items-center gap-2 p-2 hover:bg-emerald-50 rounded cursor-pointer transition"
                        >
                          <input
                            type="checkbox"
                            checked={config.selectedFacilities.some(f => f.site === 'shinagawa' && f.id === facility.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({
                                  ...config,
                                  selectedFacilities: [...config.selectedFacilities, {
                                    site: 'shinagawa',
                                    id: facility.id,
                                    name: facility.name,
                                  }],
                                });
                              } else {
                                setConfig({
                                  ...config,
                                  selectedFacilities: config.selectedFacilities.filter(
                                    f => !(f.site === 'shinagawa' && f.id === facility.id)
                                  ),
                                });
                              }
                            }}
                            className="w-4 h-4 text-emerald-600 rounded focus:ring-2 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-gray-900">{facility.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {/* 港区 */}
                {facilities.minato.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold text-blue-700">港区</h3>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const minatoFacilities = facilities.minato.map(f => ({
                              site: 'minato' as const,
                              id: f.id,
                              name: f.name,
                            }));
                            const otherFacilities = config.selectedFacilities.filter(f => f.site !== 'minato');
                            setConfig({ ...config, selectedFacilities: [...otherFacilities, ...minatoFacilities] });
                          }}
                          className="text-xs px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded transition"
                        >
                          全選択
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const otherFacilities = config.selectedFacilities.filter(f => f.site !== 'minato');
                            setConfig({ ...config, selectedFacilities: otherFacilities });
                          }}
                          className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded transition"
                        >
                          解除
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                      {facilities.minato.map((facility) => (
                        <label
                          key={facility.id}
                          className="flex items-center gap-2 p-2 hover:bg-blue-50 rounded cursor-pointer transition"
                        >
                          <input
                            type="checkbox"
                            checked={config.selectedFacilities.some(f => f.site === 'minato' && f.id === facility.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setConfig({
                                  ...config,
                                  selectedFacilities: [...config.selectedFacilities, {
                                    site: 'minato',
                                    id: facility.id,
                                    name: facility.name,
                                  }],
                                });
                              } else {
                                setConfig({
                                  ...config,
                                  selectedFacilities: config.selectedFacilities.filter(
                                    f => !(f.site === 'minato' && f.id === facility.id)
                                  ),
                                });
                              }
                            }}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-sm text-gray-900">{facility.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-600 mt-2">
                ※ 選択した施設のみ監視します（{config.selectedFacilities.length}施設選択中）
              </p>
            </div>

            {/* 監視期間の設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                監視期間
              </label>
              
              {/* 期間モード選択 */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, dateMode: 'single' })}
                  className={`px-3 py-2 text-sm rounded-lg transition ${
                    config.dateMode === 'single'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  単一日付
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, dateMode: 'range' })}
                  className={`px-3 py-2 text-sm rounded-lg transition ${
                    config.dateMode === 'range'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  期間指定
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, dateMode: 'continuous' })}
                  className={`px-3 py-2 text-sm rounded-lg transition ${
                    config.dateMode === 'continuous'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  継続監視
                </button>
              </div>

              {/* 日付入力 */}
              {config.dateMode === 'single' && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">監視日</label>
                  <input
                    type="date"
                    value={config.startDate}
                    onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              )}

              {config.dateMode === 'range' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">開始日</label>
                    <input
                      type="date"
                      value={config.startDate}
                      onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">終了日</label>
                    <input
                      type="date"
                      value={config.endDate}
                      onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {config.dateMode === 'continuous' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    ℹ️ 翌日から1年先まで継続的に監視します（停止するまで継続）
                  </p>
                </div>
              )}

              <p className="text-xs text-gray-600 mt-2">
                {config.dateMode === 'single' && '※ 指定した1日のみ監視します'}
                {config.dateMode === 'range' && '※ 指定した期間内の全日程を監視します'}
                {config.dateMode === 'continuous' && '※ 長期間の自動監視に最適です'}
              </p>
            </div>

            {/* 監視する時間帯（複数選択可） */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                監視する時間帯（複数選択可）
              </label>
              
              {/* プリセットボタン */}
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, timeSlots: TIME_SLOTS.map(t => t.id) })}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                >
                  全て選択
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, timeSlots: ['09:00-11:00', '11:00-13:00'] })}
                  className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition"
                >
                  朝（9-13時）
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, timeSlots: ['13:00-15:00', '15:00-17:00'] })}
                  className="px-3 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition"
                >
                  昼（13-17時）
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, timeSlots: ['17:00-19:00', '19:00-21:00'] })}
                  className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition"
                >
                  夕方〜夜（17-21時）
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, timeSlots: [] })}
                  className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                >
                  選択解除
                </button>
              </div>

              {/* チェックボックス */}
              <div className="grid grid-cols-2 gap-2">
                {TIME_SLOTS.map((slot) => (
                  <label
                    key={slot.id}
                    className="flex items-center gap-2 p-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                  >
                    <input
                      type="checkbox"
                      checked={config.timeSlots.includes(slot.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setConfig({ ...config, timeSlots: [...config.timeSlots, slot.id] });
                        } else {
                          setConfig({ ...config, timeSlots: config.timeSlots.filter(t => t !== slot.id) });
                        }
                      }}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-2 focus:ring-emerald-500"
                    />
                    <span className="text-sm text-gray-900">{slot.label}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-2">
                ※ 選択した時間帯のみ監視します（{config.timeSlots.length}個選択中）
              </p>
            </div>

            {/* 優先度設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                優先度レベル
              </label>
              
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={config.priority}
                  onChange={(e) => setConfig({ ...config, priority: parseInt(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #10b981 0%, #10b981 ${(config.priority - 1) * 25}%, #e5e7eb ${(config.priority - 1) * 25}%, #e5e7eb 100%)`
                  }}
                />
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-emerald-600">{config.priority}</span>
                  <span className="text-sm text-gray-600">/ 5</span>
                </div>
              </div>

              <div className="mt-2 flex justify-between text-xs text-gray-600">
                <span>低</span>
                <span className="font-medium">
                  {config.priority === 1 && '🔵 低優先度'}
                  {config.priority === 2 && '🟢 やや低'}
                  {config.priority === 3 && '🟡 普通'}
                  {config.priority === 4 && '🟠 やや高'}
                  {config.priority === 5 && '🔴 最優先'}
                </span>
                <span>高</span>
              </div>

              <p className="text-xs text-gray-600 mt-2">
                ℹ️ 複数の空き枠が見つかった場合、優先度が高い監視から順に予約されます。重要な予定は優先度を上げておくと確実です。
              </p>
            </div>

            {/* 予約戦略 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                予約戦略
              </label>
              <select
                value={config.reservationStrategy}
                onChange={(e) => setConfig({ ...config, reservationStrategy: e.target.value as 'all' | 'priority' })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
              >
                <option value="priority">優先順位予約（1枠確実確保）</option>
                <option value="all">全件予約（空き枠すべて）</option>
              </select>
              <p className="text-xs text-gray-600 mt-2">
                {config.reservationStrategy === 'priority'
                  ? '時間帯の優先順位に従って1枠ずつ予約を試み、成功したら次の施設へ（確実性重視）'
                  : '空いている枠をすべて同時に予約します（複数枠確保優先）'}
              </p>
            </div>
          </div>

          <button
            onClick={handleStart}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                施設情報を取得中...
              </>
            ) : (
              <>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                全施設の監視を開始
              </>
            )}
          </button>
        </div>
      )}

      {/* 説明セクション */}
      <div className="bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">自動監視の仕組み</h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>施設個別選択:</strong> 監視したい施設を自由に選択可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>柔軟な期間設定:</strong> 単一日付・期間指定・継続監視から選択可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>複数地区対応:</strong> 品川区と港区の両方を同時に監視可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>時間帯カスタマイズ:</strong> 監視する時間帯を自由に選択可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>優先度設定:</strong> 重要度に応じて1-5の優先度レベルを設定</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span>選択した時間帯を毎分チェック、優先度順に予約処理</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span>「取」ステータス（抽選中）は10分ごとに集中監視（2秒間隔×3回）</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span>空き枠を検知したら即座に自動予約</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span>平日は19:00-21:00のみ、週末・祝日は全時間帯を監視</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
