'use client';

import { MonitoringTarget } from '@/lib/types';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Calendar,
  Clock,
  MapPin,
  Calendar as CalendarWeek,
  PartyPopper,
} from 'lucide-react';

interface MonitoringCardProps {
  target: MonitoringTarget;
  onDetail?: (target: MonitoringTarget) => void;
  onEdit?: (target: MonitoringTarget) => void;
  onStop?: (target: MonitoringTarget) => void;
}

export function MonitoringCard({ target, onDetail, onEdit, onStop }: MonitoringCardProps) {
  const getStatusBadge = () => {
    switch (target.status) {
      case 'monitoring':
        return <Badge variant="default" className="bg-green-500">🔄 監視中</Badge>;
      case 'detected':
        return <Badge variant="default" className="bg-yellow-500">👀 検知</Badge>;
      case 'reserved':
        return <Badge variant="default" className="bg-blue-500">✅ 予約済</Badge>;
      case 'failed':
        return <Badge variant="destructive">❌ 失敗</Badge>;
      default:
        return <Badge variant="outline">{target.status}</Badge>;
    }
  };

  const getScheduleText = () => {
    if (target.dateMode === 'single' || !target.dateMode) {
      return target.date;
    } else if (target.dateMode === 'range') {
      return `${target.startDate} 〜 ${target.endDate}`;
    } else if (target.dateMode === 'continuous') {
      const weekdays = target.selectedWeekdays || [];
      const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
      const selectedDays = weekdays.map((d) => weekdayNames[d]).join('・');
      return `毎週 ${selectedDays || '全曜日'}`;
    }
    return target.date;
  };

  const getHolidayText = () => {
    if (target.includeHolidays === 'only') return '祝日のみ';
    if (target.includeHolidays === false) return '祝日を除外';
    if (target.includeHolidays === true) return '祝日を含む';
    return '';
  };

  return (
    <Card className="p-4 hover:shadow-lg transition-all duration-200 border-2 hover:border-gray-300">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h3 className="font-bold text-lg mb-1">{target.facilityName}</h3>
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <MapPin className="w-4 h-4" />
            <span>{target.site === 'shinagawa' ? '品川区' : '港区'}</span>
          </div>
        </div>
        {getStatusBadge()}
      </div>

      <div className="space-y-2 mb-4">
        {/* 時間帯 */}
        <div className="flex items-start gap-2 text-sm">
          <Clock className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
          <div className="flex-1">
            <div className="flex flex-wrap gap-1">
              {target.timeSlots?.map((slot, idx) => (
                <span
                  key={idx}
                  className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs"
                >
                  {slot}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* スケジュール */}
        <div className="flex items-center gap-2 text-sm">
          {target.dateMode === 'continuous' ? (
            <CalendarWeek className="w-4 h-4 text-gray-500 flex-shrink-0" />
          ) : (
            <Calendar className="w-4 h-4 text-gray-500 flex-shrink-0" />
          )}
          <span className="text-gray-700">{getScheduleText()}</span>
        </div>

        {/* 祝日設定 */}
        {getHolidayText() && (
          <div className="flex items-center gap-2 text-sm">
            <PartyPopper className="w-4 h-4 text-gray-500 flex-shrink-0" />
            <span className="text-gray-700">{getHolidayText()}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 pt-3 border-t">
        {onDetail && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDetail(target)}
            className="flex-1"
          >
            詳細
          </Button>
        )}
        {onEdit && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEdit(target)}
            className="flex-1"
          >
            編集
          </Button>
        )}
        {onStop && (
          <Button
            size="sm"
            variant="destructive"
            onClick={() => onStop(target)}
            className="flex-1"
          >
            停止
          </Button>
        )}
      </div>
    </Card>
  );
}
