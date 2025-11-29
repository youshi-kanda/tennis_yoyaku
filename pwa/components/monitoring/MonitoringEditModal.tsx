'use client';

import { useState, useEffect } from 'react';
import { MonitoringTarget } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

interface MonitoringEditModalProps {
  target: MonitoringTarget;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updates: {
    timeSlots?: string[];
    selectedWeekdays?: number[];
    includeHolidays?: boolean | 'only';
    autoReserve?: boolean;
  }) => Promise<void>;
}

export function MonitoringEditModal({ target, isOpen, onClose, onSave }: MonitoringEditModalProps) {
  const [timeSlots, setTimeSlots] = useState<string[]>(target.timeSlots || []);
  const [selectedWeekdays, setSelectedWeekdays] = useState<number[]>(target.selectedWeekdays || []);
  const [includeHolidays, setIncludeHolidays] = useState<boolean | 'only'>(target.includeHolidays ?? true);
  const [autoReserve, setAutoReserve] = useState(target.autoReserve);
  const [isSaving, setIsSaving] = useState(false);

  const timeSlotOptions = [
    '07:00-09:00',
    '09:00-11:00',
    '11:00-13:00',
    '13:00-15:00',
    '15:00-17:00',
    '17:00-19:00',
    '19:00-21:00',
  ];

  const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];

  useEffect(() => {
    if (isOpen) {
      setTimeSlots(target.timeSlots || []);
      setSelectedWeekdays(target.selectedWeekdays || []);
      setIncludeHolidays(target.includeHolidays ?? true);
      setAutoReserve(target.autoReserve);
    }
  }, [isOpen, target]);

  const handleTimeSlotToggle = (slot: string) => {
    setTimeSlots((prev) =>
      prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]
    );
  };

  const handleWeekdayToggle = (day: number) => {
    setSelectedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const handleSave = async () => {
    if (timeSlots.length === 0) {
      alert('少なくとも1つの時間帯を選択してください');
      return;
    }

    if (target.dateMode === 'continuous' && selectedWeekdays.length === 0) {
      alert('継続監視の場合、少なくとも1つの曜日を選択してください');
      return;
    }

    setIsSaving(true);
    try {
      await onSave({
        timeSlots,
        selectedWeekdays,
        includeHolidays,
        autoReserve,
      });
      onClose();
    } catch (error) {
      console.error('Failed to save:', error);
      alert('保存に失敗しました');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto m-4">
        {/* ヘッダー */}
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
          <h2 className="text-xl font-bold text-gray-900">監視設定の編集</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-4 space-y-6">
          {/* 施設情報 */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h3 className="font-semibold text-gray-900 mb-2">{target.facilityName}</h3>
            <p className="text-sm text-gray-600">
              {target.site === 'shinagawa' ? '品川区' : '港区'}
            </p>
          </div>

          {/* 時間帯選択 */}
          <div>
            <label className="block text-sm font-medium text-gray-900 mb-3">
              時間帯 <span className="text-red-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {timeSlotOptions.map((slot) => (
                <button
                  key={slot}
                  onClick={() => handleTimeSlotToggle(slot)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    timeSlots.includes(slot)
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {slot}
                </button>
              ))}
            </div>
          </div>

          {/* 曜日選択（継続監視の場合のみ） */}
          {target.dateMode === 'continuous' && (
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-3">
                監視する曜日 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-7 gap-2">
                {weekdayNames.map((name, index) => (
                  <button
                    key={index}
                    onClick={() => handleWeekdayToggle(index)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      selectedWeekdays.includes(index)
                        ? 'bg-emerald-600 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 祝日設定（継続監視の場合のみ） */}
          {target.dateMode === 'continuous' && (
            <div>
              <label className="block text-sm font-medium text-gray-900 mb-3">
                祝日の扱い
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={includeHolidays === true}
                    onChange={() => setIncludeHolidays(true)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">祝日を含める</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={includeHolidays === false}
                    onChange={() => setIncludeHolidays(false)}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">祝日を除外</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    checked={includeHolidays === 'only'}
                    onChange={() => setIncludeHolidays('only')}
                    className="w-4 h-4 text-blue-600"
                  />
                  <span className="text-sm text-gray-700">祝日のみ</span>
                </label>
              </div>
            </div>
          )}

          {/* 自動予約設定 */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoReserve}
                onChange={(e) => setAutoReserve(e.target.checked)}
                className="w-5 h-5 text-blue-600 rounded"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">
                  空きが出たら自動予約
                </span>
                <p className="text-xs text-gray-500">
                  監視中に空きを検知したら自動的に予約を実行します
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={isSaving}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  );
}
