'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

interface MonitoringTarget {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'active' | 'pending' | 'completed' | 'failed';
  autoReserve: boolean;
  createdAt: number;
}

export default function MonitoringPage() {
  const [targets, setTargets] = useState<MonitoringTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 新規監視フォーム
  const [formData, setFormData] = useState({
    site: 'shinagawa' as 'shinagawa' | 'minato',
    facilityId: '',
    facilityName: '',
    date: '',
    timeSlot: '',
    autoReserve: false,
  });

  useEffect(() => {
    loadTargets();
  }, []);

  const loadTargets = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success) {
        setTargets(response.data || []);
      }
    } catch (err: any) {
      console.error('Failed to load targets:', err);
      setError('監視リストの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddTarget = async () => {
    if (!formData.facilityName || !formData.date || !formData.timeSlot) {
      setError('すべての項目を入力してください');
      return;
    }

    try {
      const response = await apiClient.createMonitoring({
        site: formData.site,
        facilityId: formData.facilityId || crypto.randomUUID(),
        facilityName: formData.facilityName,
        date: formData.date,
        timeSlot: formData.timeSlot,
        autoReserve: formData.autoReserve,
      });

      if (response.success) {
        setShowAddModal(false);
        setFormData({
          site: 'shinagawa',
          facilityId: '',
          facilityName: '',
          date: '',
          timeSlot: '',
          autoReserve: false,
        });
        loadTargets();
      }
    } catch (err: any) {
      setError('監視の追加に失敗しました');
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      active: 'bg-green-100 text-green-800',
      pending: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-blue-100 text-blue-800',
      failed: 'bg-red-100 text-red-800',
    };
    const labels = {
      active: '監視中',
      pending: '待機中',
      completed: '完了',
      failed: '失敗',
    };
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[status as keyof typeof styles]}`}>
        {labels[status as keyof typeof labels]}
      </span>
    );
  };

  const getSiteLabel = (site: string) => {
    return site === 'shinagawa' ? '品川区' : '港区';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">監視設定</h1>
          <p className="text-sm text-gray-600 mt-1">
            予約したい施設と日時を設定して監視を開始
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition flex items-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          監視を追加
        </button>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* 監視リスト */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          <p className="text-gray-600 mt-2">読み込み中...</p>
        </div>
      ) : targets.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">🎾</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">監視設定がありません</h3>
          <p className="text-gray-600 mb-4">「監視を追加」ボタンから新しい監視を設定してください</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {targets.map((target) => (
            <div key={target.id} className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
                      {getSiteLabel(target.site)}
                    </span>
                    {getStatusBadge(target.status)}
                    {target.autoReserve && (
                      <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-semibold">
                        自動予約ON
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 mb-1">{target.facilityName}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {target.date}
                    </div>
                    <div className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      {target.timeSlot}
                    </div>
                  </div>
                </div>
                <button className="text-gray-400 hover:text-red-600 transition">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 追加モーダル */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">監視を追加</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* 自治体選択 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    自治体
                  </label>
                  <select
                    value={formData.site}
                    onChange={(e) => setFormData({ ...formData, site: e.target.value as 'shinagawa' | 'minato' })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  >
                    <option value="shinagawa">品川区</option>
                    <option value="minato">港区</option>
                  </select>
                </div>

                {/* 施設名 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    施設名
                  </label>
                  <input
                    type="text"
                    value={formData.facilityName}
                    onChange={(e) => setFormData({ ...formData, facilityName: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="例: 東品川公園テニスコート"
                  />
                </div>

                {/* 日付 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    予約希望日
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>

                {/* 時間帯 */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    時間帯
                  </label>
                  <input
                    type="text"
                    value={formData.timeSlot}
                    onChange={(e) => setFormData({ ...formData, timeSlot: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    placeholder="例: 09:00-11:00"
                  />
                </div>

                {/* 自動予約 */}
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoReserve"
                    checked={formData.autoReserve}
                    onChange={(e) => setFormData({ ...formData, autoReserve: e.target.checked })}
                    className="w-4 h-4 text-emerald-600 border-gray-300 rounded focus:ring-emerald-500"
                  />
                  <label htmlFor="autoReserve" className="ml-2 text-sm text-gray-700">
                    空きが見つかったら自動で予約する
                  </label>
                </div>

                {/* ボタン */}
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleAddTarget}
                    className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition"
                  >
                    追加
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
