/**
 * 日本の祝日判定モジュール
 * 国民の祝日に関する法律に基づき、祝日を判定します
 */

/**
 * 祝日情報
 */
export interface HolidayInfo {
  date: string; // YYYY-MM-DD
  name: string; // 祝日名
  type: 'fixed' | 'happy-monday' | 'equinox' | 'substitute' | 'national'; // 祝日タイプ
}

/**
 * 固定祝日の定義
 */
const FIXED_HOLIDAYS: Array<{ month: number; day: number; name: string }> = [
  { month: 1, day: 1, name: '元日' },
  { month: 2, day: 11, name: '建国記念の日' },
  { month: 2, day: 23, name: '天皇誕生日' },
  { month: 4, day: 29, name: '昭和の日' },
  { month: 5, day: 3, name: '憲法記念日' },
  { month: 5, day: 4, name: 'みどりの日' },
  { month: 5, day: 5, name: 'こどもの日' },
  { month: 8, day: 11, name: '山の日' },
  { month: 11, day: 3, name: '文化の日' },
  { month: 11, day: 23, name: '勤労感謝の日' },
];

/**
 * ハッピーマンデー制度の祝日
 */
const HAPPY_MONDAY_HOLIDAYS: Array<{ month: number; week: number; name: string }> = [
  { month: 1, week: 2, name: '成人の日' }, // 1月第2月曜日
  { month: 7, week: 3, name: '海の日' },   // 7月第3月曜日
  { month: 9, week: 3, name: '敬老の日' }, // 9月第3月曜日
  { month: 10, week: 2, name: 'スポーツの日' }, // 10月第2月曜日
];

/**
 * 春分・秋分の日を計算（簡易計算式）
 * 2000年〜2099年まで対応
 */
function calculateEquinoxDay(year: number, isSpring: boolean): number {
  if (isSpring) {
    // 春分の日の計算式
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  } else {
    // 秋分の日の計算式
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
}

/**
 * ハッピーマンデーの日付を計算
 */
function calculateHappyMonday(year: number, month: number, week: number): number {
  const firstDay = new Date(year, month - 1, 1);
  const firstDayOfWeek = firstDay.getDay(); // 0=日, 1=月, ...
  
  // 第N月曜日の日付を計算
  let day = 1;
  if (firstDayOfWeek === 0) {
    // 1日が日曜日の場合、2日が第1月曜日
    day = 2;
  } else if (firstDayOfWeek === 1) {
    // 1日が月曜日の場合、1日が第1月曜日
    day = 1;
  } else {
    // それ以外は、次の月曜日を探す
    day = 8 - firstDayOfWeek + 1;
  }
  
  // 第N月曜日まで進める
  day += (week - 1) * 7;
  
  return day;
}

/**
 * 指定された年の祝日一覧を取得
 */
export function getHolidaysForYear(year: number): HolidayInfo[] {
  const holidays: HolidayInfo[] = [];
  
  // 固定祝日
  for (const holiday of FIXED_HOLIDAYS) {
    const date = `${year}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
    holidays.push({
      date,
      name: holiday.name,
      type: 'fixed',
    });
  }
  
  // ハッピーマンデー祝日
  for (const holiday of HAPPY_MONDAY_HOLIDAYS) {
    const day = calculateHappyMonday(year, holiday.month, holiday.week);
    const date = `${year}-${String(holiday.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    holidays.push({
      date,
      name: holiday.name,
      type: 'happy-monday',
    });
  }
  
  // 春分の日
  const springEquinoxDay = calculateEquinoxDay(year, true);
  holidays.push({
    date: `${year}-03-${String(springEquinoxDay).padStart(2, '0')}`,
    name: '春分の日',
    type: 'equinox',
  });
  
  // 秋分の日
  const autumnEquinoxDay = calculateEquinoxDay(year, false);
  holidays.push({
    date: `${year}-09-${String(autumnEquinoxDay).padStart(2, '0')}`,
    name: '秋分の日',
    type: 'equinox',
  });
  
  // 振替休日を計算
  const substituteHolidays = calculateSubstituteHolidays(year, holidays);
  holidays.push(...substituteHolidays);
  
  // 国民の休日を計算
  const nationalHolidays = calculateNationalHolidays(year, holidays);
  holidays.push(...nationalHolidays);
  
  // 日付でソート
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  
  return holidays;
}

/**
 * 振替休日を計算
 * 祝日が日曜日の場合、翌日（月曜日）が振替休日になる
 */
function calculateSubstituteHolidays(year: number, holidays: HolidayInfo[]): HolidayInfo[] {
  const substituteHolidays: HolidayInfo[] = [];
  
  for (const holiday of holidays) {
    const date = new Date(holiday.date);
    
    // 日曜日かチェック
    if (date.getDay() === 0) {
      // 翌日を振替休日とする
      let nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // すでに祝日になっていないかチェック
      while (holidays.some(h => h.date === nextDate.toISOString().split('T')[0])) {
        nextDate.setDate(nextDate.getDate() + 1);
      }
      
      substituteHolidays.push({
        date: nextDate.toISOString().split('T')[0],
        name: '振替休日',
        type: 'substitute',
      });
    }
  }
  
  return substituteHolidays;
}

/**
 * 国民の休日を計算
 * 祝日に挟まれた平日は国民の休日になる
 */
function calculateNationalHolidays(year: number, holidays: HolidayInfo[]): HolidayInfo[] {
  const nationalHolidays: HolidayInfo[] = [];
  const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  
  for (let i = 0; i < sortedHolidays.length - 1; i++) {
    const current = new Date(sortedHolidays[i].date);
    const next = new Date(sortedHolidays[i + 1].date);
    
    // 2日後が次の祝日の場合
    const twoDaysLater = new Date(current);
    twoDaysLater.setDate(twoDaysLater.getDate() + 2);
    
    if (twoDaysLater.getTime() === next.getTime()) {
      const middleDate = new Date(current);
      middleDate.setDate(middleDate.getDate() + 1);
      
      // 日曜日でない場合のみ国民の休日とする
      if (middleDate.getDay() !== 0) {
        nationalHolidays.push({
          date: middleDate.toISOString().split('T')[0],
          name: '国民の休日',
          type: 'national',
        });
      }
    }
  }
  
  return nationalHolidays;
}

/**
 * 指定された日付が祝日かどうかを判定
 */
export function isHoliday(dateStr: string, holidaysCache?: HolidayInfo[]): boolean {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  
  // キャッシュがあればそれを使用
  const holidays = holidaysCache || getHolidaysForYear(year);
  
  return holidays.some(h => h.date === dateStr);
}

/**
 * 指定された日付の祝日情報を取得
 */
export function getHolidayInfo(dateStr: string, holidaysCache?: HolidayInfo[]): HolidayInfo | null {
  const date = new Date(dateStr);
  const year = date.getFullYear();
  
  // キャッシュがあればそれを使用
  const holidays = holidaysCache || getHolidaysForYear(year);
  
  return holidays.find(h => h.date === dateStr) || null;
}

/**
 * 指定された期間の祝日一覧を取得
 */
export function getHolidaysInRange(startDate: string, endDate: string): HolidayInfo[] {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  
  const allHolidays: HolidayInfo[] = [];
  
  // 各年の祝日を取得
  for (let year = startYear; year <= endYear; year++) {
    const yearHolidays = getHolidaysForYear(year);
    allHolidays.push(...yearHolidays);
  }
  
  // 期間内の祝日のみフィルタ
  return allHolidays.filter(h => h.date >= startDate && h.date <= endDate);
}
