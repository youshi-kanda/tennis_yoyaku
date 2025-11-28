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
  facilitiesCount: number;
}

interface MonitoringTarget {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlots: string[];
  priority: number;
  status: 'monitoring' | 'detected' | 'reserved' | 'failed';
  createdAt: number;
  updatedAt: number;
  startDate?: string;
  endDate?: string;
  selectedWeekdays?: number[];
  includeHolidays?: boolean | 'only';
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monitoringTargets, setMonitoringTargets] = useState<MonitoringTarget[]>([]);
  
  // ウィザードステップ管理
  const [currentStep, setCurrentStep] = useState(1); // 1: 施設選択, 2: 日時設定, 3: 詳細設定
  const [showWizard, setShowWizard] = useState(false); // ウィザード表示フラグ

  // 時間帯の定義
  const TIME_SLOTS = [
    { id: '09:00-11:00', label: '09:00-11:00（午前早め）' },
    { id: '11:00-13:00', label: '11:00-13:00（午前遅め）' },
    { id: '13:00-15:00', label: '13:00-15:00（午後早め）' },
    { id: '15:00-17:00', label: '15:00-17:00（午後遅め）' },
    { id: '17:00-19:00', label: '17:00-19:00（夕方）' },
    { id: '19:00-21:00', label: '19:00-21:00（夜間）' },
  ];

  // 曜日の定義
  const WEEKDAYS = [
    { id: 0, label: '日', fullLabel: '日曜日' },
    { id: 1, label: '月', fullLabel: '月曜日' },
    { id: 2, label: '火', fullLabel: '火曜日' },
    { id: 3, label: '水', fullLabel: '水曜日' },
    { id: 4, label: '木', fullLabel: '木曜日' },
    { id: 5, label: '金', fullLabel: '金曜日' },
    { id: 6, label: '土', fullLabel: '土曜日' },
  ];

  // 施設リスト（ハードコードで初期表示、API取得で上書き）
  const [facilities, setFacilities] = useState<{
    shinagawa: Array<{ id: string; name: string; courts?: string; facilityIds?: string[] }>;
    minato: Array<{ id: string; name: string; courts?: string; facilityIds?: string[] }>;
  }>({
    shinagawa: [
      { id: 'shinagawa-chuo', name: 'しながわ中央公園', courts: 'A、B（2コート）' },
      { id: 'higashi-shinagawa', name: '東品川公園', courts: 'A（1コート）' },
      { id: 'shinagawa-kumin', name: 'しながわ区民公園', courts: 'A（1コート）' },
      { id: 'yashio-kita', name: '八潮北公園', courts: 'A（1コート）' },
    ],
    minato: [
      { id: 'azabu-a', name: '麻布運動公園', courts: 'A、B、C、D（4コート）' },
      { id: 'aoyama-ground-a', name: '青山運動場', courts: 'A、B、C、D（4コート）' },
      { id: 'aoyama-jhs-a', name: '青山中学校', courts: 'A、B、C、D（4コート）' },
      { id: 'takamatsu-jhs-a', name: '高松中学校', courts: 'A、B、C、D（4コート）' },
      { id: 'shibaura-chuo-a', name: '芝浦中央公園運動場', courts: 'A、B、C、D（4コート）' },
    ],
  });

  // 予約可能期間情報（初期値はnull、取得後に設定）
  const [reservationPeriods, setReservationPeriods] = useState<{
    shinagawa: { maxDaysAhead: number; source: string; displayText?: string } | null;
    minato: { maxDaysAhead: number; source: string; displayText?: string } | null;
  }>({
    shinagawa: null,
    minato: null,
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
    selectedWeekdays: [0, 1, 2, 3, 4, 5, 6] as number[], // 曜日指定（デフォルトは全曜日）
    includeHolidays: true as boolean | 'only', // 祝日の扱い（true=含める, false=除外, 'only'=祝日のみ）
    timeSlots: [] as string[], // 初期状態は未選択
  });

  useEffect(() => {
    loadStatus();
    loadFacilities();
    loadReservationPeriods();
  }, []);

  const loadReservationPeriods = async () => {
    try {
      console.log('[Monitoring] 予約可能期間の取得開始...');
      
      // 各地区の予約可能期間を取得
      const results = await Promise.allSettled([
        apiClient.getReservationPeriod('shinagawa'),
        apiClient.getReservationPeriod('minato'),
      ]);

      // デフォルト値から開始
      const periods: {
        shinagawa: { maxDaysAhead: number; source: string; displayText: string } | null;
        minato: { maxDaysAhead: number; source: string; displayText: string } | null;
      } = {
        shinagawa: null,
        minato: null,
      };

      // 品川区の処理
      if (results[0].status === 'fulfilled' && results[0].value?.success) {
        const data = results[0].value.data;
        periods.shinagawa = {
          maxDaysAhead: data.maxDaysAhead,
          source: data.source,
          displayText: `約${Math.floor(data.maxDaysAhead / 30)}ヶ月先まで（${data.maxDaysAhead}日）`,
        };
        console.log('[Monitoring] ✅ 品川区の予約可能期間を取得:', periods.shinagawa);
      } else {
        // 失敗時はデフォルト値
        periods.shinagawa = {
          maxDaysAhead: 90,
          source: 'default',
          displayText: '約3ヶ月先まで（90日）',
        };
        console.warn('[Monitoring] ⚠️ 品川区の予約可能期間取得失敗、デフォルト使用:', results[0]);
      }

      // 港区の処理
      if (results[1].status === 'fulfilled' && results[1].value?.success) {
        const data = results[1].value.data;
        periods.minato = {
          maxDaysAhead: data.maxDaysAhead,
          source: data.source,
          displayText: `約${Math.floor(data.maxDaysAhead / 30)}ヶ月先まで（${data.maxDaysAhead}日）`,
        };
        console.log('[Monitoring] ✅ 港区の予約可能期間を取得:', periods.minato);
      } else {
        // 失敗時はデフォルト値
        periods.minato = {
          maxDaysAhead: 90,
          source: 'default',
          displayText: '約3ヶ月先まで（90日）',
        };
        console.warn('[Monitoring] ⚠️ 港区の予約可能期間取得失敗、デフォルト使用:', results[1]);
      }

      setReservationPeriods(periods);
      console.log('[Monitoring] 📅 予約可能期間設定完了:', periods);
    } catch (err) {
      console.error('[Monitoring] ❌ 予約可能期間の取得でエラー発生:', err);
      // エラーでもデフォルト値を設定
      setReservationPeriods({
        shinagawa: { maxDaysAhead: 90, source: 'default', displayText: '約3ヶ月先まで（90日）' },
        minato: { maxDaysAhead: 90, source: 'default', displayText: '約3ヶ月先まで（90日）' },
      });
    }
  };

  // 施設をグループ化してコンパクト表示用のデータを生成
  const groupFacilitiesByBuilding = (facilities: Array<{ id: string; name: string; courts?: string }>) => {
    const grouped = new Map<string, { baseName: string; courts: string[]; ids: string[] }>();
    
    facilities.forEach(facility => {
      // 施設名から基本名とコート名を抽出（例: "しながわ中央公園 庭球場Ａ" → "しながわ中央公園", "Ａ"）
      const match = facility.name.match(/^(.+?)\s+(?:庭球場|テニスコート)\s*([A-ZＡ-Ｚa-zａ-ｚ０-９0-9]+)$/);
      
      if (match) {
        const [, baseName, courtName] = match;
        const existing = grouped.get(baseName);
        
        if (existing) {
          existing.courts.push(courtName);
          existing.ids.push(facility.id);
        } else {
          grouped.set(baseName, {
            baseName,
            courts: [courtName],
            ids: [facility.id],
          });
        }
      } else {
        // パターンにマッチしない場合はそのまま表示
        grouped.set(facility.id, {
          baseName: facility.name,
          courts: [],
          ids: [facility.id],
        });
      }
    });
    
    return Array.from(grouped.values()).map(group => ({
      id: group.ids.join(','), // 複数IDをカンマ区切りで保存
      name: group.courts.length > 0 
        ? `${group.baseName} 庭球場${group.courts.join('、')}`
        : group.baseName,
      facilityIds: group.ids, // 個別のIDを保持
    }));
  };

  const loadFacilities = async () => {
    try {
      const [shinagawaRes, minatoRes] = await Promise.all([
        apiClient.getShinagawaFacilities(),
        apiClient.getMinatoFacilities(),
      ]);

      // API取得成功時のみ上書き（データ構造を変換してグループ化）
      if (shinagawaRes.success && shinagawaRes.data?.length > 0) {
        const transformedData = shinagawaRes.data.map((f: { facilityId?: string; id?: string; facilityName?: string; name?: string; courts?: string }) => ({
          id: f.facilityId || f.id || '',
          name: f.facilityName || f.name || '',
          courts: f.courts,
        }));
        const groupedData = groupFacilitiesByBuilding(transformedData);
        setFacilities(prev => ({ ...prev, shinagawa: groupedData }));
      }
      if (minatoRes.success && minatoRes.data?.length > 0) {
        const transformedData = minatoRes.data.map((f: { facilityId?: string; id?: string; facilityName?: string; name?: string; courts?: string }) => ({
          id: f.facilityId || f.id || '',
          name: f.facilityName || f.name || '',
          courts: f.courts,
        }));
        const groupedData = groupFacilitiesByBuilding(transformedData);
        setFacilities(prev => ({ ...prev, minato: groupedData }));
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
      // エラー時はハードコードされた施設リストをそのまま使用
    }
  };

  const loadStatus = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success && response.data && response.data.length > 0) {
        // 既存の監視がある場合はステータス表示
        const activeTargets = response.data.filter((t: MonitoringTarget) => t.status === 'monitoring');
        setMonitoringTargets(activeTargets);
        
        if (activeTargets.length > 0) {
          const hasShinagawa = activeTargets.some((t: MonitoringTarget) => t.site === 'shinagawa');
          const hasMinato = activeTargets.some((t: MonitoringTarget) => t.site === 'minato');
          const oldestTarget = activeTargets.reduce((oldest: MonitoringTarget, current: MonitoringTarget) => 
            (oldest.createdAt < current.createdAt) ? oldest : current
          );
          
          setStatus({
            isActive: true,
            sites: {
              shinagawa: hasShinagawa,
              minato: hasMinato,
            },
            startedAt: oldestTarget.createdAt,
            facilitiesCount: activeTargets.length,
          });
        } else {
          setStatus(null);
        }
      } else {
        setMonitoringTargets([]);
        setStatus(null);
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

      // 選択された施設を並列で監視登録（Workers側でリトライ処理）
      const promises = config.selectedFacilities.map((facility) => {
        const monitoringData: {
          site: 'shinagawa' | 'minato';
          facilityId: string;
          facilityName: string;
          date?: string;
          startDate?: string;
          endDate?: string;
          dateMode?: 'single' | 'range' | 'continuous';
          timeSlots: string[];
          selectedWeekdays?: number[];
          includeHolidays?: boolean | 'only';
          autoReserve: boolean;
        } = {
          site: facility.site,
          facilityId: facility.id,
          facilityName: facility.name,
          timeSlots: config.timeSlots,
          selectedWeekdays: config.selectedWeekdays,
          autoReserve: true,
        };

        // 日付モードをバックエンドに送信
        monitoringData.dateMode = config.dateMode;

        // 日付モードに応じて設定
        if (config.dateMode === 'range') {
          // 期間指定
          monitoringData.startDate = config.startDate;
          monitoringData.endDate = config.endDate;
        } else if (config.dateMode === 'single') {
          // 単一日付
          monitoringData.date = config.startDate;
        } else {
          // 継続監視（バックエンドで動的に期間を設定）
          // フロントエンドでは何も設定しない（バックエンドが自動設定）
        }

        // 祝日設定を追加
        monitoringData.includeHolidays = config.includeHolidays;

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
        facilitiesCount: totalFacilities,
      });
      
      const siteNames = [];
      if (hasShinagawa) siteNames.push('品川区');
      if (hasMinato) siteNames.push('港区');
      
      // 監視リストを再ロード
      await loadStatus();
      
      // フォームをリセット
      setConfig({
        ...config,
        selectedFacilities: [],
        dateMode: 'range',
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
      });
      
      // ウィザードを閉じる
      setShowWizard(false);
      setCurrentStep(1);
      
      alert(`${siteNames.join('・')}の${totalFacilities}施設の監視を追加しました`);
      
    } catch (err) {
      const error = err as Error & { response?: { data?: { error?: string } } };
      console.error('Start monitoring error:', error);
      
      // エラーメッセージを解析
      const errorMessage = error?.response?.data?.error || error?.message || '監視の開始に失敗しました';
      
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
        const deletePromises = response.data.map((target: MonitoringTarget) => {
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
    } catch (err) {
      const error = err as Error & { response?: { data?: { error?: string } } };
      console.error('Stop monitoring error:', error);
      const errorMessage = error?.response?.data?.error || error?.message || '不明なエラー';
      setError(`監視の停止に失敗しました: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ウィザードナビゲーション関数
  const handleStartWizard = () => {
    setShowWizard(true);
    setCurrentStep(1);
    setError(null);
  };

  const handleCancelWizard = () => {
    if (confirm('設定をキャンセルしますか？入力内容は保持されます。')) {
      setShowWizard(false);
      setCurrentStep(1);
    }
  };

  const handleNextStep = () => {
    // バリデーション
    if (currentStep === 1) {
      if (config.selectedFacilities.length === 0) {
        setError('少なくとも1つの施設を選択してください');
        return;
      }
    } else if (currentStep === 2) {
      if (config.timeSlots.length === 0) {
        setError('少なくとも1つの時間帯を選択してください');
        return;
      }
    }
    
    setError(null);
    setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep(currentStep - 1);
  };

  const canProceedStep1 = config.selectedFacilities.length > 0;
  const canProceedStep2 = config.timeSlots.length > 0;

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
            {isLoading ? '停止中...' : 'すべての監視を停止'}
          </button>
        </div>
      ) : null}

      {/* 監視中のターゲット一覧 */}
      {monitoringTargets.length > 0 && (
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">監視中の設定（{monitoringTargets.length}件）</h3>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {monitoringTargets.map((target) => (
              <div key={target.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        target.site === 'shinagawa' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {target.site === 'shinagawa' ? '品川区' : '港区'}
                      </span>
                      <span className="font-semibold text-gray-900">{target.facilityName}</span>
                      {target.priority && (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-semibold">
                          優先度: {target.priority}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div>
                        📅 {target.startDate && target.endDate 
                          ? `${target.startDate} 〜 ${target.endDate}` 
                          : target.date || '継続監視'}
                      </div>
                      {target.timeSlots && target.timeSlots.length > 0 && (
                        <div>
                          🕐 {target.timeSlots.length === 6 ? '全時間帯' : `${target.timeSlots.length}時間帯`}
                        </div>
                      )}
                      {target.selectedWeekdays && target.selectedWeekdays.length > 0 && (
                        <div>
                          📆 {target.selectedWeekdays.length === 7 ? '毎日' : 
                            target.selectedWeekdays.map((d: number) => ['日','月','火','水','木','金','土'][d]).join(', ')}
                        </div>
                      )}
                      {target.includeHolidays !== undefined && (
                        <div>
                          🎌 {target.includeHolidays === 'only' ? '祝日のみ' : 
                              target.includeHolidays === true ? '祝日を含む' : '祝日を除外'}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={async () => {
                      if (confirm(`${target.facilityName}の監視を削除しますか？`)) {
                        try {
                          setIsLoading(true);
                          await apiClient.deleteMonitoring(target.id);
                          await loadStatus();
                          alert('監視を削除しました');
                        } catch (err) {
                          console.error('Delete monitoring error:', err);
                          setError('監視の削除に失敗しました');
                        } finally {
                          setIsLoading(false);
                        }
                      }
                    }}
                    disabled={isLoading}
                    className="px-3 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 監視追加フォーム */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        {!showWizard ? (
          // ウィザード開始画面
          <div className="text-center">
            <div className="text-6xl mb-4">🎾</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {monitoringTargets.length > 0 ? '新しい監視を追加' : '監視を開始しましょう'}
            </h2>
            <p className="text-gray-600 mb-6">
              {monitoringTargets.length > 0 
                ? '異なる条件で複数の監視を設定できます（例: 平日夜、土日全日）' 
                : '3つのステップで簡単に設定できます'}
            </p>
            <button
              onClick={handleStartWizard}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold text-lg"
            >
              {monitoringTargets.length > 0 ? '監視を追加する' : '監視設定を開始する'}
            </button>
          </div>
        ) : (
          // ウィザード表示（2カラムレイアウト）
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左側: ウィザードフォーム */}
            <div className="lg:col-span-2">
            {/* プログレスバー */}
            <div className="mb-8">
              <div className="flex items-center justify-center mb-4">
                <div className="text-sm font-medium text-gray-600">
                  ステップ {currentStep} / 3
                </div>
              </div>
              <div className="flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    currentStep >= 1 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    1
                  </div>
                  <span className={`text-sm font-medium ${currentStep >= 1 ? 'text-emerald-600' : 'text-gray-400'}`}>
                    施設選択
                  </span>
                </div>
                <div className={`h-0.5 w-16 ${currentStep >= 2 ? 'bg-emerald-600' : 'bg-gray-200'}`}></div>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    currentStep >= 2 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    2
                  </div>
                  <span className={`text-sm font-medium ${currentStep >= 2 ? 'text-emerald-600' : 'text-gray-400'}`}>
                    日時設定
                  </span>
                </div>
                <div className={`h-0.5 w-16 ${currentStep >= 3 ? 'bg-emerald-600' : 'bg-gray-200'}`}></div>
                <div className="flex items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    currentStep >= 3 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                  }`}>
                    3
                  </div>
                  <span className={`text-sm font-medium ${currentStep >= 3 ? 'text-emerald-600' : 'text-gray-400'}`}>
                    詳細設定
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-4 mb-6">
            {/* ステップ1: 施設選択 */}
            {currentStep === 1 && (
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">どの施設を監視しますか？</h3>
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
                                // facilityIdsがある場合は個別に追加
                                if (facility.facilityIds && facility.facilityIds.length > 1) {
                                  const newFacilities = facility.facilityIds.map(fid => ({
                                    site: 'shinagawa' as const,
                                    id: fid,
                                    name: facility.name,
                                  }));
                                  setConfig({
                                    ...config,
                                    selectedFacilities: [...config.selectedFacilities, ...newFacilities],
                                  });
                                } else {
                                  setConfig({
                                    ...config,
                                    selectedFacilities: [...config.selectedFacilities, {
                                      site: 'shinagawa',
                                      id: facility.facilityIds?.[0] || facility.id,
                                      name: facility.name,
                                    }],
                                  });
                                }
                              } else {
                                // facilityIdsに含まれる全てのIDを削除
                                const idsToRemove = facility.facilityIds || [facility.id];
                                setConfig({
                                  ...config,
                                  selectedFacilities: config.selectedFacilities.filter(
                                    f => !(f.site === 'shinagawa' && idsToRemove.includes(f.id))
                                  ),
                                });
                              }
                            }}
                            className="w-4 h-4 text-emerald-600 rounded focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{facility.name}</div>
                            {facility.courts && (
                              <div className="text-xs text-gray-500 mt-0.5">{facility.courts}</div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2 px-2">
                      ℹ️ 館を選択すると、その館の全コートを監視します
                    </p>
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
                                // facilityIdsがある場合は個別に追加
                                if (facility.facilityIds && facility.facilityIds.length > 1) {
                                  const newFacilities = facility.facilityIds.map(fid => ({
                                    site: 'minato' as const,
                                    id: fid,
                                    name: facility.name,
                                  }));
                                  setConfig({
                                    ...config,
                                    selectedFacilities: [...config.selectedFacilities, ...newFacilities],
                                  });
                                } else {
                                  setConfig({
                                    ...config,
                                    selectedFacilities: [...config.selectedFacilities, {
                                      site: 'minato',
                                      id: facility.facilityIds?.[0] || facility.id,
                                      name: facility.name,
                                    }],
                                  });
                                }
                              } else {
                                // facilityIdsに含まれる全てのIDを削除
                                const idsToRemove = facility.facilityIds || [facility.id];
                                setConfig({
                                  ...config,
                                  selectedFacilities: config.selectedFacilities.filter(
                                    f => !(f.site === 'minato' && idsToRemove.includes(f.id))
                                  ),
                                });
                              }
                            }}
                            className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{facility.name}</div>
                            {facility.courts && (
                              <div className="text-xs text-gray-500 mt-0.5">{facility.courts}</div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2 px-2">
                      ℹ️ 館を選択すると、その館の全コートを監視します
                    </p>
                  </div>
                )}
              </div>

              <p className="text-xs text-gray-600 mt-3">
                ※ 選択した{config.selectedFacilities.length}施設の全コートが監視対象になります。空きが見つかった際に自動予約されます。
              </p>

            {/* 予約可能期間の情報 */}
            {config.selectedFacilities.length > 0 && (
              <div className="p-3 bg-gradient-to-r from-emerald-50 to-blue-50 border border-emerald-200 rounded-lg">
                <p className="text-xs font-semibold text-gray-700 mb-2">📅 予約可能期間</p>
                <div className="space-y-1">
                  {config.selectedFacilities.some(f => f.site === 'shinagawa') && reservationPeriods.shinagawa && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-emerald-700 font-medium">品川区:</span>
                      <span className="text-gray-700">
                        {reservationPeriods.shinagawa.displayText}
                        <span className="ml-1 text-gray-500 text-[10px]">
                          ({reservationPeriods.shinagawa.source === 'html' ? 'HTML検出' : 
                            reservationPeriods.shinagawa.source === 'calendar' ? 'カレンダー検出' : 'デフォルト'})
                        </span>
                      </span>
                    </div>
                  )}
                  {config.selectedFacilities.some(f => f.site === 'minato') && reservationPeriods.minato && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-blue-700 font-medium">港区:</span>
                      <span className="text-gray-700">
                        {reservationPeriods.minato.displayText}
                        <span className="ml-1 text-gray-500 text-[10px]">
                          ({reservationPeriods.minato.source === 'html' ? 'HTML検出' : 
                            reservationPeriods.minato.source === 'calendar' ? 'カレンダー検出' : 'デフォルト'})
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
            </div>
            )}

            {/* ステップ2: 日時・時間帯設定 */}
            {currentStep === 2 && (
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">いつ予約したいですか？</h3>
            
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
                    min={(() => {
                      const tomorrow = new Date();
                      tomorrow.setDate(tomorrow.getDate() + 1);
                      return tomorrow.toISOString().split('T')[0];
                    })()}
                    max={(() => {
                      const maxDate = new Date();
                      const selectedSites = config.selectedFacilities.map(f => f.site);
                      const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                      const maxDays = Math.max(...periods, 90);
                      maxDate.setDate(maxDate.getDate() + maxDays);
                      return maxDate.toISOString().split('T')[0];
                    })()}
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
                      min={(() => {
                        const tomorrow = new Date();
                        tomorrow.setDate(tomorrow.getDate() + 1);
                        return tomorrow.toISOString().split('T')[0];
                      })()}
                      max={(() => {
                        const maxDate = new Date();
                        const selectedSites = config.selectedFacilities.map(f => f.site);
                        const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                        const maxDays = Math.max(...periods, 90);
                        maxDate.setDate(maxDate.getDate() + maxDays);
                        return maxDate.toISOString().split('T')[0];
                      })()}
                      onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-600 mb-1">終了日</label>
                    <input
                      type="date"
                      value={config.endDate}
                      min={config.startDate}
                      max={(() => {
                        const maxDate = new Date();
                        const selectedSites = config.selectedFacilities.map(f => f.site);
                        const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                        const maxDays = Math.max(...periods, 90);
                        maxDate.setDate(maxDate.getDate() + maxDays);
                        return maxDate.toISOString().split('T')[0];
                      })()}
                      onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    />
                  </div>
                </div>
              )}

              {config.dateMode === 'continuous' && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    ℹ️ 翌日から{(() => {
                      const selectedSites = config.selectedFacilities.map(f => f.site);
                      const periods = selectedSites.map(site => reservationPeriods[site]);
                      const validPeriods = periods.filter(p => p !== null);
                      if (validPeriods.length === 0) return '予約可能な期間';
                      const maxDays = Math.max(...validPeriods.map(p => p!.maxDaysAhead));
                      return `${Math.floor(maxDays / 30)}ヶ月先（${maxDays}日）`;
                    })()}まで継続的に監視します（停止するまで継続）
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
            </div>
            )}

            {/* ステップ3: 曜日・祝日設定 */}
            {currentStep === 3 && (
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-4">曜日を絞り込みますか？</h3>
            
            {/* 曜日指定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                監視する曜日（複数選択可）
              </label>
              
              {/* プリセットボタン */}
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, selectedWeekdays: [0, 1, 2, 3, 4, 5, 6] })}
                  className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                >
                  全て選択
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, selectedWeekdays: [1, 2, 3, 4, 5] })}
                  className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition"
                >
                  平日のみ
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, selectedWeekdays: [0, 6] })}
                  className="px-3 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition"
                >
                  週末のみ
                </button>
                <button
                  type="button"
                  onClick={() => setConfig({ ...config, selectedWeekdays: [] })}
                  className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                >
                  選択解除
                </button>
              </div>

              {/* 曜日チェックボックス */}
              <div className="grid grid-cols-7 gap-2">
                {WEEKDAYS.map((weekday) => (
                  <label
                    key={weekday.id}
                    className={`flex flex-col items-center justify-center p-3 border rounded-lg cursor-pointer transition ${
                      config.selectedWeekdays.includes(weekday.id)
                        ? 'bg-emerald-50 border-emerald-500 shadow-sm'
                        : 'border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={config.selectedWeekdays.includes(weekday.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setConfig({ ...config, selectedWeekdays: [...config.selectedWeekdays, weekday.id].sort() });
                        } else {
                          setConfig({ ...config, selectedWeekdays: config.selectedWeekdays.filter(d => d !== weekday.id) });
                        }
                      }}
                      className="sr-only"
                    />
                    <span className={`text-lg font-bold ${
                      config.selectedWeekdays.includes(weekday.id) ? 'text-emerald-600' : 'text-gray-600'
                    }`}>
                      {weekday.label}
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-600 mt-2">
                ※ 選択した曜日のみ監視します（{config.selectedWeekdays.length}曜日選択中）
              </p>
            </div>

            {/* 祝日設定 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                祝日の扱い
              </label>
              
              {/* プリセットボタン */}
              <div className="flex flex-wrap gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => {
                    setConfig({ 
                      ...config, 
                      selectedWeekdays: [1, 2, 3, 4, 5],
                      includeHolidays: false 
                    });
                  }}
                  className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition"
                >
                  平日のみ（祝日除く）
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfig({ 
                      ...config, 
                      selectedWeekdays: [0, 6],
                      includeHolidays: true 
                    });
                  }}
                  className="px-3 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition"
                >
                  週末＋祝日
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfig({ 
                      ...config, 
                      selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
                      includeHolidays: 'only' 
                    });
                  }}
                  className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition"
                >
                  祝日のみ
                </button>
              </div>

              {/* ラジオボタン */}
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                  <input
                    type="radio"
                    name="includeHolidays"
                    checked={config.includeHolidays === true}
                    onChange={() => setConfig({ ...config, includeHolidays: true })}
                    className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">祝日を含める</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      選択した曜日に加えて、祝日も監視します（例: 平日+祝日、週末+祝日）
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                  <input
                    type="radio"
                    name="includeHolidays"
                    checked={config.includeHolidays === false}
                    onChange={() => setConfig({ ...config, includeHolidays: false })}
                    className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">祝日を除外</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      祝日は監視しません（例: 平日のみ、週末のみ）
                    </div>
                  </div>
                </label>

                <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                  <input
                    type="radio"
                    name="includeHolidays"
                    checked={config.includeHolidays === 'only'}
                    onChange={() => setConfig({ ...config, includeHolidays: 'only' })}
                    className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">祝日のみ</div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      祝日だけを監視します（曜日設定は無視されます）
                    </div>
                  </div>
                </label>
              </div>

              <p className="text-xs text-gray-600 mt-2">
                ℹ️ 日本の国民の祝日（振替休日・国民の休日を含む）を自動判定します
              </p>
            </div>
            </div>
            )}
          </div>

        {/* ナビゲーションボタン */}
        <div className="flex items-center justify-between gap-4 mt-6">
          {currentStep > 1 ? (
            <button
              onClick={handlePrevStep}
              className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-semibold"
            >
              ← 戻る
            </button>
          ) : (
            <button
              onClick={handleCancelWizard}
              className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-semibold"
            >
              キャンセル
            </button>
          )}
          
          {currentStep < 3 ? (
            <button
              onClick={handleNextStep}
              disabled={currentStep === 1 && !canProceedStep1 || currentStep === 2 && !canProceedStep2}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              次へ →
            </button>
          ) : (
            <button
              onClick={handleStart}
              disabled={isLoading}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                  設定中...
                </>
              ) : (
                <>
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  監視を開始
                </>
              )}
            </button>
          )}
        </div>
            </div>

            {/* 右側: 設定プレビュー */}
            <div className="lg:col-span-1">
              <div className="sticky top-4 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl p-6 border-2 border-emerald-200 shadow-lg">
                <h3 className="text-lg font-bold text-emerald-900 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  設定プレビュー
                </h3>

                <div className="space-y-4">
                  {/* 施設選択状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">施設選択</span>
                      {config.selectedFacilities.length > 0 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {config.selectedFacilities.length > 0 ? (
                      <div className="bg-white rounded-lg p-3 text-sm">
                        <div className="font-medium text-emerald-700 mb-1">
                          {config.selectedFacilities.length}施設を監視
                        </div>
                        <div className="text-xs text-gray-600 space-y-1 max-h-32 overflow-y-auto">
                          {config.selectedFacilities.slice(0, 3).map((f, i) => (
                            <div key={i}>• {f.name}</div>
                          ))}
                          {config.selectedFacilities.length > 3 && (
                            <div className="text-gray-500">...他{config.selectedFacilities.length - 3}施設</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        施設を選択してください
                      </div>
                    )}
                  </div>

                  {/* 日時設定状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">日時設定</span>
                      {currentStep >= 2 && config.timeSlots.length > 0 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {currentStep >= 2 && config.dateMode && config.timeSlots.length > 0 ? (
                      <div className="bg-white rounded-lg p-3 text-sm space-y-2">
                        <div>
                          <span className="text-gray-600">期間:</span>
                          <span className="ml-2 font-medium text-gray-800">
                            {config.dateMode === 'single' && '特定日'}
                            {config.dateMode === 'range' && '期間指定'}
                            {config.dateMode === 'continuous' && '毎週曜日'}
                          </span>
                        </div>
                        {config.dateMode === 'single' && config.startDate && (
                          <div className="text-xs text-gray-600">
                            {config.startDate}
                          </div>
                        )}
                        {config.dateMode === 'range' && config.startDate && config.endDate && (
                          <div className="text-xs text-gray-600">
                            {config.startDate} 〜 {config.endDate}
                          </div>
                        )}
                        <div>
                          <span className="text-gray-600">時間帯:</span>
                          <span className="ml-2 font-medium text-gray-800">
                            {config.timeSlots.length}枠
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        日時と時間帯を設定してください
                      </div>
                    )}
                  </div>

                  {/* 詳細設定状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">詳細設定</span>
                      {currentStep >= 3 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {currentStep >= 3 && config.dateMode === 'continuous' ? (
                      <div className="bg-white rounded-lg p-3 text-sm space-y-2">
                        {config.selectedWeekdays && config.selectedWeekdays.length > 0 ? (
                          <div>
                            <span className="text-gray-600">曜日:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.selectedWeekdays.length === 7 ? '毎日' :
                                config.selectedWeekdays.map(d => ['日','月','火','水','木','金','土'][d]).join(', ')}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">曜日未設定</div>
                        )}
                        {config.includeHolidays !== undefined ? (
                          <div>
                            <span className="text-gray-600">祝日:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.includeHolidays === 'only' ? '祝日のみ' :
                                config.includeHolidays === true ? '含む' : '除外'}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">祝日設定未設定</div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        毎週曜日モードでは曜日・祝日設定が必要です
                      </div>
                    )}
                  </div>
                </div>

                {/* 設定完了メッセージ */}
                {canProceedStep1 && canProceedStep2 && currentStep === 3 && (
                  <div className="mt-4 p-3 bg-emerald-100 border border-emerald-300 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-emerald-800 font-medium">
                      <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      設定完了！監視を開始できます
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 説明セクション */}
      <div className="bg-blue-50 rounded-lg p-6 mb-6">
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
