'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

interface MonitoringStatus {
  isActive: boolean;
  site: 'shinagawa' | 'minato';
  startedAt?: number;
  reservationStrategy: 'all' | 'priority';
  facilitiesCount: number;
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 設定フォーム
  const [config, setConfig] = useState({
    site: 'shinagawa' as 'shinagawa' | 'minato',
    reservationStrategy: 'priority' as 'all' | 'priority',
  });

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success && response.data && response.data.length > 0) {
        // 既存の監視がある場合はステータス表示
        const activeTargets = response.data.filter((t: { status: string }) => t.status === 'active');
        if (activeTargets.length > 0) {
          const firstTarget = activeTargets[0];
          setStatus({
            isActive: true,
            site: firstTarget.site,
            startedAt: firstTarget.createdAt,
            reservationStrategy: firstTarget.reservationStrategy,
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

      // 選択した自治体の施設一覧を取得
      const facilitiesResponse = config.site === 'shinagawa' 
        ? await apiClient.getShinagawaFacilities()
        : await apiClient.getMinatoFacilities();
        
      if (!facilitiesResponse.success || !facilitiesResponse.data) {
        setError('施設情報の取得に失敗しました');
        return;
      }

      const facilities = facilitiesResponse.data;
      if (facilities.length === 0) {
        setError('監視可能な施設が見つかりませんでした');
        return;
      }

      // 各施設に対して監視を作成
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const targetDate = tomorrow.toISOString().split('T')[0];

      // 全施設を並列で監視登録
      const promises = facilities.map((facility: { id: string; name: string }) =>
        apiClient.createMonitoring({
          site: config.site,
          facilityId: facility.id,
          facilityName: facility.name,
          date: targetDate,
          timeSlots: ['09:00-11:00', '11:00-13:00', '13:00-15:00', '15:00-17:00', '17:00-19:00', '19:00-21:00'],
          autoReserve: true,
          reservationStrategy: config.reservationStrategy,
        })
      );

      await Promise.all(promises);

      // ステータス更新
      setStatus({
        isActive: true,
        site: config.site,
        startedAt: Date.now(),
        reservationStrategy: config.reservationStrategy,
        facilitiesCount: facilities.length,
      });

      alert(`${facilities.length}施設の監視を開始しました`);
    } catch (err: any) {
      console.error('Start monitoring error:', err);
      
      // エラーメッセージを解析
      const errorMessage = err?.response?.data?.error || err?.message || '監視の開始に失敗しました';
      
      if (errorMessage.includes('credentials not found') || errorMessage.includes('Credentials not found')) {
        setError('❗️ 認証情報が未設定です。まず「設定」タブで品川区または港区の利用者ID・パスワードを保存してください。');
      } else {
        setError(`監視の開始に失敗: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('監視を停止しますか？')) return;

    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success && response.data) {
        // すべての監視を削除
        const deletePromises = response.data.map((target: { id: string }) =>
          apiClient.deleteMonitoring(target.id)
        );
        await Promise.all(deletePromises);
      }

      setStatus(null);
      alert('監視を停止しました');
    } catch (err) {
      console.error('Stop monitoring error:', err);
      setError('監視の停止に失敗しました');
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
            <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
              {status.site === 'shinagawa' ? '品川区' : '港区'}
            </span>
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
            {/* 自治体選択 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                自治体を選択
              </label>
              <select
                value={config.site}
                onChange={(e) => setConfig({ ...config, site: e.target.value as 'shinagawa' | 'minato' })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-gray-900 bg-white"
              >
                <option value="shinagawa">品川区（全テニスコート）</option>
                <option value="minato">港区（全テニスコート）</option>
              </select>
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
            <span>選択した自治体の全テニスコートを自動取得</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span>全時間帯（9:00-21:00）を毎分チェック</span>
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
