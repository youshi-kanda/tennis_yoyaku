import { KVNamespace } from '@cloudflare/workers-types';
import {
    SiteCredentials,
    AvailabilityResult,
    WeeklyAvailabilityResult,
    Facility,
    ReservationHistory
} from './types';

export const MINATO_TIMESLOT_MAP: { [code: number]: string } = {
    10: '08:00',
    20: '10:00',
    30: '12:00',
    40: '13:00',
    50: '15:00',
    60: '17:00',
    70: '19:00',
};

export async function loginToMinato(userId: string, password: string): Promise<string | null> {
    // ... Login logic from scraper.ts
    const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
    try {
        const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`);
        await initResponse.text();
        const setCookie = initResponse.headers.get('set-cookie');
        if (!setCookie) return null;
        const sessionIdMatch = setCookie.match(/JSESSIONID=([^;]+)/);
        if (!sessionIdMatch) return null;
        const sessionId = sessionIdMatch[1];

        // Mock login success for now or implement full post
        return sessionId;
    } catch (e) {
        console.error(e);
        return null;
    }
}

export async function checkMinatoAvailability(
    facilityId: string,
    date: string,
    timeSlot: string,
    credentials: SiteCredentials,
    existingReservations?: ReservationHistory[],
    sessionId?: string | null
): Promise<AvailabilityResult> {
    // ... Logic from scraper.ts
    return {
        available: false,
        facilityId,
        facilityName: '港区施設',
        date,
        timeSlot,
        currentStatus: '×',
        changedToAvailable: false
    };
}

export async function checkMinatoWeeklyAvailability(
    facilityId: string,
    weekStartDate: string,
    sessionId: string,
    facilityInfo?: Facility
): Promise<WeeklyAvailabilityResult> {
    return {
        facilityId,
        facilityName: '港区施設',
        weekStartDate,
        availability: new Map(),
        fetchedAt: Date.now()
    };
}

export async function makeMinatoReservation(
    facilityId: string,
    date: string,
    timeSlot: string,
    sessionId: string,
    target: { applicantCount?: number }
): Promise<{ success: boolean; reservationId?: string; error?: string; message?: string }> {
    // ... logic
    return { success: false, error: 'Not implemented' };
}

export async function getMinatoFacilities(
    sessionId: string,
    kv: KVNamespace,
    userId?: string
): Promise<Facility[]> {
    return getMinatoFacilitiesFallback();
}

function getMinatoFacilitiesFallback(): Facility[] {
    const minatoTimeSlots = ['08:00', '10:00', '12:00', '13:00', '15:00', '17:00', '19:00'];
    return [
        { facilityId: '1001', facilityName: '麻布運動公園 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        // ...
    ];
}
