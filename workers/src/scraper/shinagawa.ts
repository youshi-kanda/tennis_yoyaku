import { KVNamespace } from '@cloudflare/workers-types';
import {
    SiteCredentials,
    AvailabilityResult,
    WeeklyAvailabilityResult,
    ReservationContext,
    ShinagawaSession,
    Facility,
    ReservationHistory
} from './types';
import { getJSTDate } from '../utils/date';

// 品川区: 時間帯コード → 時間帯文字列のマッピング
export const SHINAGAWA_TIMESLOT_MAP: { [code: number]: string } = {
    10: '09:00',
    20: '11:00',
    30: '13:00',
    40: '15:00',
    50: '17:00',
    60: '19:00',
};

// =============================================================================
// Helper Functions
// =============================================================================

function getCookieHeader(cookies: Map<string, string>): string {
    let str = '';
    cookies.forEach((val, key) => {
        str += `${key}=${val}; `;
    });
    return str;
}

function updateCookies(response: Response, currentCookies: Map<string, string>): void {
    let cookieStrings: string[] = [];
    // @ts-ignore
    if (typeof response.headers.getSetCookie === 'function') {
        // @ts-ignore
        cookieStrings = response.headers.getSetCookie();
    } else {
        const headerVal = response.headers.get('set-cookie');
        if (headerVal) {
            cookieStrings = headerVal.split(/,(?=\s*[a-zA-Z0-9]+=[^;]+)/g);
        }
    }

    if (cookieStrings.length > 0) {
        console.log(`[Cookies] Received ${cookieStrings.length} cookies from ${response.url}`);
        cookieStrings.forEach(c => console.log(`  Set-Cookie: ${c.split(';')[0]}`));
    } else {
        console.log(`[Cookies] No cookies received from ${response.url} (Status: ${response.status})`);
    }

    cookieStrings.forEach(cookieStr => {
        const parts = cookieStr.split(';');
        if (parts.length > 0) {
            const firstPart = parts[0].trim();
            const eqIdx = firstPart.indexOf('=');
            if (eqIdx > 0) {
                const key = firstPart.substring(0, eqIdx).trim();
                const value = firstPart.substring(eqIdx + 1).trim();
                if (key && value) {
                    currentCookies.set(key, value);
                }
            }
        }
    });
}

// Helper to update session.cookie string from Response
function updateSessionCookies(session: ShinagawaSession, response: Response) {
    const currentCookies = new Map<string, string>();
    // Parse existing
    session.cookie.split(';').forEach(pair => {
        const parts = pair.split('=');
        if (parts.length >= 2) {
            currentCookies.set(parts[0].trim(), parts[1].trim());
        }
    });

    // Update from response
    updateCookies(response, currentCookies);

    // Rebuild string
    session.cookie = getCookieHeader(currentCookies);
}

// =============================================================================
// Login Logic
// =============================================================================

export async function loginToShinagawa(
    userId: string,
    password: string,
    fetchImpl?: typeof fetch
): Promise<ShinagawaSession | null> {
    const fetcher = fetchImpl || globalThis.fetch;
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    let sessionId = '';
    let currentCookies = new Map<string, string>();

    try {
        console.log('[Login] 🔐 品川区ログイン開始:', userId.substring(0, 3) + '***');

        // Step 0: トップページアクセス（セッション確立）
        const topResponse = await fetcher(`${baseUrl}/`, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Cache-Control': 'no-cache',
            },
            redirect: 'manual',
        });

        updateCookies(topResponse, currentCookies);
        await topResponse.text();

        sessionId = currentCookies.get('JSESSIONID') || '';
        if (!sessionId) {
            throw new Error('Initial JSESSIONID not found');
        }

        // Step 1: ログイン画面アクセス（POSTで遷移）
        const today = getJSTDate();
        const loginFormParams = new URLSearchParams();
        loginFormParams.append('date', '4');
        loginFormParams.append('daystart', today);
        loginFormParams.append('days', '31');
        loginFormParams.append('dayofweekClearFlg', '0');
        loginFormParams.append('timezoneClearFlg', '0');
        loginFormParams.append('selectAreaBcd', '');
        loginFormParams.append('selectIcd', '');
        loginFormParams.append('selectPpsClPpscd', '');
        loginFormParams.append('displayNo', 'pawab2000');
        loginFormParams.append('displayNoFrm', 'pawab2000');

        // Original POST request to get login form
        const initResponse = await fetcher(`${baseUrl}/rsvWTransUserLoginAction.do`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': getCookieHeader(currentCookies),
            },
            body: loginFormParams.toString(),
            redirect: 'manual',
        });

        const initBuffer = await initResponse.arrayBuffer();
        const initHtml = new TextDecoder('shift-jis').decode(initBuffer);
        updateCookies(initResponse, currentCookies);

        // DEBUG: Save pre-login HTML
        try {
            // @ts-ignore
            const fs = require('fs');
            // @ts-ignore
            const path = require('path');
            // @ts-ignore
            const debugPath = path.join(process.cwd(), 'debug_html', 'pre_login.html');
            fs.writeFileSync(debugPath, initHtml);
        } catch (e) { }

        // loginJKey抽出 (Still explicitly check for critical one)
        const loginJKeyMatch = initHtml.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
        if (!loginJKeyMatch?.[1]) throw new Error('loginJKey not found');
        const loginJKey = loginJKeyMatch[1];

        // Extract ALL hidden inputs to mimic browser behavior (Struts/Java apps often need these)
        const authParams = new URLSearchParams();

        // Generic extraction of all inputs in the form
        const formRegex = /<form[^>]*name=["']form1["'][^>]*>([\s\S]*?)<\/form>/i;
        const formMatch = initHtml.match(formRegex);
        if (formMatch) {
            const formContent = formMatch[1];
            const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
            const inputs = [...formContent.matchAll(inputRegex)];
            for (const m of inputs) {
                const name = m[1];
                const value = m[2];
                // Skip userId/password as we set them manually
                if (name !== 'userId' && name !== 'password') {
                    authParams.append(name, value);
                }
            }
        } else {
            // Fallback if form parsing fails (should not happen)
            console.warn('[Login] ⚠️ Could not parse form1, falling back to manual params');
            authParams.append('loginJKey', loginJKey);
            authParams.append('displayNo', 'pawab2100');
            authParams.append('fcflg', '');
        }

        // Overwrite/Set credentials
        authParams.set('userId', userId);
        authParams.set('password', password);

        // Add loginCharPass
        const passwordChars = password.split('');
        passwordChars.forEach(char => {
            authParams.append('loginCharPass', char);
        });

        const displayNo = authParams.get('displayNo') || 'unknown';
        console.log(`[Login] Params: userId=${userId}, loginJKey=${loginJKey}, displayNo=${displayNo}`);
        console.log(`[Login] Full Params Keys: ${[...authParams.keys()].join(',')}`);


        const loginResponse = await fetcher(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
            method: 'POST',
            headers: {
                'User-Agent': USER_AGENT,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': getCookieHeader(currentCookies),
                'Referer': `${baseUrl}/rsvWTransUserLoginAction.do`,
            },
            body: authParams.toString(),
            redirect: 'manual',
        });

        updateCookies(loginResponse, currentCookies);

        const loginBuffer = await loginResponse.arrayBuffer();
        const loginHtml = new TextDecoder('shift-jis').decode(loginBuffer);

        if (loginHtml.includes('アカウントがロックされています') ||
            loginHtml.includes('Account Locked')) {
            console.error('[Login] ❌ Account Locked detected');
            throw new Error('ACCOUNT_LOCKED');
        }

        if (loginHtml.includes('ログインできませんでした') ||
            loginHtml.includes('利用者番号またはパスワードが正しくありません')) {
            console.error('[Login] ❌ Invalid Credentials');
            throw new Error('INVALID_CREDENTIALS');
        }

        // 302 Found = Success
        // OR 200 OK but MUST NOT contain the login button (id="btn-login")
        // The presence of "rsvWTransInstListAction" alone is not enough as it appears in JS variables on the login page too.
        const isRedirect = loginResponse.status === 302 || loginResponse.status === 303;
        const hasMenuLink = loginHtml.includes('rsvWTransInstListAction');
        const hasLoginButton = loginHtml.includes('id="btn-login"');

        if (isRedirect || (hasMenuLink && !hasLoginButton)) {
            const location = loginResponse.headers.get('Location');
            console.log(`[Login] ✅ Login Success. Status: ${loginResponse.status}, Location: ${location}`);

            // Step 3: 検索画面への遷移してパラメータ取得
            const homeLoginJKeyMatch = loginHtml.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
            const step3LoginJKey = homeLoginJKeyMatch?.[1] ?? loginJKey;

            const homeDisplayNoMatch = loginHtml.match(/name=["']?displayNo["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
            const step3DisplayNo = homeDisplayNoMatch?.[1] ?? 'pawab2000';

            const step3Params = new URLSearchParams();
            step3Params.append('loginJKey', step3LoginJKey);
            step3Params.append('displayNo', step3DisplayNo);
            step3Params.append('screenName', 'Home');
            step3Params.append('gRsvWTransInstListAction', '1');

            const step3Response = await fetcher(`${baseUrl}/rsvWTransInstListAction.do`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': getCookieHeader(currentCookies),
                    'Referer': `${baseUrl}/rsvWUserAttestationLoginAction.do`,
                },
                body: step3Params.toString(),
                redirect: 'manual'
            });

            updateCookies(step3Response, currentCookies);
            const step3Buffer = await step3Response.arrayBuffer();
            const step3Html = new TextDecoder('shift-jis').decode(step3Buffer);

            // フォームパラメータ抽出
            const searchFormParams: Record<string, string> = {};
            const formActionRegex = /<form[^>]*action="[^"]*rsvWOpeInstSrchVacantAction\.do"[^>]*>([\s\S]*?)<\/form>/i;
            const formMatch = step3Html.match(formActionRegex);
            if (formMatch) {
                const formContent = formMatch[1];
                const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
                const inputs = [...formContent.matchAll(inputRegex)];
                for (const m of inputs) {
                    searchFormParams[m[1]] = m[2];
                }
                const selectRegex = /<select[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
                const selects = [...formContent.matchAll(selectRegex)];
                for (const s of selects) {
                    const name = s[1];
                    const content = s[2];
                    const selectedMatch = content.match(/<option[^>]*value=["']([^"']+)["'][^>]*selected[^>]*>/i);
                    if (selectedMatch) {
                        searchFormParams[name] = selectedMatch[1];
                    } else {
                        const firstOption = content.match(/<option[^>]*value=["']([^"']+)["'][^>]*>/i);
                        if (firstOption) searchFormParams[name] = firstOption[1];
                    }
                }
            }

            const rLoginJKeyMatch = step3Html.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
            const rLoginJKey = rLoginJKeyMatch?.[1] ?? step3LoginJKey;

            return {
                cookie: getCookieHeader(currentCookies),
                loginJKey: rLoginJKey,
                displayNo: 'prwrc2000',
                errorParams: {},
                searchFormParams: Object.keys(searchFormParams).length > 0 ? searchFormParams : undefined
            };
        }

        const titleMatch = loginHtml.match(/<title>([^<]*)<\/title>/i);
        const pageTitle = titleMatch ? titleMatch[1] : 'Unknown';
        console.error(`[Login] ❌ Failed. Title: ${pageTitle}`);

        // DEBUG: Save login failure HTML
        try {
            // @ts-ignore
            const fs = require('fs');
            // @ts-ignore
            const path = require('path');
            // @ts-ignore
            const debugPath = path.join(process.cwd(), 'debug_html', 'login_failure.html');
            fs.writeFileSync(debugPath, loginHtml);
            console.error(`[Login] Saved failure HTML to: ${debugPath}`);
        } catch (e) { }

        return null;

    } catch (e) {
        console.error('[Login] ❌ Exception:', e);
        return null;
    }
}

// =============================================================================
// Availability Check Logic
// =============================================================================

export async function checkShinagawaAvailability(
    facilityId: string,
    date: string,
    timeSlot: string,
    credentials: SiteCredentials,
    existingReservations?: ReservationHistory[],
    session?: ShinagawaSession | null,
    fetchImpl?: typeof fetch // [NEW] Dependency Injection
): Promise<AvailabilityResult> {
    const fetcher = fetchImpl || globalThis.fetch;

    // 既存予約チェック
    const isAlreadyReserved = existingReservations?.some(
        r => r.site === 'shinagawa' &&
            r.facilityId === facilityId &&
            r.date === date &&
            r.timeSlot === timeSlot &&
            r.status === 'success'
    );

    if (isAlreadyReserved) {
        return {
            available: false,
            facilityId,
            facilityName: '品川区施設',
            date,
            timeSlot,
            currentStatus: '予約済',
            changedToAvailable: false,
        };
    }

    let currentSession = session;
    // Check for incomplete session (missing critical params like loginJKey)
    const isIncompleteSession = currentSession && currentSession.cookie && !currentSession.loginJKey;

    if (!currentSession || !currentSession.cookie || isIncompleteSession) {
        if (isIncompleteSession) {
            console.log('[Shinagawa] Incomplete session detected (missing JKey) in checkShinagawaAvailability. Re-logging in...');
        }
        currentSession = await loginToShinagawa(credentials.username, credentials.password, fetcher);
        if (!currentSession) throw new Error('Login failed');
    }

    // Use Weekly Check Logic which is proven to work
    // Ensure date is yyyy/MM/dd format for shinagawa params
    const formattedDate = date.replace(/-/g, '/');

    console.log(`[Shinagawa] Wrapper: Checking availability via Weekly Logic for ${facilityId} ${formattedDate}`);

    try {
        // We treat the target date as the week start to get that day's data
        const weeklyResult = await checkShinagawaWeeklyAvailability(
            facilityId,
            formattedDate, // Pass yyyy/MM/dd
            currentSession,
            undefined, // facilityInfo not strictly needed for availability check
            credentials,
            fetcher
        );

        // Match Logic: Direct Map Lookup
        // Map key format: "YYYY-MM-DD_HH:MM-HH:MM"
        // Ensure date is formatted correctly (already done in formattedDate)

        let foundStatus: string | undefined;
        let foundKey: string | undefined;

        // Try exact match first
        const exactKey = `${formattedDate}_${timeSlot}`;
        if (weeklyResult.availability.has(exactKey)) {
            foundStatus = weeklyResult.availability.get(exactKey);
            foundKey = exactKey;
        } else {
            // Fallback: Prefix match for time (e.g. input "19:00" matches "19:00-21:00")
            const targetTimeStart = timeSlot.split('-')[0];
            for (const [key, status] of weeklyResult.availability.entries()) {
                if (key.startsWith(`${formattedDate}_${targetTimeStart}`)) {
                    foundStatus = status;
                    foundKey = key;
                    break;
                }
            }
        }

        if (!foundStatus) {
            console.warn(`[Shinagawa] Wrapper: Slot ${timeSlot} not found in availability map.`);
            return {
                available: false, facilityId, facilityName: '品川区施設', date, timeSlot, currentStatus: '×', changedToAvailable: false
            };
        }

        const isAvailable = foundStatus === '○' || foundStatus === '取';
        if (isAvailable) {
            console.log(`[Shinagawa] ⚡ Wrapper SUCCESS: ${foundStatus} 検知: ${facilityId}, ${date}, ${timeSlot}`);
        } else {
            console.log(`[Shinagawa] Wrapper: Slot found but status is ${foundStatus}`);
        }

        return {
            available: isAvailable,
            facilityId,
            facilityName: '品川区施設',
            date,
            timeSlot,
            currentStatus: foundStatus,
            changedToAvailable: isAvailable,
            reservationContext: undefined
        };

    } catch (e: any) {
        console.error(`[Shinagawa] Wrapper Error: ${e.message}`);
        throw e;
    }
}


// =============================================================================
// Helper: Robust Form Extraction
// =============================================================================

/**
 * Extracts value from input/select/textarea by name, insensitive to attribute order.
 * - input: matches <input ... name="key" ... value="val">
 * - select: matches <select ... name="key"> ... <option value="val" selected>
 * - textarea: matches <textarea ... name="key">val</textarea>
 */
function extractInputValue(html: string, name: string): string | undefined {
    // 1. INPUT tag (Attribute order agnostic)
    // Create a regex that searches for the tag and then parses attributes
    // However, JS regex lookbehind/lookahead for variable attributes is hard.
    // Instead, we find the tag snippet first.

    const inputRegex = new RegExp(`<input[^>]*name=["']${name}["'][^>]*>`, 'gi');
    const inputMatch = inputRegex.exec(html);
    if (inputMatch) {
        const tag = inputMatch[0];
        const valueMatch = tag.match(/value=["']([^"']*)["']/i);
        return valueMatch ? valueMatch[1] : ''; // Empty string if value is present but empty
    }

    // 2. SELECT tag
    // Find the select block
    const selectRegex = new RegExp(`<select[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'gi');
    const selectMatch = selectRegex.exec(html);
    if (selectMatch) {
        const innerHtml = selectMatch[1];

        // Robust way: Find all options and check for selected
        const optionRegex = /<option([^>]*)>/gi;
        let match;
        let firstValue = undefined;

        while ((match = optionRegex.exec(innerHtml)) !== null) {
            const attributes = match[1];
            const valueMatch = attributes.match(/value=["']([^"']*)["']/i);
            const value = valueMatch ? valueMatch[1] : '';

            if (firstValue === undefined) firstValue = value;

            // Check for selected attribute
            if (/\bselected\b/i.test(attributes)) {
                return value;
            }
        }

        return firstValue;
    }

    // 3. TEXTAREA tag
    const textareaRegex = new RegExp(`<textarea[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)<\\/textarea>`, 'gi');
    const textareaMatch = textareaRegex.exec(html);
    if (textareaMatch) {
        return textareaMatch[1].trim();
    }

    return undefined;
}


// 修正: エラーコードの定義 (診断力向上)
export const SHINAGAWA_SESSION_EXPIRED = 'SHINAGAWA_SESSION_EXPIRED';
const USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
export const SHINAGAWA_LOGIN_NEEDED = 'SHINAGAWA_LOGIN_NEEDED';
export const SHINAGAWA_PARAM_MISSING = 'SHINAGAWA_PARAM_MISSING';
export const SHINAGAWA_FLOW_ERROR = 'SHINAGAWA_FLOW_ERROR';

function logDiagnostic(label: string, html: string, maxLength: number = 2000): void {
    // 構造だけ残して個人情報っぽいものをマスクするのが理想だが、
    // ここでは簡易的に切り出しを行う。
    const cleanHtml = html.replace(/\n/g, ' ').substring(0, maxLength);
    console.warn(`[Shinagawa] 🩺 DIAGNOSTIC DUMP [${label}]: ${cleanHtml}...`);
}

export async function checkShinagawaWeeklyAvailability(
    facilityId: string,
    weekStartDate: string,
    session: ShinagawaSession,
    facilityInfo?: Facility,
    credentials?: SiteCredentials,
    fetchImpl?: typeof fetch
): Promise<WeeklyAvailabilityResult> {
    const fetcher = fetchImpl || globalThis.fetch;
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';

    // 💡 ステートレス化: 内部での自動ログイン/リトライを廃止
    // 呼び出し元が責任を持って有効なセッションを渡す前提とする
    if (!session || !session.cookie) {
        throw new Error(SHINAGAWA_LOGIN_NEEDED);
    }

    // クレデンシャルが渡されていても、スクレーパー内では再ログインしない
    // (アカウントロック回避のため、SafeSessionWrapper経由で制御する)

    try {
        const today = new Date().toISOString().split('T')[0];
        const useDay = weekStartDate.replace(/-/g, '');

        const areaCode = facilityInfo?.areaCode || '1500'; // Default to Yashio if unknown
        const selectPpsClsCd = facilityInfo?.selectPpsClsCd || '31000000'; // Default Tennis
        const selectPpsCd = facilityInfo?.selectPpsCd || '31011700'; // Default Tennis

        const params: Record<string, string> = {
            date: '4', daystart: today, days: '31', dayofweekClearFlg: '1', timezoneClearFlg: '1',
            selectAreaBcd: `${areaCode}_0`,
            selectIcd: '',
            selectPpsClPpscd: `${selectPpsClsCd}_${selectPpsCd}`,
            displayNo: session.displayNo || 'prwrc2000',
            displayNoFrm: session.displayNo || 'prwrc2000',
            selectInstCd: facilityId,
            useDay: useDay,
            selectPpsClsCd: selectPpsClsCd,
            selectPpsCd: selectPpsCd,
            applyFlg: '0',
        };

        // Don't use stale form params from login if we have facility info
        // if (session.searchFormParams) Object.assign(params, session.searchFormParams);

        params.useDay = useDay;
        params.selectInstCd = facilityId;

        console.log(`[Shinagawa] Checking availability for ${facilityId} (Area: ${areaCode})`);

        // 1. Home (Reset flow) - SKIPPED to prevent session reset
        // const homeRes = await fetcher(`${baseUrl}/rsvWOpeHomeAction.do`, {
        //     headers: { 'Cookie': session.cookie, 'User-Agent': USER_AGENT }
        // });
        // updateSessionCookies(session, homeRes);

        // 2. Search Init
        const initRes = await fetcher(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            // Referer modified to look like we came from the menu/dashboard
            headers: { 'Cookie': session.cookie, 'Referer': `${baseUrl}/rsvWTransInstListAction.do`, 'User-Agent': USER_AGENT }
        });
        updateSessionCookies(session, initRes);

        console.log(`[Shinagawa] Cookies before Search POST: ${session.cookie}`);

        // 3. Vacancy Search POST
        const searchResponse = await fetcher(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': session.cookie,
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`, // Changed from list action
                'User-Agent': USER_AGENT
            },
            body: new URLSearchParams(params).toString(),
        });
        updateSessionCookies(session, searchResponse);

        const buffer = await searchResponse.arrayBuffer();
        const htmlText = new TextDecoder('shift-jis').decode(buffer);

        if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
            console.error('[Shinagawa] Session Expiry detected.');
            // Dump to file for debugging
            try {
                // @ts-ignore
                const fs = require('fs');
                // @ts-ignore
                const path = require('path');
                // @ts-ignore
                const debugPath = path.join(process.cwd(), 'debug_html', 'error_search_response.html');
                fs.writeFileSync(debugPath, htmlText);
                console.error(`[Shinagawa] Full Error HTML saved to: ${debugPath}`);
            } catch (err) {
                console.error('[Shinagawa] Failed to save error HTML:', err);
            }
            throw new Error(SHINAGAWA_SESSION_EXPIRED);
        }

        const cellPattern = /<td[^>]*\sid="(\d{8})_(\d{2})"[^>]*>([\s\S]*?)<\/td>/gi;
        let match;
        const availability = new Map<string, string>();
        const timeCodeToSlot: Record<string, string> = {
            '10': '09:00-11:00', '20': '11:00-13:00', '30': '13:00-15:00',
            '40': '15:00-17:00', '50': '17:00-19:00', '60': '19:00-21:00',
        };

        while ((match = cellPattern.exec(htmlText)) !== null) {
            const dateStr = match[1];
            const timeCode = match[2];
            const cellContent = match[3];
            const timeSlot = timeCodeToSlot[timeCode];
            if (!timeSlot) continue;

            if (facilityInfo?.availableTimeSlots) {
                const start = timeSlot.split('-')[0];
                if (!facilityInfo.availableTimeSlots.includes(start)) continue;
            }

            const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
            let status = '×';
            if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) status = '○';
            else if (cellContent.includes('alt="取消処理中"') || cellContent.includes('calendar_delete')) status = '取';
            else if (cellContent.includes('○')) status = '○';
            else if (cellContent.includes('取')) status = '取';

            availability.set(`${formattedDate}_${timeSlot}`, status);
        }

        // Extract valid context using robust helper
        const extractField = (name: string) => extractInputValue(htmlText, name);

        const reservationContext: ReservationContext = {};
        reservationContext.selectBldCd = extractField('selectBldCd');
        reservationContext.selectBldName = extractField('selectBldName');
        reservationContext.selectInstCd = extractField('selectInstCd') || facilityId;
        reservationContext.selectInstName = extractField('selectInstName');
        reservationContext.selectPpsClsCd = extractField('selectPpsClsCd');
        reservationContext.selectPpsCd = extractField('selectPpsCd');
        reservationContext.displayNo = 'prwrc2000';

        const additionalFields = [
            'date', 'daystart', 'days', 'dayofweekClearFlg', 'timezoneClearFlg',
            'selectAreaBcd', 'selectIcd', 'selectPpsClPpscd', 'displayNoFrm', 'useDay', 'applyFlg'
        ];
        additionalFields.forEach(f => {
            const v = extractField(f);
            if (v) reservationContext[f] = v;
        });

        return {
            facilityId,
            facilityName: '品川区施設',
            weekStartDate,
            availability,
            fetchedAt: Date.now(),
            reservationContext
        };

    } catch (e: any) {
        throw e;
    }
}

// =============================================================================
// Reservation Logic
// =============================================================================

export async function makeShinagawaReservation(
    facilityId: string,
    date: string,
    timeSlot: string,
    session: ShinagawaSession,
    target: { applicantCount?: number; eventName?: string }, // eventName added
    weeklyContext?: ReservationContext,
    dryRun: boolean = false,
    fetchImpl?: typeof fetch
): Promise<{ success: boolean; message: string }> {
    const fetcher = fetchImpl || globalThis.fetch;
    const SHINAGAWA_TIMESLOT_MAP: Record<string, string> = {
        '09:00': '10', '11:00': '20', '13:00': '30', '15:00': '40', '17:00': '50', '19:00': '60'
    };

    try {
        console.log(`[Shinagawa] Making reservation: ${facilityId}, ${date}, ${timeSlot} (DryRun: ${dryRun})`);
        const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
        const formParams = { ...session.searchFormParams }; // Start with basic params

        // Use provided context to override params (ensure we use the latest state)
        if (weeklyContext) {
            Object.assign(formParams, weeklyContext);
        }

        const startTimeStr = timeSlot.split('-')[0];
        const tzoneNo = SHINAGAWA_TIMESLOT_MAP[startTimeStr];
        if (!tzoneNo) return { success: false, message: 'Unknown time slot' };

        const [sStr, eStr] = timeSlot.split('-');
        const startTime = sStr.replace(':', '');
        const endTime = eStr ? eStr.replace(':', '') : '';
        const bldCd = facilityId.substring(0, 4);
        const useDay = date.replace(/-/g, '');

        // 1. AJAX Selection
        const ajaxParams = new URLSearchParams();
        ajaxParams.append('displayNo', session.displayNo || 'prwrc2000');
        ajaxParams.append('bldCd', bldCd);
        ajaxParams.append('selectBldCd', bldCd); // Redundant

        ajaxParams.append('instCd', facilityId);
        ajaxParams.append('selectInstCd', facilityId); // Redundant

        ajaxParams.append('useDay', useDay);
        ajaxParams.append('startTime', startTime);
        ajaxParams.append('endTime', endTime);
        ajaxParams.append('tzoneNo', tzoneNo);
        ajaxParams.append('akiNum', '0');
        ajaxParams.append('selectNum', '0');

        // [FIX] Add Purpose Codes (Missing causing e430010 error "Purpose not specified")
        // Mapping: selectPpsCd -> ppsCd, selectPpsClsCd -> ppsClsCd
        const currentPpsCd = formParams['selectPpsCd'] || '31011700'; // Default Tennis
        const currentPpsClsCd = formParams['selectPpsClsCd'] || '31000000';

        ajaxParams.append('ppsCd', currentPpsCd);
        ajaxParams.append('selectPpsCd', currentPpsCd); // Redundant

        ajaxParams.append('ppsClsCd', currentPpsClsCd);
        ajaxParams.append('selectPpsClsCd', currentPpsClsCd); // Redundant
        // Sometimes legacy systems need both or specific variations, but starting with these matches the short-name pattern (bldCd, instCd)

        console.log('[Shinagawa] AJAX Params:', ajaxParams.toString());

        const ajaxResponse = await fetcher(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': session.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
                'Origin': 'https://www.cm9.eprs.jp'
            },
            body: ajaxParams.toString()
        });

        if (!ajaxResponse.ok) return { success: false, message: `AJAX failed: ${ajaxResponse.status}` };

        // [FIX] Parse the selection page HTML to get all hidden fields (selectBldName, selectInstName, etc.)
        // valid session state depends on these being correct.
        // [FIX] Decode extraction page with reliable encoding (windows-31j covers most JP chars)
        const buffer = await ajaxResponse.arrayBuffer();
        let selectionHtml = '';
        try {
            const decoder = new TextDecoder('windows-31j');
            selectionHtml = decoder.decode(buffer);
        } catch (e) {
            console.warn('TextDecoder error, falling back to shift-jis/utf-8', e);
            try {
                selectionHtml = new TextDecoder('shift-jis').decode(buffer);
            } catch (e2) {
                selectionHtml = new TextDecoder('utf-8').decode(buffer);
            }
        }
        updateSessionCookies(session, ajaxResponse);

        // Extract hidden fields from selection page
        const selectionParams: Record<string, string> = {};
        const hiddenRegex = /<input[^>]*type=["']hidden["'][^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
        const inputs = [...selectionHtml.matchAll(hiddenRegex)];
        inputs.forEach(match => {
            if (match[1] && match[2] !== undefined) {
                // [CRITICAL] Filter out garbage keys/values (Mojibake often results in \uFFFD)
                if (match[1].includes('\uFFFD') || match[2].includes('\uFFFD')) return;
                selectionParams[match[1]] = match[2];
            }
        });

        // Also capture generic inputs if regex missed them (using the robust regex I extracted earlier)
        const robustInputRegex = /<input([\s\S]*?)>/gi;
        const robustInputs = [...selectionHtml.matchAll(robustInputRegex)];
        robustInputs.forEach(match => {
            const attrs = match[1];
            if (/type=["']?hidden["']?/i.test(attrs)) {
                const nameMatch = attrs.match(/name=["']?([^"'\s>]+)["']?/i);
                const valueMatch = attrs.match(/value=["']?([^"']*)["']?/i);
                if (nameMatch) {
                    const name = nameMatch[1];
                    const val = valueMatch ? valueMatch[1] : '';
                    if (!name.includes('\uFFFD') && !val.includes('\uFFFD')) {
                        if (!(name in selectionParams)) selectionParams[name] = val;
                    }
                }
            }
        });

        // 2. Application Form (Transition to Terms or Details)
        // Base params come from the page we just loaded (Critical fix)
        // Using manual map for robustness if regex failed completely
        const applyParams = new URLSearchParams();
        for (const [k, v] of Object.entries(selectionParams)) applyParams.append(k, v);

        if (!applyParams.has('applyFlg')) applyParams.append('applyFlg', '1');
        applyParams.set('selectInstCd', facilityId);
        applyParams.set('useDay', useDay);

        // [FIX] Ensure critical context params are set (Fallbacks if value is empty/invalid)
        // The previous !has() check was insufficient because extraction might return "" or "0"
        const currentBldCd = applyParams.get('selectBldCd');
        if (!currentBldCd || currentBldCd === '') applyParams.set('selectBldCd', facilityId.substring(0, 4));

        const checkPpsCd = applyParams.get('selectPpsCd');
        if (!checkPpsCd || checkPpsCd === '' || checkPpsCd === '0') applyParams.set('selectPpsCd', '31011700');

        const checkPpsClsCd = applyParams.get('selectPpsClsCd');
        if (!checkPpsClsCd || checkPpsClsCd === '' || checkPpsClsCd === '0') applyParams.set('selectPpsClsCd', '31000000');

        // [FIX] Supply Names if missing (Using generic defaults if extraction failed or names are empty)
        const bldName = applyParams.get('selectBldName');
        if (!bldName || bldName === '') applyParams.set('selectBldName', 'しながわ区民公園');
        const instName = applyParams.get('selectInstName');
        if (!instName || instName === '') applyParams.set('selectInstName', 'しながわ区民公園（庭球場）');

        // [FIX] Add missing parameters that setReserv() would normally set on client-side
        applyParams.set('useDate', useDay);
        applyParams.set('useTimeNo', tzoneNo); // e.g., '10'
        applyParams.set('useTimeKbn', '1'); // 1=Standard/Timezone
        applyParams.set('useTimeFrom', startTime.padStart(4, '0'));
        applyParams.set('useTimeTo', endTime.padStart(4, '0'));
        applyParams.set('useFieldNum', '1'); // Usually 1 court

        console.log('[Shinagawa] Apply Params:', applyParams.toString());

        const applyResponse = await fetcher(`${baseUrl}/rsvWOpeReservedApplyAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': session.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`
            },
            body: applyParams.toString()
        });
        updateSessionCookies(session, applyResponse);

        // Correctly decode Term Agreement page key (might contain japanese error messages if failed)
        let currentHtml = new TextDecoder('shift-jis').decode(await applyResponse.arrayBuffer());

        // 3. Terms rule Agreement (If present)
        // Check for specific form action or text indicating terms page
        if (currentHtml.includes('利用規約') && currentHtml.includes('rsvWInstUseruleRsvApplyAction')) {
            console.log('[Shinagawa] Terms of Use page detected. Agreeing...');

            const ruleParams = new URLSearchParams();

            // Generic extraction of all hidden inputs to preserve session state
            // Robust regex to capture <input ... > tags (handling newlines and attribute order)
            const inputTagRegex = /<input([\s\S]*?)>/gi;
            const inputTags = [...currentHtml.matchAll(inputTagRegex)];

            inputTags.forEach(match => {
                const attrs = match[1];
                if (/type=["']?hidden["']?/i.test(attrs)) {
                    const nameMatch = attrs.match(/name=["']?([^"'\s>]+)["']?/i);
                    const valueMatch = attrs.match(/value=["']?([^"']*)["']?/i);
                    if (nameMatch) {
                        const name = nameMatch[1];
                        const value = valueMatch ? valueMatch[1] : '';
                        ruleParams.append(name, value);
                    }
                }
            });

            // Ensure specific agreement params
            ruleParams.set('ruleFg', '1'); // Agree
            ruleParams.set('displayNo', 'prwcd1000');

            // Log parameters for debugging
            console.log('[Shinagawa] Terms Params Keys:', [...ruleParams.keys()].join(', '));

            const ruleResponse = await fetcher(`${baseUrl}/rsvWInstUseruleRsvApplyAction.do`, {
                method: 'POST',
                headers: {
                    'Cookie': session.cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`
                },
                body: ruleParams.toString()
            });
            updateSessionCookies(session, ruleResponse);
            currentHtml = await ruleResponse.text();

            // Check for error page immediately
            if (currentHtml.includes('pawfa1000') || currentHtml.includes('エラー')) {
                console.error('[Shinagawa] Terms Agreement resulted in Error Page (pawfa1000).');
                logDiagnostic('TermsError', currentHtml);
                const errorMatch = currentHtml.match(/<div[^>]*class="[^"]*error[^"]*"[^>]*>(.*?)<\/div>/s);
                if (errorMatch) console.error('[Shinagawa] Server Error Message:', errorMatch[1].trim());
            }
        }

        // 4. Details Entry (Purpose, People, EventName)
        // We should now be on the Details page (sinagawa_yoyaku_2.html)
        if (!currentHtml.includes('rsvWInstRsvApplyAction') && !currentHtml.includes('予約内容確認')) {
            console.warn('[Shinagawa] Unexpected page content after Terms. Dumping snippet...');
            console.log(currentHtml.substring(0, 1000));
        }

        // Extract hidden fields needed for the final POST
        // insIRsvJKey is CRITICAL.
        const extractField = (name: string) => extractInputValue(currentHtml, name);
        const insIRsvJKey = extractField('insIRsvJKey');

        if (!insIRsvJKey) {
            console.error('[Shinagawa] CRITICAL: insIRsvJKey not found in details page.');
            logDiagnostic('MissingJKey', currentHtml);
            return {
                success: false,
                message: `${SHINAGAWA_FLOW_ERROR}: Failed to extract session key (insIRsvJKey).`
            };
        }

        const detailsParams = new URLSearchParams();

        // Populate Hidden Fields
        const hiddenFields = [
            'displayNo', 'stimeZoneNo', 'etimeZoneNo', 'ppsdCd', 'ppsCd',
            'field', 'selectRsvDetailNo', 'MaxApplyNum'
        ];
        hiddenFields.forEach(f => {
            const val = extractField(f);
            if (val) detailsParams.append(f, val);
        });

        // Populate User Input Fields
        // hardcoded for Tennis based on flow analysis
        detailsParams.append('purpose', '31000000_31011700');

        // Applicant Count & Event Name
        const applicantCount = target.applicantCount || 2;
        const eventName = target.eventName || 'サークル練習会';

        detailsParams.append('applyNum', applicantCount.toString());
        detailsParams.append('eventName', eventName);

        // Append Key
        detailsParams.append('insIRsvJKey', insIRsvJKey);

        console.log(`[Shinagawa] Prepared Application. Key found: ${insIRsvJKey.substring(0, 10)}...`);

        // --- SAFE-BY-DEFAULT GUARD ---
        // 最終的な予約実行（POST）を行う前に、厳格な条件チェックを行う。
        const shouldExecute = (!dryRun && (target as any).executeReservation === true);

        if (!shouldExecute) {
            console.log('[Shinagawa] 🛡️ SAFETY GUARD: Skipping final reservation apply.');
            console.log(`[Shinagawa] Reason: dryRun=${dryRun}, executeReservation=${(target as any).executeReservation}`);

            // Validation check (Soft Guard)
            // Just return success here implies we reached the final step successfully.
            return { success: true, message: 'DryRun/Guard: Reached Details Entry successfully (Commit Skipped)' };
        }

        console.log('[Shinagawa] 🚀 EXECUTING FINAL APPLICATION (Real Reservation)...');

        // 5. Final Application POST
        const resultRes = await fetcher(`${baseUrl}/rsvWInstRsvApplyAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseUrl}/rsvWInstUseruleRsvApplyAction.do` // Referer from Terms action (or Apply action if Terms skipped)
            },
            body: detailsParams.toString()
        });
        updateSessionCookies(session, resultRes);
        const resultHtml = await resultRes.text();

        // 6. Result Analysis
        // Check for success message or reservation number
        // Based on other systems, often there's a "Reservation Complete" message or a number.
        // Analysis of sinagawa_yoyaku_2.html doesn't show the result page, but common patterns apply.

        const rsvNoMatch = resultHtml.match(/予約番号[:\s]*(\d+)/) || resultHtml.match(/受付番号[:\s]*(\d+)/);

        if (rsvNoMatch) {
            const reservationNumber = rsvNoMatch[1];
            console.log(`[Shinagawa] ✅ Reservation Confirmed! Number: ${reservationNumber}`);
            return { success: true, message: `予約完了: No.${reservationNumber}` };
        } else if (resultHtml.includes('予約完了') || resultHtml.includes('受け付けました') || resultHtml.includes('申し受けました')) {
            console.log('[Shinagawa] ✅ Reservation Confirmed (Message detection).');
            return { success: true, message: '予約完了' };
        } else {
            // Error detection
            console.error('[Shinagawa] ❌ Reservation might have failed. Analyzing response...');
            const errorMatch = resultHtml.match(/<font[^>]*color=["']red["'][^>]*>([\s\S]*?)<\/font>/i) ||
                resultHtml.match(/class=["']error["'][^>]*>([\s\S]*?)<\//i);
            const errorMessage = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, '').trim() : '不明なエラー（完了画面解析失敗）';

            console.error(`[Shinagawa] Error Message: ${errorMessage}`);
            logDiagnostic('ReservationFailed', resultHtml);

            return { success: false, message: errorMessage };
        }

    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

// =============================================================================
// Facilities Logic
// =============================================================================

export async function getShinagawaFacilities(
    credentials: SiteCredentials,
    kv: KVNamespace,
    userId?: string,
    existingSession?: ShinagawaSession,
    fetchImpl?: typeof fetch
): Promise<Facility[]> {
    const fetcher = fetchImpl || globalThis.fetch;
    try {
        const cacheKey = userId ? `shinagawa:facilities:${userId}` : 'shinagawa:facilities:cache';
        const cached = await kv.get(cacheKey, 'json');
        if (cached) return cached as Facility[];

        console.log('[Facilities] Fetching Shinagawa facilities dynamically');

        let session = existingSession;
        if (!session) {
            const loginResult = await loginToShinagawa(credentials.username, credentials.password);
            session = loginResult || undefined;
        }

        if (!session) return getShinagawaFacilitiesFallback();

        const facilities: Facility[] = [];
        const areas = [{ code: '1200', name: '大井地区' }, { code: '1400', name: '品川地区' }, { code: '1500', name: '八潮地区' }];

        for (const area of areas) {
            try {
                const areaFacilities = await fetchShinagawaAreaFacilities(session, area.code, area.name);
                facilities.push(...areaFacilities);
            } catch (error) {
                console.error(`[Facilities] Error fetching ${area.name}:`, error);
            }
        }

        if (facilities.length === 0) return getShinagawaFacilitiesFallback();

        await kv.put(cacheKey, JSON.stringify(facilities), { expirationTtl: 21600 });
        return facilities;

    } catch (error) {
        console.error('[Facilities] Error:', error);
        return getShinagawaFacilitiesFallback();
    }
}

export async function getShinagawaTennisCourts(
    credentials: SiteCredentials,
    kv: KVNamespace,
    userId?: string,
    session?: ShinagawaSession
): Promise<Facility[]> {
    const allFacilities = await getShinagawaFacilities(credentials, kv, userId, session);
    return allFacilities.filter(f => f.isTennisCourt);
}

// Helper: Fetch Area Facilities
async function fetchShinagawaAreaFacilities(
    session: ShinagawaSession,
    areaCode: string,
    areaName: string
): Promise<Facility[]> {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';

    // 1. Home
    const homeRes = await fetch(`${baseUrl}/rsvWOpeHomeAction.do`, {
        headers: { 'Cookie': session.cookie }
    });
    updateSessionCookies(session, homeRes);

    // 2. Search Init
    const initRes = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
        headers: { 'Cookie': session.cookie, 'Referer': `${baseUrl}/rsvWOpeHomeAction.do` }
    });
    updateSessionCookies(session, initRes);

    // 3. Search POST
    const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
    const formData = new URLSearchParams({
        'date': '4',
        'daystart': today,
        'days': '31',
        'dayofweekClearFlg': '1',
        'timezoneClearFlg': '1',
        'selectAreaBcd': `${areaCode}_0`,
        'selectIcd': '',
        'selectPpsClPpscd': '31000000_31011700',
        'displayNo': 'pawab2000',
        'displayNoFrm': 'pawab2000',
    });

    const response = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Cookie': session.cookie
        },
        body: formData.toString()
    });
    updateSessionCookies(session, response);

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder('shift-jis').decode(buffer);
    return parseShinagawaFacilitiesFromHtml(html, areaCode, areaName);
}

function parseShinagawaFacilitiesFromHtml(html: string, areaCode: string, areaName: string): Facility[] {
    const facilities: Facility[] = [];

    // Find mansion select
    let mansionSelectMatch = html.match(/<select[^>]*id="mansion-select"[^>]*>([\s\S]*?)<\/select>/i);
    if (!mansionSelectMatch) mansionSelectMatch = html.match(/<select[^>]*name="selectAreaBcd"[^>]*>([\s\S]*?)<\/select>/i);
    if (!mansionSelectMatch) mansionSelectMatch = html.match(/<select[^>]*name="selectIcd"[^>]*>([\s\S]*?)<\/select>/i);

    if (!mansionSelectMatch) return facilities;

    const buildings: Array<{ id: string; name: string }> = [];
    const optionRegex = /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
    let match;
    while ((match = optionRegex.exec(mansionSelectMatch[1])) !== null) {
        buildings.push({ id: match[1], name: match[2] });
    }

    // Find facility select
    let facilitySelectMatch = html.match(/<select[^>]*id="facility-select"[^>]*>([\s\S]*?)<\/select>/i);
    if (!facilitySelectMatch) facilitySelectMatch = html.match(/<select[^>]*name="selectPpsClPpscd"[^>]*>([\s\S]*?)<\/select>/i);
    if (!facilitySelectMatch) facilitySelectMatch = html.match(/<select[^>]*class="[^"]*facility[^"]*"[^>]*>([\s\S]*?)<\/select>/i);

    if (facilitySelectMatch) {
        const facilityRegex = /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
        while ((match = facilityRegex.exec(facilitySelectMatch[1])) !== null) {
            const courtId = match[1];
            const courtName = match[2];
            const buildingId = courtId.substring(0, 4);
            const building = buildings.find(b => b.id === buildingId);

            if (building && courtName.includes('庭球')) {
                facilities.push({
                    facilityId: courtId,
                    facilityName: `${building.name} ${courtName}`,
                    category: 'tennis',
                    isTennisCourt: true,
                    buildingId: buildingId,
                    buildingName: building.name,
                    areaCode,
                    areaName,
                    site: 'shinagawa'
                });
            }
        }
    } else if (buildings.length > 0) {
        // Fallback: generate default courts if selector not found
        buildings.forEach(building => {
            ['Ａ', 'Ｂ', 'Ｃ', 'Ｄ'].forEach((court, index) => {
                const courtId = `${building.id}00${(index + 1) * 10}`;
                facilities.push({
                    facilityId: courtId,
                    facilityName: `${building.name} 庭球場${court}`,
                    category: 'tennis',
                    isTennisCourt: true,
                    buildingId: building.id,
                    buildingName: building.name,
                    areaCode,
                    areaName,
                    site: 'shinagawa'
                });
            });
        });
    }

    return facilities;
}

function getShinagawaFacilitiesFallback(): Facility[] {
    const shinagawaTimeSlots = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'];
    return [
        { facilityId: '10400010', facilityName: 'しながわ区民公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10400020', facilityName: 'しながわ区民公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10400030', facilityName: 'しながわ区民公園 庭球場Ｃ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10400040', facilityName: 'しながわ区民公園 庭球場Ｄ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10100010', facilityName: 'しながわ中央公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1010', buildingName: 'しながわ中央公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10100020', facilityName: 'しながわ中央公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1010', buildingName: 'しながわ中央公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10200010', facilityName: '東品川公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1020', buildingName: '東品川公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10200020', facilityName: '東品川公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1020', buildingName: '東品川公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10300010', facilityName: '八潮北公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10300020', facilityName: '八潮北公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10300030', facilityName: '八潮北公園 庭球場Ｃ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10300040', facilityName: '八潮北公園 庭球場Ｄ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
        { facilityId: '10300050', facilityName: '八潮北公園 庭球場Ｅ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    ];
}

/**
 * HTMLから検索フォームのパラメータを抽出するヘルパー関数
 */
function extractSearchFormParams(html: string): Record<string, string> {
    const params: Record<string, string> = {};
    const formActionRegex = /<form[^>]*action="[^"]*rsvWOpeInstSrchVacantAction\.do"[^>]*>([\s\S]*?)<\/form>/i;
    const formMatch = html.match(formActionRegex);

    if (formMatch) {
        const formContent = formMatch[1];

        // Inputs
        const inputRegex = /<input[^>]*name=["']([^"']+)["'][^>]*value=["']([^"']*)["'][^>]*>/gi;
        const inputs = [...formContent.matchAll(inputRegex)];
        for (const m of inputs) {
            params[m[1]] = m[2];
        }

        // Selects
        const selectRegex = /<select[^>]*name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi;
        const selects = [...formContent.matchAll(selectRegex)];
        for (const s of selects) {
            const name = s[1];
            const content = s[2];
            const selectedMatch = content.match(/<option[^>]*value=["']([^"']+)["'][^>]*selected[^>]*>/i);
            if (selectedMatch) {
                params[name] = selectedMatch[1];
            } else {
                // If no selected attribute, typically the first option is default, 
                // but checking source might imply we should assume empty or first.
                // For safety, let's grab the first one if value exists.
                const firstOption = content.match(/<option[^>]*value=["']([^"']+)["'][^>]*>/i);
                if (firstOption) params[name] = firstOption[1];
            }
        }
    }
    return params;
}
