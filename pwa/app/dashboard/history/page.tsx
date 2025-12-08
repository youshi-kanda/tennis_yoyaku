'use client';

import { useState, useEffect, useMemo } from 'react';
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

interface NotificationHistoryItem {
  id: string;
  title: string;
  body: string;
  icon?: string;
  timestamp: number;
  data?: any;
}

type DateRangeFilter = 'all' | 'today' | 'thisWeek' | 'thisMonth' | 'lastMonth' | 'custom';
type FailureReason = 'all' | 'time_slot_not_available' | 'login_failed' | 'too_many_subrequests' | 'other';

export default function HistoryPage() {
  const [history, setHistory] = useState<ReservationHistory[]>([]);
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryItem[]>([]);
  const [activeTab, setActiveTab] = useState<'reservations' | 'notifications'>('reservations');
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [failureReasonFilter, setFailureReasonFilter] = useState<FailureReason>('all');
  const [dateRangeFilter, setDateRangeFilter] = useState<DateRangeFilter>('thisMonth');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    if (activeTab === 'reservations') {
      loadHistory();
    } else {
      loadNotificationHistory();
    }
  }, [activeTab]);

  const loadNotificationHistory = async () => {
    try {
      setIsLoading(true);
      const data = await apiClient.getNotificationHistory();
      if (data && data.data) {
        setNotificationHistory(data.data);
      }
    } catch (err) {
      console.error('Failed to load notification history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getReservationHistory(1000);
      if (response.success) {
        setHistory(response.data || []);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 日付範囲でフィルタリング
  const getDateRange = (): { start: Date; end: Date } | null => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (dateRangeFilter) {
      case 'all':
        return null;
      case 'today':
        return { start: today, end: new Date(today.getTime() + 24 * 60 * 60 * 1000) };
      case 'thisWeek': {
        const dayOfWeek = today.getDay();
        const monday = new Date(today);
        monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 7);
        return { start: monday, end: sunday };
      }
      case 'thisMonth': {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        return { start: firstDay, end: lastDay };
      }
      case 'lastMonth': {
        const firstDay = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        return { start: firstDay, end: lastDay };
      }
      case 'custom':
        if (customStartDate && customEndDate) {
          return {
            start: new Date(customStartDate),
            end: new Date(customEndDate + 'T23:59:59')
          };
        }
        return null;
      default:
        return null;
    }
  };

  // 失敗理由を分類
  const categorizeFailureReason = (message?: string): FailureReason => {
    if (!message) return 'other';
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes('time slot not available')) return 'time_slot_not_available';
    if (lowerMessage.includes('login failed')) return 'login_failed';
    if (lowerMessage.includes('too many subrequests')) return 'too_many_subrequests';
    return 'other';
  };

  // 統計情報を計算
  const statistics = useMemo(() => {
    const total = history.length;
    const success = history.filter(h => h.status === 'success').length;
    const failed = history.filter(h => h.status === 'failed').length;
    const timeSlotNotAvailable = history.filter(h =>
      h.status === 'failed' && categorizeFailureReason(h.message) === 'time_slot_not_available'
    ).length;
    const loginFailed = history.filter(h =>
      h.status === 'failed' && categorizeFailureReason(h.message) === 'login_failed'
    ).length;
    const tooManySubrequests = history.filter(h =>
      h.status === 'failed' && categorizeFailureReason(h.message) === 'too_many_subrequests'
    ).length;
    const otherFailures = failed - timeSlotNotAvailable - loginFailed - tooManySubrequests;

    return {
      total,
      success,
      failed,
      timeSlotNotAvailable,
      loginFailed,
      tooManySubrequests,
      otherFailures,
      successRate: total > 0 ? ((success / total) * 100).toFixed(1) : '0.0',
    };
  }, [history]);

  // フィルタリング適用
  const filteredHistory = useMemo(() => {
    let filtered = history;

    // ステータスフィルター
    if (statusFilter !== 'all') {
      filtered = filtered.filter(item => item.status === statusFilter);
    }

    // 失敗理由フィルター
    if (statusFilter === 'failed' && failureReasonFilter !== 'all') {
      filtered = filtered.filter(item =>
        categorizeFailureReason(item.message) === failureReasonFilter
      );
    }

    // 日付範囲フィルター
    const dateRange = getDateRange();
    if (dateRange) {
      filtered = filtered.filter(item => {
        const itemDate = new Date(item.date);
        return itemDate >= dateRange.start && itemDate <= dateRange.end;
      });
    }

    // 日付でソート（新しい順）
    return filtered.sort((a, b) => b.createdAt - a.createdAt);
  }, [history, statusFilter, failureReasonFilter, dateRangeFilter, customStartDate, customEndDate]);

  // ページネーション
  const totalPages = Math.ceil(filteredHistory.length / itemsPerPage);
  const paginatedHistory = filteredHistory.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // ページ変更時はトップにスクロール
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, failureReasonFilter, dateRangeFilter, customStartDate, customEndDate]);

  const getFailureReasonLabel = (message?: string): string => {
    const reason = categorizeFailureReason(message);
    switch (reason) {
      case 'time_slot_not_available':
        return '空き枠なし';
      case 'login_failed':
        return 'ログイン失敗';
      case 'too_many_subrequests':
        return 'リクエスト超過';
      case 'other':
        return 'その他のエラー';
      default:
        return '';
    }
  };

  const getFailureReasonBadge = (message?: string) => {
    const reason = categorizeFailureReason(message);
    const styles = {
      time_slot_not_available: 'bg-orange-100 text-orange-800',
      login_failed: 'bg-purple-100 text-purple-800',
      too_many_subrequests: 'bg-yellow-100 text-yellow-800',
      other: 'bg-gray-100 text-gray-800',
    };
    const label = getFailureReasonLabel(message);
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${styles[reason as keyof typeof styles]}`}>
        {label}
      </span>
    );
  };

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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">履歴</h1>
        <p className="text-sm text-gray-600 mt-1">
          予約や通知の履歴を確認できます
        </p>
      </div>

      {/* タブ切り替え */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('reservations')}
          className={`px-6 py-3 font-medium text-sm transition-colors relative ${activeTab === 'reservations'
            ? 'text-emerald-600'
            : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          予約履歴
          {activeTab === 'reservations' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('notifications')}
          className={`px-6 py-3 font-medium text-sm transition-colors relative ${activeTab === 'notifications'
            ? 'text-emerald-600'
            : 'text-gray-500 hover:text-gray-700'
            }`}
        >
          通知履歴
          {activeTab === 'notifications' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-600" />
          )}
        </button>
      </div>

      {activeTab === 'reservations' ? (
        <>
          {/* 統計情報 */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">総試行回数</div>
              <div className="text-2xl font-bold text-gray-900">{statistics.total}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">成功</div>
              <div className="text-2xl font-bold text-green-600">{statistics.success}</div>
              <div className="text-xs text-gray-500 mt-1">成功率: {statistics.successRate}%</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-600 mb-1">失敗</div>
              <div className="text-2xl font-bold text-red-600">{statistics.failed}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-600 space-y-1">
                <div className="flex justify-between">
                  <span>空き枠なし:</span>
                  <span className="font-semibold">{statistics.timeSlotNotAvailable}</span>
                </div>
                <div className="flex justify-between">
                  <span>ログイン失敗:</span>
                  <span className="font-semibold">{statistics.loginFailed}</span>
                </div>
                <div className="flex justify-between">
                  <span>リクエスト超過:</span>
                  <span className="font-semibold">{statistics.tooManySubrequests}</span>
                </div>
                <div className="flex justify-between">
                  <span>その他:</span>
                  <span className="font-semibold">{statistics.otherFailures}</span>
                </div>
              </div>
            </div>
          </div>

          {/* フィルター */}
          <div className="mb-6 space-y-4">
            {/* 日付範囲フィルター */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">期間</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDateRangeFilter('today')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'today'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  今日
                </button>
                <button
                  onClick={() => setDateRangeFilter('thisWeek')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'thisWeek'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  今週
                </button>
                <button
                  onClick={() => setDateRangeFilter('thisMonth')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'thisMonth'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  今月
                </button>
                <button
                  onClick={() => setDateRangeFilter('lastMonth')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'lastMonth'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  先月
                </button>
                <button
                  onClick={() => setDateRangeFilter('all')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  すべて
                </button>
                <button
                  onClick={() => setDateRangeFilter('custom')}
                  className={`px-4 py-2 rounded-lg font-medium transition ${dateRangeFilter === 'custom'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  カスタム
                </button>
              </div>
            </div>

            {/* カスタム期間選択 */}
            {dateRangeFilter === 'custom' && (
              <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">開始日</label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-700 mb-1">終了日</label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}

            {/* ステータスフィルター */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">ステータス</label>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setStatusFilter('all');
                    setFailureReasonFilter('all');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition ${statusFilter === 'all'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  すべて
                </button>
                <button
                  onClick={() => {
                    setStatusFilter('success');
                    setFailureReasonFilter('all');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition ${statusFilter === 'success'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  成功 ({statistics.success})
                </button>
                <button
                  onClick={() => {
                    setStatusFilter('failed');
                    setFailureReasonFilter('all');
                  }}
                  className={`px-4 py-2 rounded-lg font-medium transition ${statusFilter === 'failed'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                    }`}
                >
                  失敗 ({statistics.failed})
                </button>
              </div>
            </div>

            {/* 失敗理由フィルター（失敗選択時のみ表示） */}
            {statusFilter === 'failed' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">失敗理由</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setFailureReasonFilter('all')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${failureReasonFilter === 'all'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    すべて
                  </button>
                  <button
                    onClick={() => setFailureReasonFilter('time_slot_not_available')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${failureReasonFilter === 'time_slot_not_available'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    空き枠なし ({statistics.timeSlotNotAvailable})
                  </button>
                  <button
                    onClick={() => setFailureReasonFilter('login_failed')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${failureReasonFilter === 'login_failed'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    ログイン失敗 ({statistics.loginFailed})
                  </button>
                  <button
                    onClick={() => setFailureReasonFilter('too_many_subrequests')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${failureReasonFilter === 'too_many_subrequests'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    リクエスト超過 ({statistics.tooManySubrequests})
                  </button>
                  <button
                    onClick={() => setFailureReasonFilter('other')}
                    className={`px-4 py-2 rounded-lg font-medium transition ${failureReasonFilter === 'other'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                      }`}
                  >
                    その他 ({statistics.otherFailures})
                  </button>
                </div>
              </div>
            )}

            {/* 結果サマリー */}
            <div className="text-sm text-gray-600">
              {filteredHistory.length}件の履歴を表示中
            </div>
          </div>

          {/* 履歴リスト */}
          {isLoading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
              <p className="text-gray-600 mt-2">読み込み中...</p>
            </div>
          ) : filteredHistory.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <div className="text-6xl mb-4">📋</div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">履歴がありません</h3>
              <p className="text-gray-600">予約が実行されると履歴が表示されます</p>
            </div>
          ) : (
            <>
              <div className="space-y-4">
                {paginatedHistory.map((item) => (
                  <div key={item.id} className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
                          {getSiteLabel(item.site)}
                        </span>
                        {getStatusBadge(item.status)}
                        {item.status === 'failed' && getFailureReasonBadge(item.message)}
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
                      <div className="mt-2 p-2 bg-gray-50 rounded text-sm text-gray-700">
                        <span className="font-medium">詳細: </span>{item.message}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ページネーション */}
              {totalPages > 1 && (
                <div className="mt-6 flex items-center justify-between">
                  <div className="text-sm text-gray-600">
                    {filteredHistory.length}件中 {(currentPage - 1) * itemsPerPage + 1}〜{Math.min(currentPage * itemsPerPage, filteredHistory.length)}件を表示
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      前へ
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }

                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`w-10 h-10 rounded-lg font-medium transition ${currentPage === pageNum
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                              }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 border border-gray-300 rounded-lg font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                    >
                      次へ
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        /* 通知履歴ビュー */
        isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
            <p className="text-gray-600 mt-2">読み込み中...</p>
          </div>
        ) : notificationHistory.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="text-6xl mb-4">📭</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">通知履歴がありません</h3>
            <p className="text-gray-600">まだ通知を受け取っていません</p>
          </div>
        ) : (
          <div className="space-y-4">
            {notificationHistory.map((item) => (
              <div key={item.id} className="bg-white rounded-lg shadow p-4 hover:shadow-md transition">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{item.title.includes('成功') ? '✅' : item.title.includes('失敗') ? '❌' : '🔔'}</span>
                    <h3 className="text-lg font-bold text-gray-900">{item.title}</h3>
                  </div>
                  <span className="text-xs text-gray-500 whitespace-nowrap">
                    {formatDate(item.timestamp)}
                  </span>
                </div>
                <p className="text-gray-700 whitespace-pre-wrap pl-10">{item.body}</p>
                {/* 関連リンク表示 (もしあれば) */}
                {item.data?.url && (
                  <div className="mt-3 pl-10">
                    <a
                      href={item.data.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-600 hover:text-emerald-700 underline"
                    >
                      詳細を確認する &rarr;
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
