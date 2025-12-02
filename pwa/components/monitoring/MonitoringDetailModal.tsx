'use client';

import { MonitoringTarget } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, MapPin, Clock, Calendar, PartyPopper } from 'lucide-react';

interface MonitoringGroup {
  key: string;
  site: 'shinagawa' | 'minato';
  targets: MonitoringTarget[];
  timeSlots: string[];
  selectedWeekdays: number[];
  includeHolidays: boolean | 'only';
  sites: Set<'shinagawa' | 'minato'>;
}

interface MonitoringDetailModalProps {
  selectedGroup: MonitoringGroup | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (target: MonitoringTarget) => void;
  onDelete?: (target: MonitoringTarget) => void;
  onPause?: (target: MonitoringTarget) => void;
  onResume?: (target: MonitoringTarget) => void;
  onBulkPause?: (targets: MonitoringTarget[]) => Promise<void>;
  onBulkResume?: (targets: MonitoringTarget[]) => Promise<void>;
  onBulkDelete?: (targets: MonitoringTarget[]) => Promise<void>;
}

// facilityIdから施設名を復元する関数
const getFacilityNameFromId = (facilityId: string, savedName: string): string => {
  // 既に完全な施設名（コート情報含む）がある場合はそのまま返す
  if (savedName.includes('庭球場') || savedName.includes('テニスコート')) {
    return savedName;
  }
  
  // facilityIdの末尾からコート番号を推定
  const lastTwo = facilityId.slice(-2);
  const courtMap: { [key: string]: string } = {
    '10': 'Ａ', '20': 'Ｂ', '30': 'Ｃ', '40': 'Ｄ', '50': 'Ｅ',
    '01': 'Ａ', '02': 'Ｂ', '03': 'Ｃ', '04': 'Ｄ',
  };
  
  const court = courtMap[lastTwo];
  if (court) {
    if (savedName.includes('しながわ') || savedName.includes('品川') || savedName.includes('八潮') || savedName.includes('大井')) {
      return `${savedName} 庭球場${court}`;
    }
    if (savedName.includes('麻布') || savedName.includes('青山') || savedName.includes('芝浦')) {
      return `${savedName} テニスコート${court}`;
    }
  }
  
  return savedName;
};

export function MonitoringDetailModal({
  selectedGroup,
  isOpen,
  onClose,
  onEdit,
  onDelete,
  onPause,
  onResume,
  onBulkPause,
  onBulkResume,
  onBulkDelete,
}: MonitoringDetailModalProps) {
  const getStatusBadge = (target: MonitoringTarget) => {
    switch (target.status) {
      case 'active':
        return <Badge variant="success">🔄 監視中</Badge>;
      case 'paused':
        return <Badge variant="default">⏸️ 停止中</Badge>;
      case 'monitoring':
        return <Badge variant="success">🔄 監視中</Badge>;
      case 'detected':
        return <Badge variant="warning">👀 検知</Badge>;
      case 'reserved':
        return <Badge variant="info">✅ 予約済</Badge>;
      case 'failed':
        return <Badge variant="error">❌ 失敗</Badge>;
      default:
        return <Badge variant="default">{target.status}</Badge>;
    }
  };

  const getScheduleText = (target: MonitoringTarget) => {
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

  const getHolidayText = (target: MonitoringTarget) => {
    if (target.includeHolidays === 'only') return '祝日のみ';
    if (target.includeHolidays === false) return '祝日を除外';
    if (target.includeHolidays === true) return '祝日を含む';
    return '';
  };

  const getGroupScheduleText = () => {
    if (!selectedGroup) return '';
    const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const selectedDays = selectedGroup.selectedWeekdays?.map((d) => weekdayNames[d]).join('・') || '全曜日';
    return `毎週 ${selectedDays}`;
  };

  const getGroupHolidayText = () => {
    if (!selectedGroup) return '';
    if (selectedGroup.includeHolidays === 'only') return '祝日のみ';
    if (selectedGroup.includeHolidays === false) return '祝日を除外';
    if (selectedGroup.includeHolidays === true) return '祝日を含む';
    return '';
  };

  if (!isOpen || !selectedGroup) return null;

  const targets = selectedGroup.targets;
  const activeCount = targets.filter(t => t.status === 'active' || t.status === 'monitoring').length;
  const pausedCount = targets.filter(t => t.status === 'paused').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto m-4">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b px-6 py-4">
          <div className="flex justify-between items-start mb-3">
            <div className="flex-1">
              <h2 className="text-xl font-bold text-gray-900 mb-2">監視グループの詳細</h2>
              <div className="flex flex-wrap items-center gap-2">
                {Array.from(selectedGroup.sites).map(site => (
                  <span
                    key={site}
                    className={`px-2 py-1 rounded-full text-xs font-bold ${
                      site === 'shinagawa' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                    }`}
                  >
                    {site === 'shinagawa' ? '品川' : '港区'}
                  </span>
                ))}
                <span className="text-sm text-gray-600">
                  {targets.length}施設
                </span>
                {activeCount > 0 && (
                  <span className="px-2 py-1 bg-emerald-100 border border-emerald-300 rounded-full text-xs font-semibold text-emerald-700">
                    ● {activeCount}件稼働中
                  </span>
                )}
                {pausedCount > 0 && (
                  <span className="px-2 py-1 bg-gray-100 border border-gray-300 rounded-full text-xs font-semibold text-gray-600">
                    ⏸ {pausedCount}件停止中
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors ml-4"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
          
          {/* グループ情報 */}
          <div className="bg-gray-50 rounded-lg p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-gray-500" />
              <span className="text-gray-700">{getGroupScheduleText()}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4 text-gray-500" />
              <div className="flex flex-wrap gap-1">
                {selectedGroup.timeSlots.map((slot, idx) => (
                  <span
                    key={idx}
                    className="inline-block bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs"
                  >
                    {slot}
                  </span>
                ))}
              </div>
            </div>
            {getGroupHolidayText() && (
              <div className="flex items-center gap-2 text-sm">
                <PartyPopper className="w-4 h-4 text-gray-500" />
                <span className="text-gray-700">{getGroupHolidayText()}</span>
              </div>
            )}
          </div>
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-4">
          <div className="space-y-4">
            {targets.map((target) => (
              <div
                key={target.id}
                className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-bold text-lg text-gray-900 mb-1">
                      {getFacilityNameFromId(target.facilityId, target.facilityName || target.facilityId || '施設名未設定')}
                    </h3>
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <MapPin className="w-4 h-4" />
                      <span>{target.site === 'shinagawa' ? '品川区' : '港区'}</span>
                    </div>
                  </div>
                  {getStatusBadge(target)}
                </div>

                <div className="space-y-2 mb-4">
                  {/* 時間帯 */}
                  <div className="flex items-start gap-2 text-sm">
                    <Clock className="w-4 h-4 mt-0.5 text-gray-500 shrink-0" />
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
                    <Calendar className="w-4 h-4 text-gray-500 shrink-0" />
                    <span className="text-gray-700">{getScheduleText(target)}</span>
                  </div>

                  {/* 祝日設定 */}
                  {getHolidayText(target) && (
                    <div className="flex items-center gap-2 text-sm">
                      <PartyPopper className="w-4 h-4 text-gray-500 shrink-0" />
                      <span className="text-gray-700">{getHolidayText(target)}</span>
                    </div>
                  )}

                  {/* 最終チェック日時 */}
                  {target.updatedAt && (
                    <div className="flex items-center gap-2 text-xs text-gray-500 pt-2 border-t">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        最終チェック:{' '}
                        {new Date(target.updatedAt).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {/* アクションボタン */}
                <div className="flex flex-col gap-2 pt-3 border-t">
                  <div className="flex gap-2">
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
                    {target.status === 'paused' ? (
                      onResume && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onResume(target)}
                          className="flex-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
                        >
                          再開
                        </Button>
                      )
                    ) : (
                      onPause && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onPause(target)}
                          className="flex-1 text-orange-600 border-orange-300 hover:bg-orange-50"
                        >
                          停止
                        </Button>
                      )
                    )}
                  </div>
                  {onDelete && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDelete(target)}
                      className="w-full text-red-600 border-red-300 hover:bg-red-50"
                    >
                      削除
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4">
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            {onBulkPause && activeCount > 0 && (
              <Button
                variant="outline"
                onClick={() => onBulkPause(targets)}
                className="flex-1 text-orange-600 border-orange-300 hover:bg-orange-50"
              >
                ⏸️ グループを一時停止 ({activeCount}件)
              </Button>
            )}
            {onBulkResume && pausedCount > 0 && (
              <Button
                variant="outline"
                onClick={() => onBulkResume(targets)}
                className="flex-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50"
              >
                ▶️ グループを再開 ({pausedCount}件)
              </Button>
            )}
            {onBulkDelete && (
              <Button
                variant="outline"
                onClick={() => onBulkDelete(targets)}
                className="flex-1 text-red-600 border-red-300 hover:bg-red-50"
              >
                🗑️ グループを削除 ({targets.length}件)
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              閉じる
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
