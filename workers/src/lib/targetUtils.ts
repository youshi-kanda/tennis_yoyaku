import { MonitoringTarget } from '../types';
import { isHoliday, getHolidaysForYear, HolidayInfo } from '../holidays';

export interface ExpandedCheckItem {
    date: string;
    timeSlot: string;
}

/**
 * Expands a monitoring target into a list of specific date/time slots to check.
 * Handles:
 * - Date Ranges (startDate/endDate)
 * - Multiple Time Slots
 * - Holiday filtering (includeHolidays)
 * - Weekday filtering (selectedWeekdays)
 */
export function expandMonitoringTarget(target: MonitoringTarget): ExpandedCheckItem[] {
    const datesToCheck: string[] = [];
    const holidaysCacheByYear = new Map<number, HolidayInfo[]>();

    // Helper to get holidays with caching
    const getHolidays = (year: number) => {
        if (!holidaysCacheByYear.has(year)) {
            holidaysCacheByYear.set(year, getHolidaysForYear(year));
        }
        return holidaysCacheByYear.get(year)!;
    };

    // 1. Resolve Dates
    if (target.dateMode === 'range' && target.startDate && target.endDate) {
        const start = new Date(target.startDate);
        const end = new Date(target.endDate);

        // Loop through dates
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const year = d.getFullYear();
            const holidays = getHolidays(year);
            const isHolidayDate = isHoliday(dateStr, holidays);

            // Filter: Holidays
            if (target.includeHolidays === 'only' && !isHolidayDate) continue;
            if (target.includeHolidays === false && isHolidayDate) continue;

            // Filter: Weekdays
            // Note: target.selectedWeekdays is 0=Sun, 1=Mon, ..., 6=Sat
            // targetUtils logic should match standard JS getDay()
            if (target.includeHolidays !== 'only' && target.selectedWeekdays && target.selectedWeekdays.length > 0) {
                if (!target.selectedWeekdays.includes(d.getDay())) continue;
            }

            datesToCheck.push(dateStr);
        }
    } else {
        // Single Date Mode
        const dateStr = target.date;
        if (dateStr) {
            const d = new Date(dateStr);
            const year = d.getFullYear();
            const holidays = getHolidays(year);
            const isHolidayDate = isHoliday(dateStr, holidays);

            let shouldCheck = true;
            if (target.includeHolidays === 'only') shouldCheck = isHolidayDate;
            else if (target.includeHolidays === false) shouldCheck = !isHolidayDate;

            if (shouldCheck && target.includeHolidays !== 'only' && target.selectedWeekdays && target.selectedWeekdays.length > 0) {
                if (!target.selectedWeekdays.includes(d.getDay())) shouldCheck = false;
            }

            if (shouldCheck) datesToCheck.push(dateStr);
        }
    }

    // 2. Expand TimeSlots
    const items: ExpandedCheckItem[] = [];
    const timeSlots = target.timeSlots && target.timeSlots.length > 0 ? target.timeSlots : (target.timeSlot ? [target.timeSlot] : []);

    for (const date of datesToCheck) {
        for (const slot of timeSlots) {
            items.push({ date, timeSlot: slot });
        }
    }

    return items;
}
