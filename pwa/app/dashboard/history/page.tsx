'use client';

import { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

interface ReservationHistory {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed' | 'cancelled';
  createdAt: number;
  message?: string;
}

export default function HistoryPage() {
  const [history, setHistory] = useState<ReservationHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedMonth, setSelectedMonth] = useState(new Date());

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getReservationHistory();
      if (response.success) {
        setHistory(response.data || []);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredHistory = history.filter((item) => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  const getStatusBadge = (status: string) => {
    const styles = {
      success: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-100 text-gray-800',
    };
    const labels = {
      success: '予約成功',
      failed: '予約失敗',
      cancelled: 'キャンセル',
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

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString('ja-JP');
  };

  // カレンダー用のデータ生成
  const getCalendarData = () => {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay();

    const calendar: Array<{ date: number; reservations: ReservationHistory[] }> = [];
    
    // 空白を埋める
    for (let i = 0; i < startDayOfWeek; i++) {
      calendar.push({ date: 0, reservations: [] });
    }

    // 日付と予約を紐付け
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dayReservations = filteredHistory.filter(h => h.date === dateStr);
      calendar.push({ date: day, reservations: dayReservations });
    }

    return calendar;
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">予約履歴</h1>
          <p className="text-sm text-gray-600 mt-1">
            過去の予約履歴を確認できます
          </p>
        </div>
        
        {/* 表示モード切り替え */}
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('list')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              viewMode === 'list'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            📋 リスト
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-4 py-2 rounded-lg font-medium transition ${
              viewMode === 'calendar'
                ? 'bg-emerald-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            📅 カレンダー
          </button>
        </div>
      </div>

      {/* フィルター */}
      <div className="mb-6 flex gap-2">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            filter === 'all'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          すべて
        </button>
        <button
          onClick={() => setFilter('success')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            filter === 'success'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          成功
        </button>
        <button
          onClick={() => setFilter('failed')}
          className={`px-4 py-2 rounded-lg font-medium transition ${
            filter === 'failed'
              ? 'bg-emerald-600 text-white'
              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
          }`}
        >
          失敗
        </button>
      </div>

      {/* カレンダー表示 */}
      {viewMode === 'calendar' && !isLoading && (
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          {/* 月切り替え */}
          <div className="flex items-center justify-between mb-6">
            <button
              onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1))}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              ← 前月
            </button>
            <h2 className="text-xl font-bold text-gray-900">
              {selectedMonth.getFullYear()}年 {selectedMonth.getMonth() + 1}月
            </h2>
            <button
              onClick={() => setSelectedMonth(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1))}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
            >
              次月 →
            </button>
          </div>

          {/* 曜日ヘッダー */}
          <div className="grid grid-cols-7 gap-2 mb-2">
            {['日', '月', '火', '水', '木', '金', '土'].map((day, i) => (
              <div key={i} className={`text-center font-bold text-sm py-2 ${i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : 'text-gray-700'}`}>
                {day}
              </div>
            ))}
          </div>

          {/* カレンダーグリッド */}
          <div className="grid grid-cols-7 gap-2">
            {getCalendarData().map((day, index) => (
              <div
                key={index}
                className={`min-h-[80px] p-2 rounded-lg border ${
                  day.date === 0
                    ? 'bg-gray-50'
                    : day.reservations.length > 0
                    ? 'bg-emerald-50 border-emerald-300'
                    : 'bg-white border-gray-200'
                }`}
              >
                {day.date > 0 && (
                  <>
                    <div className="text-sm font-semibold text-gray-900 mb-1">{day.date}</div>
                    {day.reservations.length > 0 && (
                      <div className="space-y-1">
                        {day.reservations.map((res) => (
                          <div
                            key={res.id}
                            className={`text-xs px-1 py-0.5 rounded ${
                              res.status === 'success'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                            title={`${res.facilityName} ${res.timeSlot}`}
                          >
                            {res.status === 'success' ? '✓' : '✗'} {res.timeSlot.substring(0, 5)}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-emerald-50 border border-emerald-300 rounded"></div>
              <span>予約あり</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-green-100 rounded"></div>
              <span>成功</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-100 rounded"></div>
              <span>失敗</span>
            </div>
          </div>
        </div>
      )}

      {/* 履歴リスト */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          <p className="text-gray-600 mt-2">読み込み中...</p>
        </div>
      ) : viewMode === 'list' && filteredHistory.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <div className="text-6xl mb-4">📋</div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">履歴がありません</h3>
          <p className="text-gray-600">予約が実行されると履歴が表示されます</p>
        </div>
      ) : viewMode === 'list' && (
        <div className="space-y-4">
          {filteredHistory.map((item) => (
            <div key={item.id} className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
                    {getSiteLabel(item.site)}
                  </span>
                  {getStatusBadge(item.status)}
                </div>
                <span className="text-xs text-gray-500">
                  {formatDate(item.createdAt)}
                </span>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">{item.facilityName}</h3>
              <div className="flex items-center gap-4 text-sm text-gray-600 mb-2">
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {item.date}
                </div>
                <div className="flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {item.timeSlot}
                </div>
              </div>
              {item.message && (
                <p className="text-sm text-gray-600 mt-2">{item.message}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
