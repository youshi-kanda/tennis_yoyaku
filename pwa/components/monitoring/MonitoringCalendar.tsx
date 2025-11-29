'use client';

import { useState, useMemo, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { MonitoringTarget } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { isHoliday } from '@/lib/utils/holidays';
import { apiClient } from '@/lib/api/client';

interface MonitoringCalendarProps {
  targets: MonitoringTarget[];
}

type DateStatus = {
  monitoring: number;
  detected: number;
  reserved: number;
  failed: number;
};

interface ReservationHistory {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed';
  createdAt: number;
}

export function MonitoringCalendar({ targets }: MonitoringCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [reservations, setReservations] = useState<ReservationHistory[]>([]);

  // 予約履歴を取得
  useEffect(() => {
    const loadReservations = async () => {
      try {
        console.log('[MonitoringCalendar] Loading reservations...');
        const response = await apiClient.getReservationHistory(100);
        console.log('[MonitoringCalendar] API Response:', response);
        if (response.success && response.data) {
          console.log('[MonitoringCalendar] Reservations loaded:', response.data.length, 'items');
          console.log('[MonitoringCalendar] Status breakdown:', {
            success: response.data.filter((r: any) => r.status === 'success').length,
            failed: response.data.filter((r: any) => r.status === 'failed').length
          });
          setReservations(response.data);
        }
      } catch (error) {
        console.error('Failed to load reservations:', error);
      }
    };
    loadReservations();
  }, []);

  // 日付ごとのステータスを集計（監視ターゲット + 予約履歴）
  const dateStatusMap = useMemo(() => {
    const map = new Map<string, DateStatus>();

    targets.forEach((target) => {
      const dates: string[] = [];

      if (target.dateMode === 'single' || !target.dateMode) {
        dates.push(target.date);
      } else if (target.dateMode === 'range' && target.startDate && target.endDate) {
        const start = new Date(target.startDate);
        const end = new Date(target.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          dates.push(d.toISOString().split('T')[0]);
        }
      } else if (target.dateMode === 'continuous' && target.startDate && target.endDate) {
        const start = new Date(target.startDate);
        const end = new Date(target.endDate);
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
          // 曜日フィルタリング
          if (target.selectedWeekdays && target.selectedWeekdays.length > 0) {
            const dayOfWeek = d.getDay();
            if (!target.selectedWeekdays.includes(dayOfWeek)) {
              continue;
            }
          }
          dates.push(d.toISOString().split('T')[0]);
        }
      }

      dates.forEach((dateStr) => {
        const status = map.get(dateStr) || {
          monitoring: 0,
          detected: 0,
          reserved: 0,
          failed: 0,
        };

        if (target.status === 'monitoring') status.monitoring++;
        else if (target.status === 'detected') status.detected++;
        else if (target.status === 'reserved') status.reserved++;
        else if (target.status === 'failed') status.failed++;

        map.set(dateStr, status);
      });
    });

    // 予約履歴からステータスを追加（成功のみカウント）
    reservations.forEach((reservation) => {
      if (reservation.status === 'success') {
        const status = map.get(reservation.date) || {
          monitoring: 0,
          detected: 0,
          reserved: 0,
          failed: 0,
        };
        status.reserved++;
        map.set(reservation.date, status);
      }
    });

    return map;
  }, [targets, reservations]);

  // 選択された日付の予約成功リスト（成功のみ表示）
  const selectedDateReservations = useMemo(() => {
    if (!selectedDate) return [];

    const dateStr = selectedDate.toISOString().split('T')[0];
    console.log('[MonitoringCalendar] Selected date:', dateStr);
    
    const allForDate = reservations.filter((r) => r.date === dateStr);
    const successOnly = allForDate.filter((r) => r.status === 'success');
    
    console.log('[MonitoringCalendar] Reservations for', dateStr, ':', {
      total: allForDate.length,
      success: successOnly.length,
      failed: allForDate.length - successOnly.length
    });
    
    return successOnly;
  }, [selectedDate, reservations]);

  // 選択された日付のターゲット一覧（参考用、非表示）
  const selectedDateTargets = useMemo(() => {
    if (!selectedDate) return [];

    const dateStr = selectedDate.toISOString().split('T')[0];
    return targets.filter((target) => {
      if (target.dateMode === 'single' || !target.dateMode) {
        return target.date === dateStr;
      } else if (target.dateMode === 'range' && target.startDate && target.endDate) {
        return dateStr >= target.startDate && dateStr <= target.endDate;
      } else if (target.dateMode === 'continuous' && target.startDate && target.endDate) {
        if (dateStr < target.startDate || dateStr > target.endDate) return false;
        
        // 曜日チェック
        if (target.selectedWeekdays && target.selectedWeekdays.length > 0) {
          const dayOfWeek = selectedDate.getDay();
          return target.selectedWeekdays.includes(dayOfWeek);
        }
        return true;
      }
      return false;
    });
  }, [selectedDate, targets]);

  // カレンダーのタイルにクラスを追加
  const tileClassName = ({ date }: { date: Date }) => {
    const dateStr = date.toISOString().split('T')[0];
    const status = dateStatusMap.get(dateStr);
    
    const classes: string[] = [];
    
    // 土日祝を赤文字に
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6 || isHoliday(date)) {
      classes.push('text-red-600');
    }
    
    if (!status) return classes.join(' ');

    // 優先度: failed > reserved > detected > monitoring
    if (status.failed > 0) classes.push('bg-red-100 font-semibold border border-red-300');
    else if (status.reserved > 0) classes.push('bg-green-100 font-semibold border border-green-300');
    else if (status.detected > 0) classes.push('bg-yellow-100 font-semibold border border-yellow-300');
    else if (status.monitoring > 0) classes.push('bg-blue-100 font-semibold border border-blue-300');
    
    return classes.join(' ');
  };

  // タイルの内容をカスタマイズ
  const tileContent = ({ date }: { date: Date }) => {
    const dateStr = date.toISOString().split('T')[0];
    const status = dateStatusMap.get(dateStr);
    
    if (!status) return null;

    const total = status.monitoring + status.detected + status.reserved + status.failed;
    if (total === 0) return null;

    return (
      <div className="flex justify-center mt-1">
        <span className="text-xs bg-gray-700 text-white rounded-full px-1.5 py-0.5">
          {total}
        </span>
      </div>
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'monitoring':
        return <Badge variant="success">監視中</Badge>;
      case 'detected':
        return <Badge variant="warning">検知</Badge>;
      case 'reserved':
        return <Badge variant="info">予約済</Badge>;
      case 'failed':
        return <Badge variant="error">失敗</Badge>;
      default:
        return <Badge variant="default">{status}</Badge>;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* カレンダー */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>📅 監視カレンダー</CardTitle>
          <p className="text-sm text-gray-600">
            監視対象日をクリックして詳細を表示
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            {/* 凡例 */}
            <div className="flex flex-wrap gap-3 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div>
                <span>🔵 監視中</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
                <span>🟡 空き検知</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
                <span>🟢 予約成功</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                <span>🔴 予約失敗</span>
              </div>
            </div>

            {/* カレンダー本体 */}
            <style jsx global>{`
              .react-calendar {
                width: 100% !important;
                border: none !important;
                font-family: inherit;
              }
              .react-calendar__navigation {
                margin-bottom: 1rem;
              }
              .react-calendar__navigation button {
                min-width: 44px;
                background: none;
                font-size: 1.1rem;
                font-weight: 600;
                color: #1f2937;
              }
              .react-calendar__navigation button:enabled:hover,
              .react-calendar__navigation button:enabled:focus {
                background-color: #f3f4f6;
                border-radius: 0.5rem;
              }
              .react-calendar__month-view__weekdays {
                text-align: center;
                font-weight: 600;
                font-size: 0.875rem;
                color: #4b5563;
              }
              .react-calendar__month-view__days__day {
                padding: 0.75rem 0.25rem;
                font-size: 0.875rem;
              }
              .react-calendar__tile {
                max-width: 100%;
                padding: 0.75rem 0.5rem;
                background: none;
                text-align: center;
                line-height: 1.4;
              }
              .react-calendar__tile:enabled:hover,
              .react-calendar__tile:enabled:focus {
                background-color: #f3f4f6;
                border-radius: 0.5rem;
              }
              .react-calendar__tile--now {
                background: #dbeafe !important;
                border-radius: 0.5rem;
                font-weight: 600;
              }
              .react-calendar__tile--active {
                background: #3b82f6 !important;
                color: white !important;
                border-radius: 0.5rem;
                font-weight: 600;
              }
            `}</style>
            <div className="calendar-container">
              <Calendar
                onChange={(value) => setSelectedDate(value as Date)}
                value={selectedDate}
                tileClassName={tileClassName}
                tileContent={tileContent}
                locale="ja-JP"
                className="w-full"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 選択日の予約成功詳細 */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>
            {selectedDate
              ? `${selectedDate.getMonth() + 1}/${selectedDate.getDate()} の予約成功`
              : '日付を選択してください'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedDate ? (
            <p className="text-sm text-gray-500 text-center py-8">
              カレンダーから日付を選択してください
            </p>
          ) : selectedDateReservations.length === 0 ? (
            <div className="text-center py-8">
              <svg
                className="w-12 h-12 text-gray-300 mx-auto mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-sm text-gray-500">
                この日の予約成功はありません
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {selectedDateReservations.map((reservation) => (
                <div
                  key={reservation.id}
                  className="p-4 border-2 border-green-200 bg-green-50 rounded-lg"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-sm text-green-900">
                      ✅ {reservation.facilityName}
                    </h4>
                    <Badge variant="success">予約成功</Badge>
                  </div>
                  <div className="space-y-1 text-sm text-green-800">
                    <p className="flex items-center gap-2">
                      <span className="font-medium">📍 地区:</span>
                      <span>{reservation.site === 'shinagawa' ? '品川区' : '港区'}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span className="font-medium">⏰ 時間:</span>
                      <span>{reservation.timeSlot}</span>
                    </p>
                    <p className="flex items-center gap-2 text-xs text-green-600">
                      <span className="font-medium">🕐 予約日時:</span>
                      <span>
                        {new Date(reservation.createdAt).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
