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

// =============================================================================
// Login Logic
// =============================================================================

export async function loginToMinato(userId: string, password: string): Promise<string | null> {
    try {
        const baseUrl = 'https://web101.rsv.ws-scs.jp/web';

        const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
            },
            redirect: 'manual',
        });

        await initResponse.text().catch(() => { });

        const setCookieHeader = initResponse.headers.get('set-cookie');
        if (!setCookieHeader) {
            console.error('Minato: No session cookie received');
            return null;
        }

        const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
        if (!sessionIdMatch) {
            console.error('Minato: Failed to parse JSESSIONID');
            return null;
        }

        const sessionId = sessionIdMatch[1];
        console.log('Minato: Session established:', sessionId.substring(0, 20) + '...');

        const loginParams = new URLSearchParams({
            'rsvWTransUserLoginForm.usrId': userId,
            'rsvWTransUserLoginForm.usrPswd': password,
        });

        console.log(`Minato: Login parameters: ${loginParams.toString()}`);

        const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Cookie': `JSESSIONID=${sessionId}`,
                'Referer': `${baseUrl}/rsvWTransUserLoginAction.do`,
            },
            body: loginParams.toString(),
            redirect: 'manual',
        });

        if (loginResponse.status === 302 || loginResponse.status === 200) {
            const responseText = await loginResponse.text();

            const titleMatch = responseText.match(/<title>(.*?)<\/title>/i);
            const pageTitle = titleMatch ? titleMatch[1] : 'No Title';
            console.log(`Minato: Login response page title: "${pageTitle}"`);

            if (responseText.includes('ログインできませんでした') ||
                responseText.includes('利用者番号またはパスワードが正しくありません')) {
                console.error('Minato: Login failed - Invalid credentials');
                return null;
            }

            console.log('Minato: Login successful');
            return sessionId;
        } else {
            console.error('Minato: Login failed with status:', loginResponse.status);
            return null;
        }

    } catch (error) {
        console.error('Minato: Login error:', error);
        return null;
    }
}

// =============================================================================
// Availability Check Logic
// =============================================================================

export async function checkMinatoAvailability(
    facilityId: string,
    date: string,
    timeSlot: string,
    credentials: SiteCredentials,
    existingReservations?: ReservationHistory[],
    sessionId?: string | null
): Promise<AvailabilityResult> {
    try {
        const isAlreadyReserved = existingReservations?.some(
            r => r.site === 'minato' &&
                r.facilityId === facilityId &&
                r.date === date &&
                r.timeSlot === timeSlot &&
                r.status === 'success'
        );

        if (isAlreadyReserved) {
            return {
                available: false,
                facilityId,
                facilityName: '港区施設',
                date,
                timeSlot,
                currentStatus: '予約済',
                changedToAvailable: false,
            };
        }

        let activeSessionId = sessionId;
        if (!activeSessionId) {
            activeSessionId = await loginToMinato(credentials.username, credentials.password);
            if (!activeSessionId) throw new Error('Login failed');
        }

        const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
        const searchParams = new URLSearchParams({
            'rsvWOpeInstSrchVacantForm.instCd': facilityId,
            'rsvWOpeInstSrchVacantForm.srchDate': date,
        });

        const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Cookie': `JSESSIONID=${activeSessionId}`,
                'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
            },
        });

        const htmlText = await searchResponse.text();

        if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
            throw new Error('Login failed or session expired');
        }

        const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×])`));
        const currentStatus = statusMatch ? statusMatch[1] : '×';
        const isAvailable = currentStatus === '○';

        if (currentStatus === '○') {
            console.log(`[Minato] ⚡ ○ 検知: ${facilityId}, ${date}, ${timeSlot}`);
        }

        return {
            available: isAvailable,
            facilityId,
            facilityName: '港区施設',
            date,
            timeSlot,
            currentStatus,
            changedToAvailable: isAvailable,
        };
    } catch (error: any) {
        console.error('[Minato] Scraping error:', error);
        throw new Error(`Failed to check Minato availability: ${error.message}`);
    }
}

export async function checkMinatoWeeklyAvailability(
    facilityId: string,
    weekStartDate: string,
    sessionId: string,
    facilityInfo?: Facility
): Promise<WeeklyAvailabilityResult> {
    const availability = new Map<string, string>();
    const baseUrl = 'https://web101.rsv.ws-scs.jp/web';

    try {
        const searchParams = new URLSearchParams({
            'rsvWOpeInstSrchVacantForm.instCd': facilityId,
            'rsvWOpeInstSrchVacantForm.srchDate': weekStartDate,
        });

        const cookieHeader = sessionId.includes('JSESSIONID=') ? sessionId : `JSESSIONID=${sessionId}`;

        const headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cookie': cookieHeader,
            'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
        };

        const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
            method: 'GET',
            headers: headers,
        });

        const htmlText = await searchResponse.text();

        if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
            throw new Error('Login failed or session expired');
        }

        const cellPattern = /<td[^>]*id="(\d{8})_(\d{2})"[^>]*>([\s\S]*?)<\/td>/gi;
        let match;

        while ((match = cellPattern.exec(htmlText)) !== null) {
            const dateStr = match[1];
            const timeCode = parseInt(match[2], 10);
            const cellContent = match[3];
            const timeSlot = MINATO_TIMESLOT_MAP[timeCode];
            if (!timeSlot) continue;

            if (facilityInfo?.availableTimeSlots && !facilityInfo.availableTimeSlots.includes(timeSlot)) continue;

            const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            let status = '×';
            if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) status = '○';
            else if (cellContent.includes('alt="予約あり"') || cellContent.includes('calendar_full')) status = '×';
            else if (cellContent.includes('alt="一部空き"') || cellContent.includes('calendar_few-available')) status = '△';
            else if (cellContent.includes('alt="受付期間外"') || cellContent.includes('calendar_term_out')) status = '受付期間外';

            const key = `${formattedDate}_${timeSlot}`;
            availability.set(key, status);
        }

        return {
            facilityId,
            facilityName: '港区施設',
            weekStartDate,
            availability,
            fetchedAt: Date.now(),
        };

    } catch (error: any) {
        throw error;
    }
}

// =============================================================================
// Reservation Logic
// =============================================================================

export async function makeMinatoReservation(
    facilityId: string,
    date: string,
    timeSlot: string,
    sessionId: string,
    target: { applicantCount?: number }
): Promise<{ success: boolean; reservationId?: string; error?: string; message?: string }> {
    try {
        console.log(`[Minato] Making reservation: ${facilityId}, ${date}, ${timeSlot}`);
        const baseUrl = 'https://web101.rsv.ws-scs.jp/web';

        // 1. Check/Init Search Page
        const searchParams = new URLSearchParams({
            'rsvWOpeInstSrchVacantForm.instCd': facilityId,
            'rsvWOpeInstSrchVacantForm.srchDate': date,
        });

        const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
            method: 'GET',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
            },
        });

        const searchHtml = await searchResponse.text();
        if (searchHtml.includes('ログイン') || searchHtml.includes('セッションが切れました')) {
            return { success: false, error: 'Login failed or session expired' };
        }

        // 2. Extract Fields
        const formParams: Record<string, string> = {};
        const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
        let match;
        while ((match = inputRegex.exec(searchHtml)) !== null) formParams[match[1]] = match[2];

        // 3. AJAX Select
        const startTimeStr = timeSlot.split('-')[0];
        let tzoneNo = '';
        for (const [code, start] of Object.entries(MINATO_TIMESLOT_MAP)) {
            if (start === startTimeStr) {
                tzoneNo = code;
                break;
            }
        }
        if (!tzoneNo) return { success: false, error: `Unknown time slot format: ${timeSlot}` };

        const [sStr, eStr] = timeSlot.split('-');
        const startTime = sStr.replace(':', '');
        const endTime = eStr ? eStr.replace(':', '') : '';
        const bldCd = facilityId.substring(0, 5);
        const useDay = date.replace(/-/g, '');

        const ajaxParams = new URLSearchParams();
        ajaxParams.append('displayNo', formParams['displayNo'] || 'prwrc2000');
        ajaxParams.append('bldCd', bldCd);
        ajaxParams.append('instCd', facilityId);
        ajaxParams.append('useDay', useDay);
        ajaxParams.append('startTime', startTime);
        ajaxParams.append('endTime', endTime);
        ajaxParams.append('tzoneNo', tzoneNo);
        ajaxParams.append('akiNum', '0');
        ajaxParams.append('selectNum', '0');

        const ajaxResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
                'X-Requested-With': 'XMLHttpRequest'
            },
            body: ajaxParams.toString()
        });

        if (!ajaxResponse.ok) return { success: false, error: `AJAX selection failed: ${ajaxResponse.status}` };

        // 4. Apply Action
        const applyParams = new URLSearchParams();
        for (const [key, value] of Object.entries(formParams)) applyParams.append(key, value);

        const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
            },
            body: applyParams.toString()
        });
        const applyHtml = await applyResponse.text();
        if (!applyHtml.includes('予約申込')) {
            const errMsg = applyHtml.match(/color=["']red["']>([^<]+)<\/font>/i);
            return { success: false, error: `Apply Error: ${errMsg ? errMsg[1] : 'Failed to transition'}` };
        }

        // 5. Details
        const detailsParams: Record<string, string> = {};
        detailsParams['purpose'] = '2000_2000040';
        detailsParams['ppsdCd'] = '2000';
        detailsParams['ppsCd'] = '2000040';
        detailsParams['applyNum'] = (target.applicantCount || 4).toString();

        const hiddenRegex = /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
        let hiddenMatch;
        while ((hiddenMatch = hiddenRegex.exec(applyHtml)) !== null) detailsParams[hiddenMatch[1]] = hiddenMatch[2];

        const detailsBody = new URLSearchParams();
        for (const [key, value] of Object.entries(detailsParams)) detailsBody.append(key, value);
        detailsBody.set('applyNum', (target.applicantCount || 4).toString());
        if (!detailsBody.has('applyFlg')) detailsBody.set('applyFlg', '1');

        const detailsResponse = await fetch(`${baseUrl}/rsvWInstRsvApplyAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`,
            },
            body: detailsBody.toString(),
        });

        // 6. Confirm
        const confirmResponse = await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: ''
        });

        // 7. Complete
        const completeResponse = await fetch(`${baseUrl}/rsvWOpeReservedCompleteAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: ''
        });
        const completeHtml = await completeResponse.text();

        // 判定ロジック強化: 予約受付番号を必須とする
        const rsvNoMatch = completeHtml.match(/予約受付番号[:\s]*(\d+)/) || completeHtml.match(/予約番号[:\s]*(\d+)/);

        if (rsvNoMatch) {
            const reservationId = rsvNoMatch[1];
            console.log(`[Minato] ✅ Reservation Confirmed! ID: ${reservationId}`);
            return { success: true, reservationId: reservationId, message: `予約完了: ID ${reservationId}` };
        } else if (completeHtml.includes('予約完了') || completeHtml.includes('受け付けました')) {
            // 文言はあるが番号が取れなかった場合
            // MinatoはIDが必ず画面に出るはずなので、Warn扱いにする
            console.warn('[Minato] ⚠️ Reservation might be successful but ID not found.');
            console.log(completeHtml.substring(0, 3000));
            const fallbackId = `MINATO_OK_${Date.now()}`;
            return { success: true, reservationId: fallbackId, message: '予約完了 (ID自動取得失敗)' };
        } else {
            // 🚨 失敗
            console.error('[Minato] ❌ Reservation Failed. Analyzing response...');
            console.log(completeHtml.substring(0, 4000)); // 先頭4000文字を出力

            const errMsg = completeHtml.match(/class="error"[^>]*>([\s\S]*?)<\//i) ||
                completeHtml.match(/color=["']red["'][^>]*>([\s\S]*?)<\//i);

            const finalError = errMsg ? errMsg[1].replace(/<[^>]+>/g, '').trim() : '不明なエラー (ログを確認してください)';

            return { success: false, error: finalError };
        }

    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

// =============================================================================
// Facilities Logic
// =============================================================================

export async function getMinatoFacilities(
    sessionId: string,
    kv: KVNamespace,
    userId?: string
): Promise<Facility[]> {
    try {
        const cacheKey = userId ? `minato:facilities:${userId}` : 'facilities:minato';
        const cached = await kv.get(cacheKey);
        if (cached) return JSON.parse(cached);

        const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
        const response = await fetch(`${baseUrl}/rsvWOpeInstListAction.do`, {
            method: 'GET',
            headers: {
                'Cookie': `JSESSIONID=${sessionId}`,
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        const html = await response.text();
        const facilities: Facility[] = [];
        const patterns = [
            /rsvWOpeInstMenuAction\.do\?instNo=([^"'&]+)["'][^>]*>([^<]+)</g,
            /<a[^>]*href="[^"]*instNo=([^"'&]+)"[^>]*>([^<]+)<\/a>/g,
            /onclick="[^"]*instNo=([^"'&]+)"[^>]*>([^<]+)/g,
        ];

        let foundAny = false;
        for (const pattern of patterns) {
            let match;
            const tempFacilities: Facility[] = [];
            while ((match = pattern.exec(html)) !== null) {
                foundAny = true;
                const facilityId = match[1];
                let facilityName = match[2].trim();
                facilityName = facilityName.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

                if (facilityName.includes('テニス')) {
                    tempFacilities.push({
                        facilityId, facilityName, category: 'tennis', isTennisCourt: true, site: 'minato'
                    });
                }
            }
            if (tempFacilities.length > 0) {
                facilities.push(...tempFacilities);
                break;
            }
        }

        if (facilities.length > 0) {
            await kv.put(cacheKey, JSON.stringify(facilities), { expirationTtl: 21600 });
            return facilities;
        }

        return getMinatoFacilitiesFallback();

    } catch (error) {
        return getMinatoFacilitiesFallback();
    }
}

function getMinatoFacilitiesFallback(): Facility[] {
    const minatoTimeSlots = ['08:00', '10:00', '12:00', '13:00', '15:00', '17:00', '19:00'];
    return [
        { facilityId: '1001', facilityName: '麻布運動公園 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '1002', facilityName: '麻布運動公園 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '1003', facilityName: '麻布運動公園 テニスコートＣ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '1004', facilityName: '麻布運動公園 テニスコートＤ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '2001', facilityName: '青山運動場 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '2002', facilityName: '青山運動場 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '5001', facilityName: '芝浦中央公園運動場 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '5002', facilityName: '芝浦中央公園運動場 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '5003', facilityName: '芝浦中央公園運動場 テニスコートＣ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
        { facilityId: '5004', facilityName: '芝浦中央公園運動場 テニスコートＤ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    ];
}
