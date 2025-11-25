/**
 * 日本の祝日判定（PWA用）
 */

const FIXED_HOLIDAYS = [
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

const HAPPY_MONDAY_HOLIDAYS = [
  { month: 1, week: 2, name: '成人の日' },
  { month: 7, week: 3, name: '海の日' },
  { month: 9, week: 3, name: '敬老の日' },
  { month: 10, week: 2, name: 'スポーツの日' },
];

function calculateEquinoxDay(year: number, isSpring: boolean): number {
  if (isSpring) {
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  } else {
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
}

function getMonthMonday(year: number, month: number, week: number): number {
  const firstDay = new Date(year, month - 1, 1);
  const firstMonday = firstDay.getDay() === 1 ? 1 : (8 - firstDay.getDay()) % 7 + 1;
  return firstMonday + (week - 1) * 7;
}

/**
 * 指定された日付が祝日かどうかを判定
 */
export function isHoliday(date: Date): boolean {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // 固定祝日チェック
  if (FIXED_HOLIDAYS.some(h => h.month === month && h.day === day)) {
    return true;
  }

  // ハッピーマンデーチェック
  const mondayHoliday = HAPPY_MONDAY_HOLIDAYS.find(h => h.month === month);
  if (mondayHoliday && date.getDay() === 1) {
    const targetMonday = getMonthMonday(year, month, mondayHoliday.week);
    if (day === targetMonday) {
      return true;
    }
  }

  // 春分の日
  if (month === 3 && day === calculateEquinoxDay(year, true)) {
    return true;
  }

  // 秋分の日
  if (month === 9 && day === calculateEquinoxDay(year, false)) {
    return true;
  }

  return false;
}
