'use client';

import React, { useState, useEffect } from 'react';
import { apiClient } from '@/lib/api/client';

// 動的レンダリングを強制
export const dynamic = 'force-dynamic';

interface MonitoringStatus {
  isActive: boolean;
  sites: {
    shinagawa: boolean;
    minato: boolean;
  };
  startedAt?: number;
  facilitiesCount: number;
}

interface MonitoringTarget {
  id: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  dateMode?: 'single' | 'range' | 'continuous';
  timeSlots: string[];
  priority: number;
  status: 'active' | 'paused' | 'monitoring' | 'detected' | 'reserved' | 'failed';
  createdAt: number;
  updatedAt: number;
  startDate?: string;
  endDate?: string;
  selectedWeekdays?: number[];
  includeHolidays?: boolean | 'only';
}

export default function MonitoringPage() {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monitoringTargets, setMonitoringTargets] = useState<MonitoringTarget[]>([]);

  // ウィザードステップ管理
  const [currentStep, setCurrentStep] = useState(1); // 1: 日時設定, 2: 施設選択, 3: 詳細設定
  const [showWizard, setShowWizard] = useState(false); // ウィザード表示フラグ

  // グループ展開状態の管理
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  import { SITE_TIME_SLOTS, WEEKDAYS } from '@/lib/constants';

  // 施設リスト（コート単位で管理）
  interface CourtInfo {
    courtId: string;      // コートのID (例: "10100010")
    courtName: string;    // コート名 (例: "庭球場A")
    fullName: string;     // 完全な名前 (例: "しながわ中央公園 庭球場A")
  }

  interface BuildingInfo {
    buildingId: string;   // 建物のベースID (例: "1010")
    buildingName: string; // 建物名 (例: "しながわ中央公園")
    courts: CourtInfo[];  // コート一覧
  }

  const [facilities, setFacilities] = useState<{
    shinagawa: BuildingInfo[];
    minato: BuildingInfo[];
  }>({
    shinagawa: [],
    minato: [],
  });

  // 予約可能期間情報（初期値はnull、取得後に設定）
  const [reservationPeriods, setReservationPeriods] = useState<{
    shinagawa: { maxDaysAhead: number; source: string; displayText?: string } | null;
    minato: { maxDaysAhead: number; source: string; displayText?: string } | null;
  }>({
    shinagawa: null,
    minato: null,
  });

  // 設定フォーム
  const [config, setConfig] = useState({
    sites: {
      shinagawa: true,
      minato: false,
    },
    selectedRegion: 'shinagawa' as 'shinagawa' | 'minato', // デフォルトは品川
    selectedFacilities: [] as Array<{ site: 'shinagawa' | 'minato'; id: string; name: string }>,
    dateMode: 'range' as 'single' | 'range' | 'continuous', // 日付指定モード
    startDate: (() => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().split('T')[0];
    })(),
    endDate: (() => {
      const weekLater = new Date();
      weekLater.setDate(weekLater.getDate() + 8);
      return weekLater.toISOString().split('T')[0];
    })(),
    selectedWeekdays: [0, 1, 2, 3, 4, 5, 6] as number[], // 曜日指定（デフォルトは全曜日）
    includeHolidays: true as boolean | 'only', // 祝日の扱い（true=含める, false=除外, 'only'=祝日のみ）
    timeSlots: [] as string[], // 初期状態は未選択
    applicantCount: 4, // 利用人数（デフォルト4人、品川の場合は2人に後で変更）
  });

  useEffect(() => {
    loadStatus();
    loadFacilities();
    loadReservationPeriods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadReservationPeriods = async () => {
    try {
      console.log('[Monitoring] 予約可能期間の取得開始...');

      // 各地区の予約可能期間を取得
      const results = await Promise.allSettled([
        apiClient.getReservationPeriod('shinagawa'),
        apiClient.getReservationPeriod('minato'),
      ]);

      // デフォルト値から開始
      const periods: {
        shinagawa: { maxDaysAhead: number; source: string; displayText: string } | null;
        minato: { maxDaysAhead: number; source: string; displayText: string } | null;
      } = {
        shinagawa: null,
        minato: null,
      };

      // 品川区の処理
      if (results[0].status === 'fulfilled' && results[0].value?.success) {
        const data = results[0].value.data;
        periods.shinagawa = {
          maxDaysAhead: data.maxDaysAhead,
          source: data.source,
          displayText: `約${Math.floor(data.maxDaysAhead / 30)}ヶ月先まで（${data.maxDaysAhead}日）`,
        };
        console.log('[Monitoring] ✅ 品川区の予約可能期間を取得:', periods.shinagawa);
      } else {
        // 失敗時はデフォルト値
        periods.shinagawa = {
          maxDaysAhead: 90,
          source: 'default',
          displayText: '約3ヶ月先まで（90日）',
        };
        console.warn('[Monitoring] ⚠️ 品川区の予約可能期間取得失敗、デフォルト使用:', results[0]);
      }

      // 港区の処理
      if (results[1].status === 'fulfilled' && results[1].value?.success) {
        const data = results[1].value.data;
        periods.minato = {
          maxDaysAhead: data.maxDaysAhead,
          source: data.source,
          displayText: `約${Math.floor(data.maxDaysAhead / 30)}ヶ月先まで（${data.maxDaysAhead}日）`,
        };
        console.log('[Monitoring] ✅ 港区の予約可能期間を取得:', periods.minato);
      } else {
        // 失敗時はデフォルト値
        periods.minato = {
          maxDaysAhead: 90,
          source: 'default',
          displayText: '約3ヶ月先まで（90日）',
        };
        console.warn('[Monitoring] ⚠️ 港区の予約可能期間取得失敗、デフォルト使用:', results[1]);
      }

      setReservationPeriods(periods);
      console.log('[Monitoring] 📅 予約可能期間設定完了:', periods);
    } catch (err) {
      console.error('[Monitoring] ❌ 予約可能期間の取得でエラー発生:', err);
      // エラーでもデフォルト値を設定
      setReservationPeriods({
        shinagawa: { maxDaysAhead: 90, source: 'default', displayText: '約3ヶ月先まで（90日）' },
        minato: { maxDaysAhead: 90, source: 'default', displayText: '約3ヶ月先まで（90日）' },
      });
    }
  };

  // 施設をグループ化してコンパクト表示用のデータを生成
  const groupFacilitiesByBuilding = (facilities: Array<{ id: string; name: string; courts?: string }>): BuildingInfo[] => {
    const grouped = new Map<string, {
      buildingName: string;
      courts: Array<{ courtId: string; courtName: string; fullName: string }>;
    }>();

    facilities.forEach(facility => {
      // 施設名から基本名とコート名を抽出
      // パターン: "しながわ中央公園 庭球場Ａ" または "麻布運動公園テニスコートＡ"
      // スペースあり・なし両方に対応し、全角・半角英数字に対応
      const match = facility.name.match(/^(.+?)(庭球場|テニスコート)\s*([A-ZＡ-Ｚa-zａ-ｚ０-９0-9]+)$/);

      if (match) {
        const [, buildingName, courtType, courtName] = match;
        // 建物名の末尾スペースを削除
        const trimmedBuildingName = buildingName.trim();

        // 全角英数字を半角に変換
        const normalizedCourtName = courtName
          .replace(/[Ａ-Ｚａ-ｚ]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
          .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

        const existing = grouped.get(trimmedBuildingName);
        const courtInfo = {
          courtId: facility.id,
          courtName: `${courtType}${normalizedCourtName}`,
          fullName: facility.name,
        };

        if (existing) {
          existing.courts.push(courtInfo);
        } else {
          grouped.set(trimmedBuildingName, {
            buildingName: trimmedBuildingName,
            courts: [courtInfo],
          });
        }
      } else {
        // パターンにマッチしない場合は単一コートとして扱う
        grouped.set(facility.name, {
          buildingName: facility.name,
          courts: [{
            courtId: facility.id,
            courtName: facility.name,
            fullName: facility.name,
          }],
        });
      }
    });

    return Array.from(grouped.values()).map(group => {
      // コート名をソート（A, B, C, D...の順）
      const sortedCourts = group.courts.sort((a, b) => {
        // コート名から英字部分を抽出してソート
        const aMatch = a.courtName.match(/([A-Z]+)(\d*)/);
        const bMatch = b.courtName.match(/([A-Z]+)(\d*)/);
        if (aMatch && bMatch) {
          const letterCompare = aMatch[1].localeCompare(bMatch[1]);
          if (letterCompare !== 0) return letterCompare;
          return (parseInt(aMatch[2]) || 0) - (parseInt(bMatch[2]) || 0);
        }
        return a.courtName.localeCompare(b.courtName);
      });

      // 建物IDは最初のコートIDから推測（品川区の場合は上4桁）
      const buildingId = sortedCourts[0].courtId.substring(0, 4);

      return {
        buildingId,
        buildingName: group.buildingName,
        courts: sortedCourts,
      };
    });
  };

  const loadFacilities = async () => {
    try {
      const [shinagawaRes, minatoRes] = await Promise.all([
        apiClient.getShinagawaFacilities(),
        apiClient.getMinatoFacilities(),
      ]);

      if (shinagawaRes.success && shinagawaRes.data?.length > 0) {
        console.log('品川区APIレスポンス:', shinagawaRes.data);

        const transformedData = shinagawaRes.data.map((f: { facilityId?: string; id?: string; facilityName?: string; name?: string; courts?: string }) => ({
          id: f.facilityId || f.id || '',
          name: f.facilityName || f.name || '',
          courts: f.courts,
        }));
        console.log('変換後データ:', transformedData);
        const groupedData = groupFacilitiesByBuilding(transformedData);
        console.log('グループ化後:', groupedData);
        setFacilities(prev => ({ ...prev, shinagawa: groupedData }));
      }
      if (minatoRes.success && minatoRes.data?.length > 0) {
        console.log('港区APIレスポンス:', minatoRes.data);

        const transformedData = minatoRes.data.map((f: { facilityId?: string; id?: string; facilityName?: string; name?: string; courts?: string }) => ({
          id: f.facilityId || f.id || '',
          name: f.facilityName || f.name || '',
          courts: f.courts,
        }));
        console.log('変換後データ:', transformedData);
        const groupedData = groupFacilitiesByBuilding(transformedData);
        console.log('グループ化後:', groupedData);
        setFacilities(prev => ({ ...prev, minato: groupedData }));
      }
    } catch (err) {
      console.error('Failed to load facilities:', err);
    }
  };

  const loadStatus = async () => {
    try {
      setIsLoading(true);
      const response = await apiClient.getMonitoringList();
      if (response.success && response.data && response.data.length > 0) {
        // 既存の監視がある場合はステータス表示
        const activeTargets = response.data.filter((t: MonitoringTarget) => t.status === 'monitoring');
        setMonitoringTargets(activeTargets);

        if (activeTargets.length > 0) {
          const hasShinagawa = activeTargets.some((t: MonitoringTarget) => t.site === 'shinagawa');
          const hasMinato = activeTargets.some((t: MonitoringTarget) => t.site === 'minato');
          const oldestTarget = activeTargets.reduce((oldest: MonitoringTarget, current: MonitoringTarget) =>
            (oldest.createdAt < current.createdAt) ? oldest : current
          );

          setStatus({
            isActive: true,
            sites: {
              shinagawa: hasShinagawa,
              minato: hasMinato,
            },
            startedAt: oldestTarget.createdAt,
            facilitiesCount: activeTargets.length,
          });
        } else {
          setStatus(null);
        }
      } else {
        setMonitoringTargets([]);
        setStatus(null);
      }
    } catch (err) {
      console.error('Failed to load status:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 🔥 重複チェック関数
  const isDateOverlap = (target: MonitoringTarget, checkDate: string): boolean => {
    if (target.startDate && target.endDate) {
      const targetStart = new Date(target.startDate);
      const targetEnd = new Date(target.endDate);
      const check = new Date(checkDate);
      return check >= targetStart && check <= targetEnd;
    }
    // 単一日付の場合
    return target.date === checkDate;
  };

  const hasOverlappingTimeSlots = (existing: string[], newSlots: string[]): boolean => {
    return existing.some(slot => newSlots.includes(slot));
  };

  const hasWeekdayOverlap = (existingWeekdays: number[] | undefined, newWeekdays: number[] | undefined): boolean => {
    // 両方とも未設定（undefined）の場合は重複とみなす
    if (existingWeekdays === undefined && newWeekdays === undefined) return true;

    // 片方だけ未定義の場合は重複とみなす（全曜日設定 vs 曜日指定）
    if (existingWeekdays === undefined || newWeekdays === undefined) return true;

    // 空配列チェック：空配列は「曜日未選択」を意味するので重複しない
    if (existingWeekdays.length === 0 || newWeekdays.length === 0) return false;

    // 両方に値がある場合：共通の曜日があるかチェック
    return existingWeekdays.some(day => newWeekdays.includes(day));
  };

  const checkDuplicates = (
    selectedFacilities: Array<{ id: string; name: string; site: string }>,
    existingTargets: MonitoringTarget[]
  ) => {
    const duplicates: Array<{
      facility: string;
      date: string;
      timeSlot: string;
      existingId: string;
    }> = [];

    selectedFacilities.forEach(facility => {
      config.timeSlots.forEach(timeSlot => {
        // 監視対象の日付リストを生成
        const targetDates: string[] = [];

        if (config.dateMode === 'single') {
          targetDates.push(config.startDate);
        } else if (config.dateMode === 'range' || config.dateMode === 'continuous') {
          // 期間内の全日付をチェック（最大30日分のみ表示用）
          const start = new Date(config.startDate);
          const end = new Date(config.endDate);
          const current = new Date(start);
          let count = 0;

          while (current <= end && count < 30) {
            targetDates.push(current.toISOString().split('T')[0]);
            current.setDate(current.getDate() + 1);
            count++;
          }
        }

        // 各日付について重複チェック
        targetDates.forEach(date => {
          const isDuplicate = existingTargets.some(existing =>
            existing.facilityId === facility.id &&
            existing.site === facility.site &&
            isDateOverlap(existing, date) &&
            hasOverlappingTimeSlots(existing.timeSlots || [], [timeSlot]) &&
            hasWeekdayOverlap(existing.selectedWeekdays, config.selectedWeekdays) // 曜日重複チェック追加
          );

          if (isDuplicate) {
            const existingTarget = existingTargets.find(e =>
              e.facilityId === facility.id &&
              e.site === facility.site &&
              isDateOverlap(e, date) &&
              hasOverlappingTimeSlots(e.timeSlots || [], [timeSlot]) &&
              hasWeekdayOverlap(e.selectedWeekdays, config.selectedWeekdays) // 曜日重複チェック追加
            );

            duplicates.push({
              facility: facility.name,
              date: date,
              timeSlot: timeSlot,
              existingId: existingTarget!.id
            });
          }
        });
      });
    });

    return duplicates;
  };

  // サブリクエスト数を計算する関数
  const calculateSubrequests = (targets: MonitoringTarget[], newConfig: typeof config): number => {
    // 既存のターゲット分を計算
    let existingRequests = 0;
    targets.forEach(target => {
      const timeSlotCount = target.timeSlots?.length || 1;

      if (target.dateMode === 'continuous' || target.dateMode === 'range') {
        // 週間取得を使用: 7日×時間帯数 / 7日 = 時間帯数（週単位で1リクエスト）
        // 予約可能期間が3ヶ月(90日)の場合: 90日 / 7 = 約13週
        const weeksToMonitor = 13; // 3ヶ月分
        existingRequests += weeksToMonitor * timeSlotCount;
      } else {
        // 単一日付: 1日×時間帯数
        existingRequests += timeSlotCount;
      }
    });

    // 新規追加分を計算
    let newRequests = 0;
    const newTimeSlotCount = newConfig.timeSlots.length;
    const newFacilityCount = newConfig.selectedFacilities.length;

    if (newConfig.dateMode === 'continuous') {
      // 継続監視: 3ヶ月分の週間取得
      const weeksToMonitor = 13;
      newRequests = newFacilityCount * weeksToMonitor * newTimeSlotCount;
    } else if (newConfig.dateMode === 'range') {
      // 期間指定: 指定期間の週数×時間帯数
      const start = new Date(newConfig.startDate);
      const end = new Date(newConfig.endDate);
      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      const weeks = Math.ceil(days / 7);
      newRequests = newFacilityCount * weeks * newTimeSlotCount;
    } else {
      // 単一日付: 1日×時間帯数×施設数
      newRequests = newFacilityCount * newTimeSlotCount;
    }

    const totalRequests = existingRequests + newRequests;
    console.log('[Subrequest] 既存:', existingRequests, '新規:', newRequests, '合計:', totalRequests);
    return totalRequests;
  };

  const handleStart = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (config.selectedFacilities.length === 0) {
        setError('少なくとも1つの施設を選択してください');
        return;
      }

      if (config.timeSlots.length === 0) {
        setError('少なくとも1つの時間帯を選択してください');
        return;
      }

      // 🔥 重複チェック
      console.log('[Monitoring] 重複チェック開始...');
      console.log('[Monitoring] 選択施設数:', config.selectedFacilities.length);
      console.log('[Monitoring] 選択時間帯数:', config.timeSlots.length);
      console.log('[Monitoring] 選択施設一覧:', config.selectedFacilities);

      const existingResponse = await apiClient.getMonitoringList();
      const existingTargets = existingResponse.data || [];
      console.log('[Monitoring] 既存ターゲット数:', existingTargets.length);

      // 🔥 サブリクエスト数チェック
      const totalSubrequests = calculateSubrequests(existingTargets, config);
      if (totalSubrequests > 1000) {
        const over = totalSubrequests - 1000;
        const confirmed = confirm(
          `⚠️ Cloudflare Workers のサブリクエスト上限を超えています！\n\n` +
          `現在の設定では1回の監視で約${totalSubrequests}リクエスト必要です。\n` +
          `（上限: 1000リクエスト、超過: ${over}リクエスト）\n\n` +
          `このまま続行すると監視が正常に動作しない可能性があります。\n\n` +
          `【推奨対応】\n` +
          `・監視施設数を減らす\n` +
          `・時間帯を絞る\n` +
          `・監視期間を短くする\n\n` +
          `それでも続行しますか？`
        );

        if (!confirmed) {
          console.log('[Monitoring] サブリクエスト超過によりキャンセル');
          setIsLoading(false);
          return;
        }
      } else if (totalSubrequests > 800) {
        // 80%を超えたら警告
        const confirmed = confirm(
          `⚠️ サブリクエスト数が上限に近づいています\n\n` +
          `現在の設定では1回の監視で約${totalSubrequests}リクエスト必要です。\n` +
          `（上限: 1000リクエスト、残り: ${1000 - totalSubrequests}リクエスト）\n\n` +
          `続行しますか？`
        );

        if (!confirmed) {
          console.log('[Monitoring] ユーザーがキャンセル');
          setIsLoading(false);
          return;
        }
      }

      const duplicates = checkDuplicates(config.selectedFacilities, existingTargets);

      if (duplicates.length > 0) {
        console.log(`[Monitoring] 重複検出: ${duplicates.length}件`);

        // 重複リストを表示（最初の5件のみ）
        const duplicateList = duplicates
          .slice(0, 5)
          .map(d => `・${d.facility} ${d.date} ${d.timeSlot}`)
          .join('\n');

        const more = duplicates.length > 5 ? `\n... 他${duplicates.length - 5}件` : '';

        const confirmed = confirm(
          `⚠️ 以下の監視設定は既に存在します:\n\n${duplicateList}${more}\n\n` +
          `重複している監視は既存のもので継続します。\n` +
          `それでも続行しますか？\n\n` +
          `※重複する監視は2重に実行されません（Workers側で自動スキップ）`
        );

        if (!confirmed) {
          console.log('[Monitoring] ユーザーがキャンセル');
          setIsLoading(false);
          return;
        }
      } else {
        console.log('[Monitoring] 重複なし、登録を続行');
      }

      console.log('[Monitoring] 🚀 バッチ登録開始...');

      // バッチ登録用のデータを準備
      const targets = config.selectedFacilities.map((facility, index) => {
        console.log(`[Monitoring] 施設 ${index + 1}/${config.selectedFacilities.length}: ${facility.name} (ID: ${facility.id})`);

        const monitoringData: {
          site: 'shinagawa' | 'minato';
          facilityId: string;
          facilityName: string;
          date?: string;
          startDate?: string;
          endDate?: string;
          dateMode?: 'single' | 'range' | 'continuous';
          timeSlots: string[];
          selectedWeekdays?: number[];
          includeHolidays?: boolean | 'only';
          autoReserve: boolean;
          applicantCount?: number;
        } = {
          site: facility.site,
          facilityId: facility.id,
          facilityName: facility.name,
          timeSlots: config.timeSlots,
          selectedWeekdays: config.selectedWeekdays,
          autoReserve: true,
          dateMode: config.dateMode,
          includeHolidays: config.includeHolidays,
          applicantCount: config.applicantCount,
        };

        // 日付モードに応じて設定
        if (config.dateMode === 'range') {
          monitoringData.startDate = config.startDate;
          monitoringData.endDate = config.endDate;
        } else if (config.dateMode === 'single') {
          monitoringData.date = config.startDate;
        }
        // 継続監視の場合は何も設定しない（バックエンドが自動設定）

        return monitoringData;
      });

      console.log(`[Monitoring] バッチAPI呼び出し: ${targets.length}件を一括送信`);
      const result = await apiClient.createMonitoringBatch(targets);
      console.log('[Monitoring] バッチ登録完了', result);

      // 成功・スキップ・失敗をカウント
      const successCount = result.data?.created || 0;
      const skippedCount = result.data?.errors?.filter((e: { error: string }) => e.error.includes('duplicate')).length || 0;
      const totalFacilities = config.selectedFacilities.length;

      // ステータス更新
      const hasShinagawa = config.selectedFacilities.some(f => f.site === 'shinagawa');
      const hasMinato = config.selectedFacilities.some(f => f.site === 'minato');

      setStatus({
        isActive: true,
        sites: {
          shinagawa: hasShinagawa,
          minato: hasMinato,
        },
        startedAt: Date.now(),
        facilitiesCount: totalFacilities,
      });

      const siteNames = [];
      if (hasShinagawa) siteNames.push('品川区');
      if (hasMinato) siteNames.push('港区');

      // 監視リストを再ロード
      await loadStatus();

      // フォームを完全リセット（初期状態に戻す）
      setConfig({
        sites: {
          shinagawa: true,
          minato: false,
        },
        selectedRegion: 'shinagawa',
        selectedFacilities: [],
        dateMode: 'range',
        startDate: (() => {
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          return tomorrow.toISOString().split('T')[0];
        })(),
        endDate: (() => {
          const weekLater = new Date();
          weekLater.setDate(weekLater.getDate() + 8);
          return weekLater.toISOString().split('T')[0];
        })(),
        selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
        includeHolidays: true,
        timeSlots: [], // 🔥 時間帯を空に初期化
        applicantCount: 4,
      });

      // ウィザードを閉じる
      setShowWizard(false);
      setCurrentStep(1);

      // 結果メッセージ
      let message = `${siteNames.join('・')}の監視を追加しました\n`;
      message += `- 新規追加: ${successCount}施設\n`;
      if (skippedCount > 0) {
        message += `- スキップ（重複）: ${skippedCount}施設\n`;
      }
      message += `\n1分ごとに自動監視を開始します。`;

      alert(message);

    } catch (err) {
      const error = err as Error & { response?: { data?: { error?: string } } };
      console.error('Start monitoring error:', error);

      // エラーメッセージを解析
      const errorMessage = error?.response?.data?.error || error?.message || '監視の開始に失敗しました';

      if (errorMessage.includes('credentials not found') || errorMessage.includes('Credentials not found')) {
        setError('❗️ 認証情報が未設定です。まず「設定」タブで選択した地区の利用者ID・パスワードを保存してください。');
      } else {
        setError(`監視の開始に失敗: ${errorMessage}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    if (!confirm('すべての監視を停止しますか？\n\n停止すると、設定されている全ての監視対象が削除されます。')) return;

    try {
      setIsLoading(true);
      setError(null);

      console.log('[Stop] Fetching monitoring list...');
      const response = await apiClient.getMonitoringList();
      console.log('[Stop] Response:', response);

      if (response.success && response.data && response.data.length > 0) {
        console.log(`[Stop] Found ${response.data.length} monitoring targets`);

        // すべての監視を削除
        const deletePromises = response.data.map((target: MonitoringTarget) => {
          console.log(`[Stop] Deleting target: ${target.id}`);
          return apiClient.deleteMonitoring(target.id);
        });

        const results = await Promise.all(deletePromises);
        console.log('[Stop] Delete results:', results);

        setStatus(null);
        alert('監視を停止しました');

        // 念のため再読み込み
        await loadStatus();
      } else {
        console.log('[Stop] No monitoring targets found');
        setStatus(null);
        alert('停止する監視が見つかりませんでした');
      }
    } catch (err) {
      const error = err as Error & { response?: { data?: { error?: string } } };
      console.error('Stop monitoring error:', error);
      const errorMessage = error?.response?.data?.error || error?.message || '不明なエラー';
      setError(`監視の停止に失敗しました: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  // ウィザードナビゲーション関数
  const handleStartWizard = () => {
    // フォームを完全リセット（初期状態に戻す）
    setConfig({
      sites: {
        shinagawa: true,
        minato: false,
      },
      selectedRegion: 'shinagawa',
      selectedFacilities: [],
      dateMode: 'range',
      startDate: (() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
      })(),
      endDate: (() => {
        const weekLater = new Date();
        weekLater.setDate(weekLater.getDate() + 8);
        return weekLater.toISOString().split('T')[0];
      })(),
      selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
      includeHolidays: true,
      timeSlots: [], // 🔥 時間帯を空に初期化
      applicantCount: 4,
    });
    setShowWizard(true);
    setCurrentStep(1);
    setError(null);
  };

  const handleCancelWizard = () => {
    if (confirm('設定をキャンセルしますか？入力内容は保持されます。')) {
      setShowWizard(false);
      setCurrentStep(1);
    }
  };

  const handleNextStep = () => {
    // バリデーション
    if (currentStep === 1) {
      // Step 1: 施設選択
      if (config.selectedFacilities.length === 0) {
        setError('少なくとも1つの施設を選択してください');
        return;
      }
    } else if (currentStep === 2) {
      // Step 2: 日時設定
      // 日付はデフォルトが入っているので基本的にOKだが、期間チェックなどあればここ
    } else if (currentStep === 3) {
      // Step 3: 詳細設定（時間帯）
      if (config.timeSlots.length === 0) {
        setError('少なくとも1つの時間帯を選択してください');
        return;
      }
    }

    setError(null);
    setCurrentStep(currentStep + 1);
  };

  const handlePrevStep = () => {
    setError(null);
    setCurrentStep(currentStep - 1);
  };

  const canProceedStep1 = config.timeSlots.length > 0;
  const canProceedStep2 = config.selectedFacilities.length > 0;

  return (
    <div className="max-w-4xl mx-auto">
      {/* ヘッダー */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">自動監視・予約</h1>
        <p className="text-sm text-gray-600 mt-1">
          全施設を一括監視して空き枠を自動予約します
        </p>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
          <button onClick={() => setError(null)} className="text-xs text-red-600 underline mt-1">
            閉じる
          </button>
        </div>
      )}

      {/* ステータスカード */}
      {status?.isActive ? (
        <div className="bg-white rounded-lg shadow-lg p-6 border-2 border-emerald-500 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
              <h2 className="text-xl font-bold text-gray-900">監視中</h2>
            </div>
            <div className="flex gap-2">
              {status.sites.shinagawa && (
                <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold">
                  品川区
                </span>
              )}
              {status.sites.minato && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                  港区
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-600 mb-1">監視施設数</p>
              <p className="text-2xl font-bold text-gray-900">{status.facilitiesCount}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm text-gray-600 mb-4">
            <span>
              開始時刻: {status.startedAt ? new Date(status.startedAt).toLocaleString('ja-JP') : '-'}
            </span>
          </div>

          <div className="mb-3 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-blue-800">
              ℹ️ 継続的に翌日以降の空き枠を監視します。監視を終了する場合は下のボタンを押してください。
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleStop}
              disabled={isLoading}
              className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? '停止中...' : 'すべての監視を停止'}
            </button>
          </div>
        </div>
      ) : null}

      {/* 監視中のターゲット一覧（グループ化表示） */}
      {monitoringTargets.length > 0 && (() => {
        // 🔥 設定グループ化ロジック
        // 同じ条件（曜日・時間帯・祝日設定）でグループ化
        const groupedSettings = new Map<string, {
          targets: MonitoringTarget[];
          timeSlots: string[];
          selectedWeekdays: number[];
          includeHolidays: boolean | 'only';
          sites: Set<'shinagawa' | 'minato'>;
        }>();

        monitoringTargets.forEach(target => {
          // グループキーを生成（曜日・時間帯・祝日設定で一意に識別）
          const weekdays = target.selectedWeekdays?.sort().join(',') || 'all';
          const timeSlots = target.timeSlots?.sort().join(',') || 'all';
          const holidays = String(target.includeHolidays ?? 'true');
          const groupKey = `${weekdays}|${timeSlots}|${holidays}`;

          const existing = groupedSettings.get(groupKey);
          if (existing) {
            existing.targets.push(target);
            existing.sites.add(target.site);
          } else {
            groupedSettings.set(groupKey, {
              targets: [target],
              timeSlots: target.timeSlots || [],
              selectedWeekdays: target.selectedWeekdays || [0, 1, 2, 3, 4, 5, 6],
              includeHolidays: target.includeHolidays ?? true,
              sites: new Set([target.site]),
            });
          }
        });

        const toggleGroup = (key: string) => {
          setExpandedGroups(prev => {
            const newSet = new Set(prev);
            if (newSet.has(key)) {
              newSet.delete(key);
            } else {
              newSet.add(key);
            }
            return newSet;
          });
        };

        return (
          <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-900">監視中の設定（{groupedSettings.size}グループ・{monitoringTargets.length}施設）</h3>
              <button
                onClick={async () => {
                  if (confirm(`全${monitoringTargets.length}件の監視設定を削除しますか？\n\nこの操作は取り消せません。`)) {
                    try {
                      setIsLoading(true);
                      const deletePromises = monitoringTargets.map((target) =>
                        apiClient.deleteMonitoring(target.id)
                      );
                      await Promise.all(deletePromises);
                      await loadStatus();
                      alert('全ての監視設定を削除しました');
                    } catch (err) {
                      console.error('Batch delete error:', err);
                      setError('一括削除に失敗しました');
                    } finally {
                      setIsLoading(false);
                    }
                  }
                }}
                disabled={isLoading}
                className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? '削除中...' : '全て削除'}
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from(groupedSettings.entries()).map(([groupKey, group]) => {
                const isExpanded = expandedGroups.has(groupKey);

                // グループのタイトル生成
                let title = '';
                const weekdayLabels = group.selectedWeekdays.map(d => ['日', '月', '火', '水', '木', '金', '土'][d]);

                if (group.selectedWeekdays.length === 7) {
                  title = '毎日';
                } else if (group.selectedWeekdays.length === 5 &&
                  JSON.stringify(group.selectedWeekdays) === JSON.stringify([1, 2, 3, 4, 5])) {
                  title = '平日';
                } else if (group.selectedWeekdays.length === 2 &&
                  JSON.stringify(group.selectedWeekdays) === JSON.stringify([0, 6])) {
                  title = '週末';
                } else {
                  title = weekdayLabels.join('・');
                }

                if (group.includeHolidays === 'only') {
                  title = '祝日のみ';
                } else if (group.includeHolidays === false && title === '平日') {
                  title = '平日（祝日除外）';
                } else if (group.includeHolidays === true && title === '週末') {
                  title = '週末・祝日';
                }

                return (
                  <div key={groupKey} className="bg-white border-2 border-gray-200 rounded-xl shadow-md hover:shadow-xl hover:border-emerald-400 transition-all duration-200">
                    {/* カードヘッダー */}
                    <div className="bg-linear-to-r from-emerald-50 to-teal-50 p-4 rounded-t-xl border-b border-gray-200">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="text-xl font-bold text-gray-900">{title}</h3>
                        <div className="flex items-center gap-1">
                          {Array.from(group.sites).map(site => (
                            <span
                              key={site}
                              className={`px-2 py-1 rounded-full text-xs font-bold ${site === 'shinagawa' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                                }`}
                            >
                              {site === 'shinagawa' ? '品川' : '港区'}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-flex items-center gap-1 px-3 py-1 bg-white border border-gray-300 rounded-full text-sm font-semibold text-gray-700">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          {group.targets.length}施設
                        </span>
                      </div>
                    </div>

                    {/* カード本文 */}
                    <div className="p-4">
                      <div className="space-y-3 mb-4">
                        {/* 時間帯 */}
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 text-sm shrink-0">🕐</span>
                          <div className="flex-1">
                            <div className="text-xs text-gray-600 mb-1">時間帯</div>
                            <div className="flex flex-wrap gap-1">
                              {group.timeSlots.length === 6 ? (
                                <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                                  全時間帯 (9:00-21:00)
                                </span>
                              ) : (
                                group.timeSlots.map((slot, idx) => (
                                  <span
                                    key={idx}
                                    className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-medium border border-blue-200"
                                  >
                                    {slot}
                                  </span>
                                ))
                              )}
                            </div>
                          </div>
                        </div>

                        {/* 曜日 */}
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 text-sm shrink-0">📆</span>
                          <div className="flex-1">
                            <div className="text-xs text-gray-600 mb-1">曜日</div>
                            <div className="text-sm font-medium text-gray-900">
                              {group.selectedWeekdays.length === 7 ? '毎日' : weekdayLabels.join('・')}
                            </div>
                          </div>
                        </div>

                        {/* 祝日 */}
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 text-sm shrink-0">🎌</span>
                          <div className="flex-1">
                            <div className="text-xs text-gray-600 mb-1">祝日</div>
                            <div className="text-sm font-medium text-gray-900">
                              {group.includeHolidays === 'only' ? '祝日のみ監視' :
                                group.includeHolidays === true ? '祝日を含む' : '祝日を除外'}
                            </div>
                          </div>
                        </div>

                        {/* 期間 */}
                        <div className="flex items-start gap-2">
                          <span className="text-gray-500 text-sm shrink-0">📅</span>
                          <div className="flex-1">
                            <div className="text-xs text-gray-600 mb-1">監視期間</div>
                            <div className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-800 rounded text-xs font-semibold">
                              <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                              継続監視中
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* 展開ボタン */}
                      <button
                        onClick={() => toggleGroup(groupKey)}
                        className="w-full px-3 py-2 mb-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition font-medium flex items-center justify-center gap-2"
                      >
                        {isExpanded ? (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                            </svg>
                            施設一覧を閉じる
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                            施設一覧を表示 ({group.targets.length}件)
                          </>
                        )}
                      </button>

                      {/* 展開時の施設一覧 */}
                      {isExpanded && (
                        <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                          <h4 className="text-xs font-semibold text-gray-700 mb-2">監視中の施設</h4>
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {group.targets.map(target => (
                              <div key={target.id} className="flex items-center justify-between p-2 bg-white rounded text-xs hover:bg-gray-100 transition border border-gray-200">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold shrink-0 ${target.site === 'shinagawa' ? 'bg-emerald-500 text-white' : 'bg-blue-500 text-white'
                                    }`}>
                                    {target.site === 'shinagawa' ? '品' : '港'}
                                  </span>
                                  <span className="text-gray-900 truncate font-medium">{target.facilityName}</span>
                                </div>
                                <button
                                  onClick={async () => {
                                    if (confirm(`${target.facilityName}の監視を削除しますか？`)) {
                                      try {
                                        setIsLoading(true);
                                        await apiClient.deleteMonitoring(target.id);
                                        await loadStatus();
                                        alert('監視を削除しました');
                                      } catch (err) {
                                        console.error('Delete monitoring error:', err);
                                        setError('監視の削除に失敗しました');
                                      } finally {
                                        setIsLoading(false);
                                      }
                                    }
                                  }}
                                  disabled={isLoading}
                                  className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition disabled:opacity-50 shrink-0 ml-2 font-medium"
                                >
                                  削除
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* アクションボタン */}
                      <div className="grid grid-cols-2 gap-2">
                        {/* 全件停止/再開ボタン */}
                        {group.targets.every(t => t.status === 'paused' || t.status === 'failed') ? (
                          <button
                            onClick={async () => {
                              if (confirm(`このグループの全${group.targets.length}施設の監視を再開しますか？\n\n対象:\n${group.targets.slice(0, 5).map(t => `・${t.facilityName}`).join('\n')}${group.targets.length > 5 ? `\n...他${group.targets.length - 5}施設` : ''}`)) {
                                try {
                                  setIsLoading(true);
                                  const resumePromises = group.targets.map((target) =>
                                    apiClient.updateMonitoring(target.id, { status: 'active' as const })
                                  );
                                  await Promise.all(resumePromises);
                                  await loadStatus();
                                  alert(`${group.targets.length}施設の監視を再開しました`);
                                } catch (err) {
                                  console.error('Group resume error:', err);
                                  setError('グループ再開に失敗しました');
                                } finally {
                                  setIsLoading(false);
                                }
                              }
                            }}
                            disabled={isLoading}
                            className="px-3 py-2 text-sm bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200 transition font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            全件再開
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              if (confirm(`このグループの全${group.targets.length}施設の監視を停止しますか？\n\n対象:\n${group.targets.slice(0, 5).map(t => `・${t.facilityName}`).join('\n')}${group.targets.length > 5 ? `\n...他${group.targets.length - 5}施設` : ''}\n\n※停止中は空き枠の監視・予約が行われません。`)) {
                                try {
                                  setIsLoading(true);
                                  const pausePromises = group.targets.map((target) =>
                                    apiClient.updateMonitoring(target.id, { status: 'paused' as const })
                                  );
                                  await Promise.all(pausePromises);
                                  await loadStatus();
                                  alert(`${group.targets.length}施設の監視を停止しました`);
                                } catch (err) {
                                  console.error('Group pause error:', err);
                                  setError('グループ停止に失敗しました');
                                } finally {
                                  setIsLoading(false);
                                }
                              }
                            }}
                            disabled={isLoading}
                            className="px-3 py-2 text-sm bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            全件停止
                          </button>
                        )}

                        {/* 全件削除ボタン */}
                        <button
                          onClick={async () => {
                            if (confirm(`このグループの全${group.targets.length}施設の監視を削除しますか？\n\n対象:\n${group.targets.slice(0, 5).map(t => `・${t.facilityName}`).join('\n')}${group.targets.length > 5 ? `\n...他${group.targets.length - 5}施設` : ''}\n\n⚠️ この操作は取り消せません。`)) {
                              try {
                                setIsLoading(true);
                                const deletePromises = group.targets.map((target) =>
                                  apiClient.deleteMonitoring(target.id)
                                );
                                await Promise.all(deletePromises);
                                await loadStatus();
                                alert(`${group.targets.length}施設の監視を削除しました`);
                              } catch (err) {
                                console.error('Group delete error:', err);
                                setError('グループ削除に失敗しました');
                              } finally {
                                setIsLoading(false);
                              }
                            }
                          }}
                          disabled={isLoading}
                          className="px-3 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          全件削除
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* 監視追加フォーム */}
      <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
        {!showWizard ? (
          // ウィザード開始画面
          <div className="text-center">
            <div className="text-6xl mb-4">🎾</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {monitoringTargets.length > 0 ? '新しい監視を追加' : '監視を開始しましょう'}
            </h2>
            <p className="text-gray-600 mb-6">
              {monitoringTargets.length > 0
                ? '異なる条件で複数の監視を設定できます（例: 平日夜、土日全日）'
                : '3つのステップで簡単に設定できます'}
            </p>
            <button
              onClick={handleStartWizard}
              className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold text-lg"
            >
              {monitoringTargets.length > 0 ? '監視を追加する' : '監視設定を開始する'}
            </button>
          </div>
        ) : (
          // ウィザード表示（2カラムレイアウト）
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* 左側: ウィザードフォーム */}
            <div className="lg:col-span-2">
              {/* プログレスバー */}
              <div className="mb-8">
                <div className="flex items-center justify-center mb-4">
                  <div className="text-sm font-medium text-gray-600">
                    ステップ {currentStep} / 3
                  </div>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep >= 1 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                      }`}>
                      1
                    </div>
                    <span className={`text-sm font-medium ${currentStep >= 1 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      施設選択
                    </span>
                  </div>
                  <div className={`h-0.5 w-16 ${currentStep >= 2 ? 'bg-emerald-600' : 'bg-gray-200'}`}></div>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep >= 2 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                      }`}>
                      2
                    </div>
                    <span className={`text-sm font-medium ${currentStep >= 2 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      日時設定
                    </span>
                  </div>
                  <div className={`h-0.5 w-16 ${currentStep >= 3 ? 'bg-emerald-600' : 'bg-gray-200'}`}></div>
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${currentStep >= 3 ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-400'
                      }`}>
                      3
                    </div>
                    <span className={`text-sm font-medium ${currentStep >= 3 ? 'text-emerald-600' : 'text-gray-400'}`}>
                      時間帯
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                {/* ステップ1: 施設選択 */}
                {currentStep === 1 && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-4">どの施設を監視しますか？</h3>

                    {/* 自治体選択 */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        自治体を選択
                      </label>
                      <div className="flex gap-4">
                        <button
                          type="button"
                          onClick={() => {
                            if (config.selectedRegion !== 'shinagawa') {
                              // 切り替え時に選択済み施設と時間帯をクリア
                              setConfig({
                                ...config,
                                selectedRegion: 'shinagawa',
                                selectedFacilities: [],
                                timeSlots: []
                              });
                            }
                          }}
                          className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-center gap-3 ${config.selectedRegion === 'shinagawa'
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-md'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:bg-emerald-50/50'
                            }`}
                        >
                          <span className="text-2xl">🌲</span>
                          <span className="font-bold">品川区</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (config.selectedRegion !== 'minato') {
                              setConfig({
                                ...config,
                                selectedRegion: 'minato',
                                selectedFacilities: [],
                                timeSlots: []
                              });
                            }
                          }}
                          className={`flex-1 py-3 px-4 rounded-xl border-2 transition-all duration-200 flex items-center justify-center gap-3 ${config.selectedRegion === 'minato'
                            ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-md'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-blue-200 hover:bg-blue-50/50'
                            }`}
                        >
                          <span className="text-2xl">🗼</span>
                          <span className="font-bold">港区</span>
                        </button>
                      </div>
                    </div>

                    <label className="block text-sm font-medium text-gray-700 mb-3">
                      監視する施設（複数選択可）
                    </label>

                    {/* 施設リスト */}
                    <div className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex justify-between items-center">
                        <span className="text-xs font-bold text-gray-500">
                          {config.selectedRegion === 'shinagawa' ? '品川区の施設' : '港区の施設'}
                        </span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              const targetFacilities = config.selectedRegion === 'shinagawa' ? facilities.shinagawa : facilities.minato;
                              const allItems = targetFacilities.flatMap(b => b.courts.map(c => ({
                                site: config.selectedRegion,
                                id: c.courtId,
                                name: c.fullName
                              })));
                              setConfig({ ...config, selectedFacilities: allItems });
                            }}
                            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-600 font-medium"
                          >
                            全選択
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfig({ ...config, selectedFacilities: [] })}
                            className="text-xs px-2 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-600 font-medium"
                          >
                            解除
                          </button>
                        </div>
                      </div>

                      <div className="max-h-96 overflow-y-auto p-3 space-y-3 bg-white">
                        {(config.selectedRegion === 'shinagawa' ? facilities.shinagawa : facilities.minato).map((building) => (
                          <div key={building.buildingId} className="border-b border-gray-100 last:border-0 pb-3 last:pb-0">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="text-sm font-bold text-gray-800">{building.buildingName}</h4>
                              <button
                                type="button"
                                onClick={() => {
                                  const buildingCourtIds = building.courts.map(c => c.courtId);
                                  const allSelected = buildingCourtIds.every(cid =>
                                    config.selectedFacilities.some(f => f.id === cid)
                                  );

                                  if (allSelected) {
                                    setConfig({
                                      ...config,
                                      selectedFacilities: config.selectedFacilities.filter(
                                        f => !buildingCourtIds.includes(f.id)
                                      )
                                    });
                                  } else {
                                    const newItems = building.courts
                                      .filter(c => !config.selectedFacilities.some(f => f.id === c.courtId))
                                      .map(c => ({
                                        site: config.selectedRegion,
                                        id: c.courtId,
                                        name: c.fullName
                                      }));
                                    setConfig({
                                      ...config,
                                      selectedFacilities: [...config.selectedFacilities, ...newItems]
                                    });
                                  }
                                }}
                                className="text-[10px] px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition"
                              >
                                {building.courts.length}コートを一括
                              </button>
                            </div>
                            <div className="grid grid-cols-2 gap-2 pl-2">
                              {building.courts.map((court) => (
                                <label
                                  key={court.courtId}
                                  className={`flex items-center gap-2 p-2 rounded cursor-pointer transition text-xs border ${config.selectedFacilities.some(f => f.id === court.courtId)
                                    ? 'bg-emerald-50 border-emerald-200'
                                    : 'hover:bg-gray-50 border-transparent'
                                    }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={config.selectedFacilities.some(f => f.id === court.courtId)}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setConfig({
                                          ...config,
                                          selectedFacilities: [
                                            ...config.selectedFacilities,
                                            { site: config.selectedRegion, id: court.courtId, name: court.fullName }
                                          ]
                                        });
                                      } else {
                                        setConfig({
                                          ...config,
                                          selectedFacilities: config.selectedFacilities.filter(f => f.id !== court.courtId)
                                        });
                                      }
                                    }}
                                    className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                                  />
                                  <span className="text-gray-900 truncate">{court.courtName}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                        {(config.selectedRegion === 'shinagawa' ? facilities.shinagawa : facilities.minato).length === 0 && (
                          <div className="text-center py-8 text-gray-500 text-sm">
                            施設情報の読み込み中...
                          </div>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-gray-500 mt-2">
                      ※ 選択した{config.selectedFacilities.length}施設の全コートが監視対象になります
                    </p>
                  </div>
                )}

                {/* ステップ2: 日時設定 */}
                {currentStep === 2 && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-4">いつ予約したいですか？</h3>

                    {/* 監視期間の設定 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        監視期間
                      </label>

                      {/* 期間モード選択 */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, dateMode: 'single' })}
                          className={`px-3 py-2 text-sm rounded-lg transition ${config.dateMode === 'single'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                          単一日付
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, dateMode: 'range' })}
                          className={`px-3 py-2 text-sm rounded-lg transition ${config.dateMode === 'range'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                          期間指定
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, dateMode: 'continuous' })}
                          className={`px-3 py-2 text-sm rounded-lg transition ${config.dateMode === 'continuous'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                        >
                          継続監視
                        </button>
                      </div>

                      {/* 日付入力 */}
                      {config.dateMode === 'single' && (
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">監視日</label>
                          <input
                            type="date"
                            value={config.startDate}
                            min={(() => {
                              const tomorrow = new Date();
                              tomorrow.setDate(tomorrow.getDate() + 1);
                              return tomorrow.toISOString().split('T')[0];
                            })()}
                            max={(() => {
                              const maxDate = new Date();
                              const selectedSites = [config.selectedRegion];
                              const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                              const maxDays = Math.max(...periods, 90);
                              maxDate.setDate(maxDate.getDate() + maxDays);
                              return maxDate.toISOString().split('T')[0];
                            })()}
                            onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                          />
                        </div>
                      )}

                      {config.dateMode === 'range' && (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">開始日</label>
                            <input
                              type="date"
                              value={config.startDate}
                              min={(() => {
                                const tomorrow = new Date();
                                tomorrow.setDate(tomorrow.getDate() + 1);
                                return tomorrow.toISOString().split('T')[0];
                              })()}
                              max={(() => {
                                const maxDate = new Date();
                                const selectedSites = [config.selectedRegion];
                                const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                                const maxDays = Math.max(...periods, 90);
                                maxDate.setDate(maxDate.getDate() + maxDays);
                                return maxDate.toISOString().split('T')[0];
                              })()}
                              onChange={(e) => setConfig({ ...config, startDate: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">終了日</label>
                            <input
                              type="date"
                              value={config.endDate}
                              min={config.startDate}
                              max={(() => {
                                const maxDate = new Date();
                                const selectedSites = [config.selectedRegion];
                                const periods = selectedSites.map(site => reservationPeriods[site]?.maxDaysAhead || 90);
                                const maxDays = Math.max(...periods, 90);
                                maxDate.setDate(maxDate.getDate() + maxDays);
                                return maxDate.toISOString().split('T')[0];
                              })()}
                              onChange={(e) => setConfig({ ...config, endDate: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      )}

                      {config.dateMode === 'continuous' && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-sm text-blue-800">
                            ℹ️ 翌日から予約可能な期間まで継続的に監視します（停止するまで継続）
                          </p>
                          <p className="text-xs text-blue-700 mt-2">
                            ※ 現在の予約受付期間に従って自動的に調整されます
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-gray-600 mt-2">
                        {config.dateMode === 'single' && '※ 指定した1日のみ監視します'}
                        {config.dateMode === 'range' && '※ 指定した期間内の全日程を監視します'}
                        {config.dateMode === 'continuous' && '※ 長期間の自動監視に最適です'}
                      </p>
                    </div>
                  </div>
                )}

                {/* ステップ3: 時間帯・詳細設定 */}
                {currentStep === 3 && (
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 mb-4">監視する時間帯と条件を設定</h3>

                    {/* 監視する時間帯（複数選択可） */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        監視する時間帯（複数選択可）
                      </label>

                      {/* プリセットボタン */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, timeSlots: SITE_TIME_SLOTS[config.selectedRegion].map(t => t.id) })}
                          className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                        >
                          全て選択
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, timeSlots: [] })}
                          className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                        >
                          選択解除
                        </button>
                      </div>

                      {/* チェックボックス */}
                      <div className="grid grid-cols-2 gap-2">
                        {SITE_TIME_SLOTS[config.selectedRegion].map((slot) => (
                          <label
                            key={slot.id}
                            className="flex items-center gap-2 p-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition"
                          >
                            <input
                              type="checkbox"
                              checked={config.timeSlots.includes(slot.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setConfig({ ...config, timeSlots: [...config.timeSlots, slot.id] });
                                } else {
                                  setConfig({ ...config, timeSlots: config.timeSlots.filter(t => t !== slot.id) });
                                }
                              }}
                              className="w-4 h-4 text-emerald-600 rounded focus:ring-2 focus:ring-emerald-500"
                            />
                            <span className="text-sm text-gray-900">{slot.label}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        ※ {config.selectedRegion === 'shinagawa' ? '品川区' : '港区'}の枠で監視します（{config.timeSlots.length}個選択中）
                      </p>
                    </div>

                    <h4 className="text-sm font-bold text-gray-700 mb-3 border-t border-gray-200 pt-4">その他の絞り込み条件</h4>

                    {/* 曜日指定 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        監視する曜日（複数選択可）
                      </label>

                      {/* プリセットボタン */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, selectedWeekdays: [0, 1, 2, 3, 4, 5, 6] })}
                          className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                        >
                          全て選択
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, selectedWeekdays: [1, 2, 3, 4, 5] })}
                          className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition"
                        >
                          平日のみ
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, selectedWeekdays: [0, 6] })}
                          className="px-3 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition"
                        >
                          週末のみ
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfig({ ...config, selectedWeekdays: [] })}
                          className="px-3 py-1 text-xs bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition"
                        >
                          選択解除
                        </button>
                      </div>

                      {/* 曜日チェックボックス */}
                      <div className="grid grid-cols-7 gap-2">
                        {WEEKDAYS.map((weekday) => (
                          <label
                            key={weekday.id}
                            className={`flex flex-col items-center justify-center p-3 border rounded-lg cursor-pointer transition ${config.selectedWeekdays.includes(weekday.id)
                              ? 'bg-emerald-50 border-emerald-500 shadow-sm'
                              : 'border-gray-300 hover:bg-gray-50'
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={config.selectedWeekdays.includes(weekday.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setConfig({ ...config, selectedWeekdays: [...config.selectedWeekdays, weekday.id].sort() });
                                } else {
                                  setConfig({ ...config, selectedWeekdays: config.selectedWeekdays.filter(d => d !== weekday.id) });
                                }
                              }}
                              className="sr-only"
                            />
                            <span className={`text-lg font-bold ${config.selectedWeekdays.includes(weekday.id) ? 'text-emerald-600' : 'text-gray-600'
                              }`}>
                              {weekday.label}
                            </span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        ※ 選択した曜日のみ監視します（{config.selectedWeekdays.length}曜日選択中）
                      </p>
                    </div>

                    {/* 祝日設定 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-3">
                        祝日の扱い
                      </label>

                      {/* プリセットボタン */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({
                              ...config,
                              selectedWeekdays: [1, 2, 3, 4, 5],
                              includeHolidays: false
                            });
                          }}
                          className="px-3 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition"
                        >
                          平日のみ（祝日除く）
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({
                              ...config,
                              selectedWeekdays: [0, 6],
                              includeHolidays: true
                            });
                          }}
                          className="px-3 py-1 text-xs bg-orange-100 hover:bg-orange-200 text-orange-700 rounded-lg transition"
                        >
                          週末＋祝日
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfig({
                              ...config,
                              selectedWeekdays: [0, 1, 2, 3, 4, 5, 6],
                              includeHolidays: 'only'
                            });
                          }}
                          className="px-3 py-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-lg transition"
                        >
                          祝日のみ
                        </button>
                      </div>

                      {/* ラジオボタン */}
                      <div className="space-y-2">
                        <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="radio"
                            name="includeHolidays"
                            checked={config.includeHolidays === true}
                            onChange={() => setConfig({ ...config, includeHolidays: true })}
                            className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">祝日を含める</div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              選択した曜日に加えて、祝日も監視します（例: 平日+祝日、週末+祝日）
                            </div>
                          </div>
                        </label>

                        <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="radio"
                            name="includeHolidays"
                            checked={config.includeHolidays === false}
                            onChange={() => setConfig({ ...config, includeHolidays: false })}
                            className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">祝日を除外</div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              祝日は監視しません（例: 平日のみ、週末のみ）
                            </div>
                          </div>
                        </label>

                        <label className="flex items-center gap-3 p-3 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50 transition">
                          <input
                            type="radio"
                            name="includeHolidays"
                            checked={config.includeHolidays === 'only'}
                            onChange={() => setConfig({ ...config, includeHolidays: 'only' })}
                            className="w-4 h-4 text-emerald-600 focus:ring-2 focus:ring-emerald-500"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">祝日のみ</div>
                            <div className="text-xs text-gray-600 mt-0.5">
                              祝日だけを監視します（曜日設定は無視されます）
                            </div>
                          </div>
                        </label>
                      </div>

                      <p className="text-xs text-gray-600 mt-2">
                        ℹ️ 日本の国民の祝日（振替休日・国民の休日を含む）を自動判定します
                      </p>
                    </div>

                    {/* 利用人数設定 */}
                    <div className="mt-6">
                      <label htmlFor="applicantCount" className="block text-sm font-medium text-gray-700 mb-3">
                        利用人数
                      </label>
                      <div className="flex items-center gap-4">
                        <input
                          id="applicantCount"
                          type="number"
                          min="1"
                          max="20"
                          value={config.applicantCount}
                          onChange={(e) => {
                            const value = parseInt(e.target.value);
                            if (value >= 1 && value <= 20) {
                              setConfig({ ...config, applicantCount: value });
                            }
                          }}
                          className="w-24 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                        />
                        <span className="text-sm text-gray-600">人</span>
                        <button
                          type="button"
                          onClick={() => {
                            // 品川区の施設があれば2人、港区のみなら4人に設定
                            const hasShinagawa = config.selectedFacilities.some(f => f.site === 'shinagawa');
                            setConfig({ ...config, applicantCount: hasShinagawa ? 2 : 4 });
                          }}
                          className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition"
                        >
                          推奨値に戻す
                        </button>
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        ℹ️ 推奨: 品川区は2人、港区は4人（1〜20人で指定可能）
                      </p>
                    </div>

                    {/* 予約受付期間の参考情報（折りたたみ式） */}
                    <details className="mt-4">
                      <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900 flex items-center gap-2">
                        📋 予約受付期間の参考情報
                        <span className="text-xs text-gray-500">(クリックで表示)</span>
                      </summary>
                      <div className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-2">
                        <p className="text-xs text-gray-700">
                          各施設の予約は通常、数ヶ月先まで受け付けています。
                        </p>
                        {config.selectedFacilities.some(f => f.site === 'shinagawa') && reservationPeriods.shinagawa && (
                          <div className="text-xs">
                            <span className="font-medium text-emerald-700">品川区:</span>
                            <span className="text-gray-600 ml-2">
                              {reservationPeriods.shinagawa.displayText}
                            </span>
                          </div>
                        )}
                        {config.selectedFacilities.some(f => f.site === 'minato') && reservationPeriods.minato && (
                          <div className="text-xs">
                            <span className="font-medium text-blue-700">港区:</span>
                            <span className="text-gray-600 ml-2">
                              {reservationPeriods.minato.displayText}
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-gray-500 mt-2">
                          ※ この情報は参考値です。実際の予約可能期間は各施設の設定により変動します。
                        </p>
                      </div>
                    </details>
                  </div>
                )}
              </div>

              {/* ナビゲーションボタン */}
              <div className="flex items-center justify-between gap-4 mt-6">
                {currentStep > 1 ? (
                  <button
                    onClick={handlePrevStep}
                    className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-semibold"
                  >
                    ← 戻る
                  </button>
                ) : (
                  <button
                    onClick={handleCancelWizard}
                    className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition font-semibold"
                  >
                    キャンセル
                  </button>
                )}

                {currentStep < 3 ? (
                  <button
                    onClick={handleNextStep}
                    disabled={currentStep === 1 && !canProceedStep1 || currentStep === 2 && !canProceedStep2}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    次へ →
                  </button>
                ) : (
                  <button
                    onClick={handleStart}
                    disabled={isLoading}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-semibold text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <div className="inline-block animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                        設定中...
                      </>
                    ) : (
                      <>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        監視を開始
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* 右側: 設定プレビュー */}
            <div className="lg:col-span-1">
              <div className="sticky top-4 bg-linear-to-br from-emerald-50 to-teal-50 rounded-xl p-6 border-2 border-emerald-200 shadow-lg">
                <h3 className="text-lg font-bold text-emerald-900 mb-4 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                  設定プレビュー
                </h3>

                <div className="space-y-4">
                  {/* 施設選択状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">施設選択</span>
                      {config.selectedFacilities.length > 0 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {config.selectedFacilities.length > 0 ? (
                      <div className="bg-white rounded-lg p-3 text-sm">
                        <div className="font-medium text-emerald-700 mb-1">
                          {config.selectedFacilities.length}施設を監視
                        </div>
                        <div className="text-xs text-gray-600 space-y-1 max-h-32 overflow-y-auto">
                          {config.selectedFacilities.slice(0, 3).map((f, i) => (
                            <div key={i}>• {f.name}</div>
                          ))}
                          {config.selectedFacilities.length > 3 && (
                            <div className="text-gray-500">...他{config.selectedFacilities.length - 3}施設</div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        施設を選択してください
                      </div>
                    )}
                  </div>

                  {/* 日時設定状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">日時設定</span>
                      {currentStep >= 2 && config.timeSlots.length > 0 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {currentStep >= 2 ? (
                      config.timeSlots.length > 0 ? (
                        <div className="bg-white rounded-lg p-3 text-sm space-y-2">
                          <div>
                            <span className="text-gray-600">期間:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.dateMode === 'single' && '特定日'}
                              {config.dateMode === 'range' && '期間指定'}
                              {config.dateMode === 'continuous' && '毎週曜日'}
                            </span>
                          </div>
                          {config.dateMode === 'single' && config.startDate && (
                            <div className="text-xs text-gray-600">
                              {config.startDate}
                            </div>
                          )}
                          {config.dateMode === 'range' && config.startDate && config.endDate && (
                            <div className="text-xs text-gray-600">
                              {config.startDate} 〜 {config.endDate}
                            </div>
                          )}
                          <div>
                            <span className="text-gray-600">時間帯:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.timeSlots.length}枠
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                          日時と時間帯を設定してください
                        </div>
                      )
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        ステップ2で設定してください
                      </div>
                    )}
                  </div>

                  {/* 詳細設定状況 */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-gray-700">詳細設定</span>
                      {currentStep >= 3 ? (
                        <span className="text-xs bg-emerald-600 text-white px-2 py-1 rounded-full">✓ 設定済み</span>
                      ) : (
                        <span className="text-xs bg-gray-300 text-gray-600 px-2 py-1 rounded-full">未設定</span>
                      )}
                    </div>
                    {currentStep >= 3 && config.dateMode === 'continuous' ? (
                      <div className="bg-white rounded-lg p-3 text-sm space-y-2">
                        {config.selectedWeekdays && config.selectedWeekdays.length > 0 ? (
                          <div>
                            <span className="text-gray-600">曜日:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.selectedWeekdays.length === 7 ? '毎日' :
                                config.selectedWeekdays.map(d => ['日', '月', '火', '水', '木', '金', '土'][d]).join(', ')}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">曜日未設定</div>
                        )}
                        {config.includeHolidays !== undefined ? (
                          <div>
                            <span className="text-gray-600">祝日:</span>
                            <span className="ml-2 font-medium text-gray-800">
                              {config.includeHolidays === 'only' ? '祝日のみ' :
                                config.includeHolidays === true ? '含む' : '除外'}
                            </span>
                          </div>
                        ) : (
                          <div className="text-xs text-gray-500">祝日設定未設定</div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-3 text-sm text-gray-500 italic">
                        毎週曜日モードでは曜日・祝日設定が必要です
                      </div>
                    )}
                  </div>
                </div>

                {/* サブリクエスト数の警告 */}
                {currentStep === 3 && config.selectedFacilities.length > 0 && config.timeSlots.length > 0 && (() => {
                  const estimatedRequests = (() => {
                    const timeSlotCount = config.timeSlots.length;
                    const facilityCount = config.selectedFacilities.length;

                    if (config.dateMode === 'continuous') {
                      // 継続監視: 3ヶ月分の週間取得
                      const weeksToMonitor = 13;
                      return facilityCount * weeksToMonitor * timeSlotCount;
                    } else if (config.dateMode === 'range') {
                      // 期間指定: 指定期間の週数×時間帯数
                      const start = new Date(config.startDate);
                      const end = new Date(config.endDate);
                      const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
                      const weeks = Math.ceil(days / 7);
                      return facilityCount * weeks * timeSlotCount;
                    } else {
                      // 単一日付: 1日×時間帯数×施設数
                      return facilityCount * timeSlotCount;
                    }
                  })();

                  const percentage = (estimatedRequests / 1000) * 100;

                  return (
                    <div className="mt-4">
                      {estimatedRequests > 1000 ? (
                        <div className="p-3 bg-red-100 border border-red-300 rounded-lg">
                          <div className="flex items-start gap-2 text-sm text-red-800">
                            <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                              <div className="font-bold mb-1">⚠️ 上限超過エラー</div>
                              <div className="text-xs">
                                予想リクエスト数: <span className="font-bold">{estimatedRequests}</span> / 1000
                                <br />
                                この設定では監視が正常に動作しません。施設数・時間帯・期間を減らしてください。
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : estimatedRequests > 800 ? (
                        <div className="p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
                          <div className="flex items-start gap-2 text-sm text-yellow-800">
                            <svg className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                              <div className="font-bold mb-1">注意</div>
                              <div className="text-xs">
                                予想リクエスト数: <span className="font-bold">{estimatedRequests}</span> / 1000 ({percentage.toFixed(0)}%)
                                <br />
                                上限に近づいています。監視が増えると上限を超える可能性があります。
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <div className="flex items-start gap-2 text-sm text-blue-700">
                            <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div>
                              <div className="font-medium mb-1">リクエスト数</div>
                              <div className="text-xs">
                                予想: <span className="font-bold">{estimatedRequests}</span> / 1000 ({percentage.toFixed(0)}%)
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 設定完了メッセージ */}
                {canProceedStep1 && canProceedStep2 && currentStep === 3 && (
                  <div className="mt-4 p-3 bg-emerald-100 border border-emerald-300 rounded-lg">
                    <div className="flex items-center gap-2 text-sm text-emerald-800 font-medium">
                      <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      設定完了！監視を開始できます
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 説明セクション */}
      <div className="bg-blue-50 rounded-lg p-6 mb-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-3">自動監視の仕組み</h3>
        <ul className="space-y-2 text-sm text-blue-800">
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>施設個別選択:</strong> 監視したい施設を自由に選択可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>柔軟な期間設定:</strong> 単一日付・期間指定・継続監視から選択可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>複数地区対応:</strong> 品川区と港区の両方を同時に監視可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>時間帯カスタマイズ:</strong> 監視する時間帯を複数選択可能（6時間帯から選択）</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>曜日・祝日指定:</strong> 継続監視では特定の曜日のみ監視、祝日の扱いも設定可能</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>1分間隔の自動監視:</strong> 設定した全施設・全コートを毎分一括チェック</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>「取」ステータス集中監視:</strong> 品川区で取消処理準備中を検知したら、10分刻み（:10, :20, :30...）の前後2分間に集中監視モードに移行</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>空き枠即時予約:</strong> 予約可能になったら設定通りに自動予約を実行</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-600 mt-0.5">✓</span>
            <span><strong>深夜時間帯制限:</strong> 深夜早朝（3:15-5:00）は監視を一時停止</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
