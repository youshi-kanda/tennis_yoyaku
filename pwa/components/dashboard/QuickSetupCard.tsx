'use client';

import React, { useState } from 'react';
import { apiClient } from '@/lib/api/client';
import { SITE_TIME_SLOTS } from '@/lib/constants';
import { Loader2, Zap, CheckCircle2 } from 'lucide-react';

interface QuickSetupCardProps {
    onSuccess: () => void;
}

export function QuickSetupCard({ onSuccess }: QuickSetupCardProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [enableAutoReserve, setEnableAutoReserve] = useState(false);

    const handleQuickSetup = async () => {
        setIsProcessing(true);
        setError(null);
        setSuccess(false);

        try {
            // 1. 施設情報の取得
            const [shinagawaFacilities, minatoFacilities] = await Promise.all([
                apiClient.getShinagawaFacilities(),
                apiClient.getMinatoFacilities()
            ]);

            // テニスコートのみを抽出するヘルパー
            // ※現状のAPIレスポンスの構造に依存。Wizardと同様にフィルタリングする。
            // APIレスポンスは { success: true, data: [...] } の形式
            const shinagawaCourts: any[] = [];
            if (Array.isArray(shinagawaFacilities.data)) {
                shinagawaFacilities.data.forEach((b: any) => {
                    if (Array.isArray(b.courts)) {
                        b.courts.forEach((c: any) => {
                            shinagawaCourts.push({ ...c, site: 'shinagawa' });
                        });
                    }
                });
            }

            const minatoCourts: any[] = [];
            if (Array.isArray(minatoFacilities.data)) {
                minatoFacilities.data.forEach((b: any) => {
                    if (Array.isArray(b.courts)) {
                        b.courts.forEach((c: any) => {
                            minatoCourts.push({ ...c, site: 'minato' });
                        });
                    }
                });
            }

            const targets = [];

            // --- 品川区のルール生成 ---
            // ルール1: 平日夜 (19:00-21:00)
            targets.push(...shinagawaCourts.map((c: any) => ({
                site: 'shinagawa' as const,
                facilityId: c.courtId,
                facilityName: c.fullName,
                dateMode: 'continuous' as const,
                timeSlots: ['19:00-21:00'],
                selectedWeekdays: [1, 2, 3, 4, 5], // 月〜金
                includeHolidays: false,
                autoReserve: enableAutoReserve,
                priority: 3
            })));

            // ルール2: 土日祝 (全時間帯)
            const allShinagawaSlots = SITE_TIME_SLOTS.shinagawa.map(s => s.id);
            targets.push(...shinagawaCourts.map((c: any) => ({
                site: 'shinagawa' as const,
                facilityId: c.courtId,
                facilityName: c.fullName,
                dateMode: 'continuous' as const,
                timeSlots: allShinagawaSlots,
                selectedWeekdays: [0, 6], // 日・土
                includeHolidays: true, // 祝日も含む
                autoReserve: enableAutoReserve,
                priority: 3
            })));

            // --- 港区のルール生成 ---
            // ルール3: 平日夜 (17:00-21:00 ※港区は17時から夜枠扱いが多いため)
            // ユーザー要望は「19時以降」だが、港区の19時枠を狙う
            targets.push(...minatoCourts.map((c: any) => ({
                site: 'minato' as const,
                facilityId: c.courtId,
                facilityName: c.fullName,
                dateMode: 'continuous' as const,
                timeSlots: ['19:00-21:00'],
                selectedWeekdays: [1, 2, 3, 4, 5],
                includeHolidays: false,
                autoReserve: enableAutoReserve,
                priority: 3
            })));

            // ルール4: 土日祝 (全時間帯)
            const allMinatoSlots = SITE_TIME_SLOTS.minato.map(s => s.id);
            targets.push(...minatoCourts.map((c: any) => ({
                site: 'minato' as const,
                facilityId: c.courtId,
                facilityName: c.fullName,
                dateMode: 'continuous' as const,
                timeSlots: allMinatoSlots,
                selectedWeekdays: [0, 6],
                includeHolidays: true,
                autoReserve: enableAutoReserve,
                priority: 3
            })));

            // 3. バッチ作成実行
            await apiClient.createMonitoringBatch(targets);

            setSuccess(true);
            setTimeout(() => {
                setSuccess(false);
                onSuccess();
            }, 2000);

        } catch (err: any) {
            console.error(err);
            setError('設定の自動生成に失敗しました。');
        } finally {
            setIsProcessing(false);
        }
    };

    if (success) {
        return (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center animate-in fade-in zoom-in duration-300 mb-8">
                <div className="flex justify-center mb-2">
                    <div className="bg-emerald-100 p-3 rounded-full">
                        <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                    </div>
                </div>
                <h3 className="text-lg font-bold text-emerald-800">一括設定が完了しました</h3>
                <p className="text-sm text-emerald-600 mt-1">
                    指定された条件で監視リストを作成しました。<br />
                    下のリストから個別の設定を確認・変更できます。
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mb-8">
            <div className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-3">
                        <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                            <span className="bg-gray-100 p-2 rounded-lg">⚡️</span>
                            一括監視設定
                        </h2>
                        <span className="text-xs font-medium bg-gray-100 text-gray-600 px-2 py-1 rounded">
                            推奨設定
                        </span>
                    </div>

                    <p className="text-sm text-gray-600 mb-4">
                        品川区・港区の全施設に対して、以下の条件で自動的に監視設定を作成します。
                        個別に設定する手間を省き、主要な枠を網羅できます。
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 rounded-lg p-4 border border-gray-100">
                        {/* 品川区の設定内容 */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                                <span className="text-emerald-600">🌲</span> 品川区 (全コート)
                            </h3>
                            <ul className="text-xs text-gray-600 space-y-1 pl-6 list-disc">
                                <li>
                                    <span className="font-semibold">平日:</span> 19:00〜21:00 (夜間のみ)
                                </li>
                                <li>
                                    <span className="font-semibold">土日祝:</span> 9:00〜21:00 (全時間帯)
                                </li>
                            </ul>
                        </div>

                        {/* 港区の設定内容 */}
                        <div className="space-y-2">
                            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                                <span className="text-blue-600">🗼</span> 港区 (全コート)
                            </h3>
                            <ul className="text-xs text-gray-600 space-y-1 pl-6 list-disc">
                                <li>
                                    <span className="font-semibold">平日:</span> 19:00〜21:00 (夜間のみ)
                                </li>
                                <li>
                                    <span className="font-semibold">土日祝:</span> 8:00〜21:00 (全時間帯)
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="w-full md:w-auto flex flex-col items-center gap-4 shrink-0">
                    <label className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200 cursor-pointer hover:bg-gray-100 transition-colors max-w-[300px]">
                        <div className="relative flex items-center h-5 mt-0.5">
                            <input
                                type="checkbox"
                                checked={enableAutoReserve}
                                onChange={(e) => setEnableAutoReserve(e.target.checked)}
                                className="w-5 h-5 border-gray-300 rounded text-gray-900 focus:ring-gray-900 transition-all cursor-pointer"
                            />
                        </div>
                        <div className="text-sm">
                            <span className="block font-bold text-gray-900 mb-0.5">
                                空き枠が見つかったら自動で予約する
                            </span>
                            <span className="block text-xs text-gray-500 leading-relaxed">
                                ※チェックを入れると、空きを検知した瞬間に予約を実行します。
                            </span>
                        </div>
                    </label>

                    <button
                        onClick={handleQuickSetup}
                        disabled={isProcessing}
                        className="w-full md:w-auto bg-gray-900 hover:bg-gray-800 text-white px-6 py-3 rounded-lg font-bold shadow-md transition-all hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 min-w-[200px]"
                    >
                        {isProcessing ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : (
                            <Zap className="w-5 h-5 text-yellow-400" />
                        )}
                        {enableAutoReserve ? '自動予約モードで設定' : '通知のみで設定'}
                    </button>
                    <p className="text-[10px] text-gray-400">
                        ※既存の設定は維持され、新しい設定が追加されます
                    </p>
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
