'use client';

import React, { useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { SITE_TIME_SLOTS } from '@/lib/constants';
import { Loader2, Zap, CheckCircle2, AlertTriangle } from 'lucide-react';

interface QuickSetupCardProps {
    onSuccess: () => void;
}

export function QuickSetupCard({ onSuccess }: QuickSetupCardProps) {
    const [processingSite, setProcessingSite] = useState<'shinagawa' | 'minato' | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [shinagawaAutoReserve, setShinagawaAutoReserve] = useState(false);
    const [minatoAutoReserve, setMinatoAutoReserve] = useState(false);

    const handleShinagawaSetup = async () => {
        setIsProcessing('shinagawa');
        setSuccessMessage(null);
        setError(null);

        try {
            console.log('[QuickSetup] Fetching Shinagawa facilities...');
            const response = await apiClient.getShinagawaFacilities();

            const courts: any[] = [];
            const data = response.data?.data || response.data || response;

            if (Array.isArray(data)) {
                data.forEach((f: any) => {
                    const id = f.facilityId || f.id || f.Id || f.facility_id;
                    const name = f.facilityName || f.name || f.Name || f.facility_name || f.buildingName + ' ' + f.courtName;
                    if (id && name) {
                        courts.push({ ...f, id, name, site: 'shinagawa' });
                    }
                });
            }

            if (courts.length === 0) throw new Error('施設情報の取得に失敗しました');

            const targets = [];
            // ルール1: 平日夜 (19:00-21:00)
            targets.push(...courts.map((c: any) => ({
                site: 'shinagawa' as const,
                facilityId: c.id,
                facilityName: c.name,
                dateMode: 'continuous' as const,
                timeSlots: ['19:00-21:00'],
                selectedWeekdays: [1, 2, 3, 4, 5],
                includeHolidays: false,
                autoReserve: shinagawaAutoReserve,
                priority: 3
            })));

            // ルール2: 土日祝 (全時間帯)
            const allSlots = SITE_TIME_SLOTS.shinagawa.map(s => s.id);
            targets.push(...courts.map((c: any) => ({
                site: 'shinagawa' as const,
                facilityId: c.id,
                facilityName: c.name,
                dateMode: 'continuous' as const,
                timeSlots: allSlots,
                selectedWeekdays: [0, 6],
                includeHolidays: true,
                autoReserve: shinagawaAutoReserve,
                priority: 3
            })));

            await apiClient.createMonitoringBatch(targets);

            setSuccessMessage('品川区の一括設定が完了しました');
            setTimeout(() => {
                setSuccessMessage(null);
                onSuccess();
            }, 3000);

        } catch (err: any) {
            console.error(err);
            setError(`設定に失敗しました: ${err.message}`);
        } finally {
            setIsProcessing(null);
        }
    };

    const handleMinatoSetup = async () => {
        setIsProcessing('minato');
        setSuccessMessage(null);
        setError(null);

        try {
            console.log('[QuickSetup] Fetching Minato facilities...');
            const response = await apiClient.getMinatoFacilities();

            const courts: any[] = [];
            const data = response.data?.data || response.data || response;

            if (Array.isArray(data)) {
                data.forEach((f: any) => {
                    const id = f.facilityId || f.id || f.Id || f.facility_id;
                    const name = f.facilityName || f.name || f.Name || f.facility_name || f.buildingName + ' ' + f.courtName;
                    if (id && name) {
                        courts.push({ ...f, id, name, site: 'minato' });
                    }
                });
            }

            if (courts.length === 0) throw new Error('施設情報の取得に失敗しました');

            const targets = [];
            // ルール3: 平日夜 (19:00-21:00)
            targets.push(...courts.map((c: any) => ({
                site: 'minato' as const,
                facilityId: c.id,
                facilityName: c.name,
                dateMode: 'continuous' as const,
                timeSlots: ['19:00-21:00'],
                selectedWeekdays: [1, 2, 3, 4, 5],
                includeHolidays: false,
                autoReserve: minatoAutoReserve,
                priority: 3
            })));

            // ルール4: 土日祝 (全時間帯)
            const allSlots = SITE_TIME_SLOTS.minato.map(s => s.id);
            targets.push(...courts.map((c: any) => ({
                site: 'minato' as const,
                facilityId: c.id,
                facilityName: c.name,
                dateMode: 'continuous' as const,
                timeSlots: allSlots,
                selectedWeekdays: [0, 6],
                includeHolidays: true,
                autoReserve: minatoAutoReserve,
                priority: 3
            })));

            await apiClient.createMonitoringBatch(targets);

            setSuccessMessage('港区の一括設定が完了しました');
            setTimeout(() => {
                setSuccessMessage(null);
                onSuccess();
            }, 3000);

        } catch (err: any) {
            console.error(err);
            setError(`設定に失敗しました: ${err.message}`);
        } finally {
            setIsProcessing(null);
        }
    };

    const setIsProcessing = (site: 'shinagawa' | 'minato' | null) => {
        setProcessingSite(site);
    };

    if (successMessage) {
        return (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center animate-in fade-in zoom-in duration-300 mb-8">
                <div className="flex justify-center mb-2">
                    <div className="bg-emerald-100 p-3 rounded-full">
                        <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                    </div>
                </div>
                <h3 className="text-lg font-bold text-emerald-800">{successMessage}</h3>
                <p className="text-sm text-emerald-600 mt-1">
                    指定された条件で監視リストを作成しました。<br />
                    下のリストから個別の設定を確認・変更できます。
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-6 mb-8">
            <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <span className="bg-gray-100 p-2 rounded-lg">⚡️</span>
                    一括監視設定
                </h2>
                <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded">
                    推奨設定
                </span>
            </div>

            <p className="text-sm text-gray-600">
                地区ごとに主要なテニスコートをまとめて監視設定できます。
                平日夜間(19-21時)と土日祝(全日)をカバーします。
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 品川区カード */}
                <div className="bg-white border-2 border-emerald-100 rounded-xl p-5 shadow-sm hover:border-emerald-300 transition-colors">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                            <span className="text-2xl">🌲</span> 品川区
                            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Automated</span>
                        </h3>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                        <p>✓ <span className="font-bold">平日:</span> 19:00〜21:00 (夜間のみ)</p>
                        <p>✓ <span className="font-bold">土日祝:</span> 9:00〜21:00 (全時間帯)</p>
                    </div>

                    <label className="flex items-start gap-3 p-3 mb-4 bg-emerald-50 rounded-lg border border-emerald-100 cursor-pointer hover:bg-emerald-100 transition-colors">
                        <input
                            type="checkbox"
                            checked={shinagawaAutoReserve}
                            onChange={(e) => setShinagawaAutoReserve(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-emerald-600 rounded border-gray-300 focus:ring-emerald-500"
                        />
                        <div className="text-xs">
                            <span className="block font-bold text-emerald-900">自動予約を有効にする</span>
                            <span className="block text-emerald-700">空き発見時に即時予約します</span>
                        </div>
                    </label>

                    <button
                        onClick={handleShinagawaSetup}
                        disabled={!!processingSite}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {processingSite === 'shinagawa' ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <Zap className="w-5 h-5 text-yellow-300" />
                        )}
                        品川区を設定
                    </button>
                </div>

                {/* 港区カード */}
                <div className="bg-white border-2 border-blue-100 rounded-xl p-5 shadow-sm hover:border-blue-300 transition-colors relative overflow-hidden">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-lg text-gray-900 flex items-center gap-2">
                            <span className="text-2xl">🗼</span> 港区
                            <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full">Semi-Auto</span>
                        </h3>
                    </div>

                    <div className="bg-gray-50 rounded-lg p-3 mb-4 text-xs text-gray-600 space-y-1">
                        <p>✓ <span className="font-bold">平日:</span> 19:00〜21:00 (夜間のみ)</p>
                        <p>✓ <span className="font-bold">土日祝:</span> 8:00〜21:00 (全時間帯)</p>
                    </div>

                    <div className="mb-4 bg-red-50 p-2 rounded border border-red-100 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-red-700 leading-tight">
                            <strong>重要:</strong> reCAPTCHA対応のため、<br />定期的なセッション手動更新が必要です。
                        </p>
                    </div>

                    <label className="flex items-start gap-3 p-3 mb-4 bg-blue-50 rounded-lg border border-blue-100 cursor-pointer hover:bg-blue-100 transition-colors">
                        <input
                            type="checkbox"
                            checked={minatoAutoReserve}
                            onChange={(e) => setMinatoAutoReserve(e.target.checked)}
                            className="mt-0.5 w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <div className="text-xs">
                            <span className="block font-bold text-blue-900">自動予約を有効にする</span>
                            <span className="block text-blue-700">（セッション有効時のみ動作）</span>
                        </div>
                    </label>

                    <button
                        onClick={handleMinatoSetup}
                        disabled={!!processingSite}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-bold shadow-sm transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {processingSite === 'minato' ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <Zap className="w-5 h-5 text-yellow-300" />
                        )}
                        港区を設定
                    </button>
                </div>
            </div>

            {error && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-200">
                    {error}
                </div>
            )}
        </div>
    );
}
