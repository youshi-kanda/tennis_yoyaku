'use client';

import { useState, useMemo } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { MonitoringTarget } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface MonitoringCalendarProps {
  targets: MonitoringTarget[];
}

type DateStatus = {
  monitoring: number;
  detected: number;
  reserved: number;
  failed: number;
};

export function MonitoringCalendar({ targets }: MonitoringCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // 日付ごとのステータスを集計
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

    return map;
  }, [targets]);

  // 選択された日付のターゲット一覧
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
    
    if (!status) return '';

    // 優先度: failed > reserved > detected > monitoring
    if (status.failed > 0) return 'bg-red-100 text-red-800 font-semibold';
    if (status.reserved > 0) return 'bg-blue-100 text-blue-800 font-semibold';
    if (status.detected > 0) return 'bg-yellow-100 text-yellow-800 font-semibold';
    if (status.monitoring > 0) return 'bg-green-100 text-green-800 font-semibold';
    
    return '';
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
        return <Badge variant="default" className="bg-green-500">監視中</Badge>;
      case 'detected':
        return <Badge variant="default" className="bg-yellow-500">検知</Badge>;
      case 'reserved':
        return <Badge variant="default" className="bg-blue-500">予約済</Badge>;
      case 'failed':
        return <Badge variant="destructive">失敗</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
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
                <div className="w-4 h-4 bg-green-100 border border-green-300 rounded"></div>
                <span>監視中</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
                <span>検知</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded"></div>
                <span>予約済</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-100 border border-red-300 rounded"></div>
                <span>失敗</span>
              </div>
            </div>

            {/* カレンダー本体 */}
            <div className="calendar-container">
              <Calendar
                onChange={(value) => setSelectedDate(value as Date)}
                value={selectedDate}
                tileClassName={tileClassName}
                tileContent={tileContent}
                locale="ja-JP"
                className="w-full border rounded-lg shadow-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 選択日の詳細 */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle>
            {selectedDate
              ? `${selectedDate.getMonth() + 1}/${selectedDate.getDate()} の監視`
              : '日付を選択してください'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {selectedDateTargets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">
              {selectedDate
                ? 'この日の監視はありません'
                : 'カレンダーから日付を選択してください'}
            </p>
          ) : (
            <div className="space-y-3">
              {selectedDateTargets.map((target) => (
                <div
                  key={target.id}
                  className="p-3 border rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-sm">{target.facilityName}</h4>
                    {getStatusBadge(target.status)}
                  </div>
                  <div className="space-y-1 text-xs text-gray-600">
                    <p>📍 {target.site === 'shinagawa' ? '品川区' : '港区'}</p>
                    <p>⏰ {target.timeSlots?.join(', ')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <style jsx global>{`
        .calendar-container .react-calendar {
          border: none;
          font-family: inherit;
        }
        
        .calendar-container .react-calendar__tile {
          padding: 0.75rem 0.5rem;
          position: relative;
        }
        
        .calendar-container .react-calendar__tile:enabled:hover {
          background-color: #f3f4f6;
        }
        
        .calendar-container .react-calendar__tile--active {
          background-color: #3b82f6 !important;
          color: white !important;
        }
        
        .calendar-container .react-calendar__tile--now {
          background-color: #fef3c7;
        }
        
        .calendar-container .react-calendar__navigation button {
          min-width: 44px;
          background: none;
          font-size: 1rem;
          font-weight: 600;
        }
        
        .calendar-container .react-calendar__navigation button:enabled:hover {
          background-color: #f3f4f6;
        }
        
        .calendar-container .react-calendar__month-view__weekdays {
          text-align: center;
          text-transform: uppercase;
          font-weight: bold;
          font-size: 0.75rem;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}
