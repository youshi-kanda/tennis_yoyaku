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

export async function loginToShinagawa(userId: string, password: string): Promise<ShinagawaSession | null> {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    let sessionId = '';
    let currentCookies = new Map<string, string>();

    try {
        console.log('[Login] 🔐 品川区ログイン開始:', userId.substring(0, 3) + '***');

        // Step 0: トップページアクセス（セッション確立）
        const topResponse = await fetch(`${baseUrl}/`, {
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
        const today = new Date().toISOString().split('T')[0];
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

        const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
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

        // loginJKey抽出
        const loginJKeyMatch = initHtml.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
        if (!loginJKeyMatch) throw new Error('loginJKey not found');
        const loginJKey = loginJKeyMatch[1];

        // displayNo
        const displayNoMatch = initHtml.match(/name=["']?displayNo["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
        const displayNo = displayNoMatch ? displayNoMatch[1] : 'pawab2100';

        // Step 2: ログイン実行
        const passwordChars = password.split('');
        const authParams = new URLSearchParams();
        authParams.append('userId', userId);
        authParams.append('password', password);
        authParams.append('loginJKey', loginJKey);
        authParams.append('displayNo', displayNo);
        authParams.append('displayNoFrm', displayNo);
        authParams.append('fcflg', '');

        passwordChars.forEach(char => {
            authParams.append('loginCharPass', char);
        });

        const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
            method: 'POST',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
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
        if (loginResponse.status === 302 || loginResponse.status === 303 || loginHtml.includes('rsvWTransInstListAction')) {
            console.log('[Login] ✅ Login Success (Redirect detected)');

            // Step 3: 検索画面への遷移してパラメータ取得
            const homeLoginJKeyMatch = loginHtml.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
            const step3LoginJKey = homeLoginJKeyMatch ? homeLoginJKeyMatch[1] : loginJKey;

            const homeDisplayNoMatch = loginHtml.match(/name=["']?displayNo["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
            const step3DisplayNo = homeDisplayNoMatch ? homeDisplayNoMatch[1] : 'pawab2000';

            const step3Params = new URLSearchParams();
            step3Params.append('loginJKey', step3LoginJKey);
            step3Params.append('displayNo', step3DisplayNo);
            step3Params.append('screenName', 'Home');
            step3Params.append('gRsvWTransInstListAction', '1');

            const step3Response = await fetch(`${baseUrl}/rsvWTransInstListAction.do`, {
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
            const rLoginJKey = rLoginJKeyMatch ? rLoginJKeyMatch[1] : step3LoginJKey;

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
    session?: ShinagawaSession | null
): Promise<AvailabilityResult> {

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
    if (!currentSession || !currentSession.cookie) {
        currentSession = await loginToShinagawa(credentials.username, credentials.password);
        if (!currentSession) throw new Error('Login failed');
    }

    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    const useDay = date.replace(/-/g, '');
    const today = new Date().toISOString().split('T')[0];

    // CRITICAL FIX: 施設一覧ページを経由してRefererチェーンを正しく確立
    // これがないと「不正な画面遷移」エラーになる
    const facilityListParams = new URLSearchParams();
    facilityListParams.append('loginJKey', currentSession.loginJKey || '');
    facilityListParams.append('displayNo', currentSession.displayNo || 'prwrc2000');
    facilityListParams.append('screenName', 'Home');
    facilityListParams.append('gRsvWTransInstListAction', '1');

    const facilityListResponse = await fetch(`${baseUrl}/rsvWTransInstListAction.do`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)',
            'Cookie': currentSession.cookie,
            'Referer': `${baseUrl}/rsvWOpeHomeAction.do`,
        },
        body: facilityListParams.toString(),
    });

    const facilityListBuffer = await facilityListResponse.arrayBuffer();
    const facilityListHtml = new TextDecoder('shift-jis').decode(facilityListBuffer);

    if (facilityListHtml.includes('ログイン') || facilityListHtml.includes('セッションが切れました')) {
        throw new Error('Session expired during facility list access');
    }

    // 検索フォームのパラメータを再取得（最新の状態を使用）
    const freshSearchParams = extractSearchFormParams(facilityListHtml);

    const params: Record<string, string> = {
        date: '4',
        daystart: today,
        days: '31',
        dayofweekClearFlg: '1',
        timezoneClearFlg: '1',
        selectAreaBcd: '1500_0',
        selectIcd: '',
        selectPpsClPpscd: '31000000_31011700',
        displayNo: currentSession.displayNo || 'prwrc2000',
        displayNoFrm: currentSession.displayNo || 'prwrc2000',
        selectInstCd: facilityId,
        useDay: useDay,
        selectPpsClsCd: '31000000',
        selectPpsCd: '31011700',
        applyFlg: '0',
    };

    // 施設一覧から取得した最新パラメータを使用
    if (freshSearchParams && Object.keys(freshSearchParams).length > 0) {
        Object.assign(params, freshSearchParams);
    } else if (currentSession.searchFormParams) {
        Object.assign(params, currentSession.searchFormParams);
    }
    params.useDay = useDay;
    params.selectInstCd = facilityId;

    const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X)',
            'Cookie': currentSession.cookie,
            'Referer': `${baseUrl}/rsvWTransInstListAction.do`,  // ← 今度は本当に経由済み
        },
        body: new URLSearchParams(params).toString(),
    });

    const buffer = await searchResponse.arrayBuffer();
    const htmlText = new TextDecoder('shift-jis').decode(buffer);

    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
        throw new Error('Login failed or session expired');
    }

    // コード変換 "11:00-13:00" -> "20"
    const timeSlotToCode: Record<string, string> = {
        '09:00-11:00': '10',
        '11:00-13:00': '20',
        '13:00-15:00': '30',
        '15:00-17:00': '40',
        '17:00-19:00': '50',
        '19:00-21:00': '60',
    };
    const timeCode = timeSlotToCode[timeSlot];

    if (!timeCode) {
        return {
            available: false, facilityId, facilityName: '品川区施設', date, timeSlot, currentStatus: '×', changedToAvailable: false
        };
    }

    const cellIdPattern = `${useDay}_${timeCode}`;
    const cellMatch = htmlText.match(new RegExp(`<td[^>]*\\sid="${cellIdPattern}"[^>]*>([\\s\\S]*?)<\\/td>`));

    let currentStatus = '×';
    if (cellMatch) {
        const cellContent = cellMatch[1];
        if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) {
            currentStatus = '○';
        } else if (/alt=["']取消処理中["']/.test(cellContent) || cellContent.includes('calendar_delete') || cellContent.includes('title="取消処理中"')) {
            currentStatus = '取';
        } else if (cellContent.includes('alt="一部空き"') || cellContent.includes('calendar_few-available')) {
            currentStatus = '△';
        } else if (cellContent.includes('○')) {
            currentStatus = '○';
        } else if (cellContent.includes('取')) {
            currentStatus = '取';
        }
    }

    const isAvailable = currentStatus === '○' || currentStatus === '取';
    if (isAvailable) {
        console.log(`[Shinagawa] ⚡ ${currentStatus} 検知: ${facilityId}, ${date}, ${timeSlot}`);
    }

    // 次の予約アクションに必要なコンテキストを抽出
    const reservationContext = extractSearchFormParams(htmlText);
    // displayNoはセッションから引き継ぐか、HTMLから抽出（HTML優先）
    if (!reservationContext.displayNo && currentSession.displayNo) {
        reservationContext.displayNo = currentSession.displayNo;
    }

    return {
        available: isAvailable,
        facilityId,
        facilityName: '品川区施設',
        date,
        timeSlot,
        currentStatus,
        changedToAvailable: isAvailable,
        reservationContext: Object.keys(reservationContext).length > 0 ? reservationContext : undefined
    };
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
export const SHINAGAWA_LOGIN_NEEDED = 'SHINAGAWA_LOGIN_NEEDED';
export const SHINAGAWA_PARAM_MISSING = 'SHINAGAWA_PARAM_MISSING';
export const SHINAGAWA_FLOW_ERROR = 'SHINAGAWA_FLOW_ERROR';

function logDiagnostic(label: string, html: string, maxLength: number = 2000) {
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
    credentials?: SiteCredentials
): Promise<WeeklyAvailabilityResult> {
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

        // 1. Home (Reset flow)
        const homeRes = await fetch(`${baseUrl}/rsvWOpeHomeAction.do`, {
            headers: { 'Cookie': session.cookie }
        });
        updateSessionCookies(session, homeRes);

        // 2. Search Init
        const initRes = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            headers: { 'Cookie': session.cookie, 'Referer': `${baseUrl}/rsvWOpeHomeAction.do` }
        });
        updateSessionCookies(session, initRes);

        console.log(`[Shinagawa] Cookies before Search POST: ${session.cookie}`);

        // 3. Vacancy Search POST
        const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': session.cookie,
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`, // Changed from list action
            },
            body: new URLSearchParams(params).toString(),
        });
        updateSessionCookies(session, searchResponse);

        const buffer = await searchResponse.arrayBuffer();
        const htmlText = new TextDecoder('shift-jis').decode(buffer);

        if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました')) {
            console.error('[Shinagawa] Session Expiry detected.');
            console.error('[Shinagawa] HTML Snippet:', htmlText.substring(0, 500).replace(/\n/g, ' '));
            // 🔥 即座に特定エラーを投げる
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
    target: { applicantCount?: number },
    weeklyContext?: ReservationContext,
    dryRun: boolean = false
): Promise<{ success: boolean; message: string }> {
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
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                'X-Requested-With': 'XMLHttpRequest',
                'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`
            },
            body: ajaxParams.toString()
        });

        if (!ajaxResponse.ok) return { success: false, message: `AJAX failed: ${ajaxResponse.status}` };

        // 2. Application Form
        const applyParams = new URLSearchParams();
        for (const [k, v] of Object.entries(formParams)) applyParams.append(k, v);
        if (!applyParams.has('applyFlg')) applyParams.append('applyFlg', '1');
        applyParams.set('selectInstCd', facilityId);
        applyParams.set('useDay', useDay);

        const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
            body: applyParams.toString()
        });

        const applyHtml = await applyResponse.text();

        // 3. Terms rule
        if (applyHtml.includes('利用規約')) {
            const ruleParams = new URLSearchParams();
            ruleParams.append('ruleFg', '1');
            ruleParams.append('displayNo', 'prwcd1000');
            await fetch(`${baseUrl}/rsvWInstUseruleRsvApplyAction.do`, {
                method: 'POST',
                headers: {
                    'Cookie': session.cookie,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`
                },
                body: ruleParams.toString()
            });
        }

        // 4. Confirm
        let instNo = '', dateNo = '', timeNo = '';

        // Robust Link Extraction from HTML
        // Find the absolute or relative link to Confirm Action
        // Link format typically: <a href="...ConfirmAction.do?instNo=X&dateNo=Y&timeNo=Z...">
        // OR form action. But mostly it's a link or a javascript submit.

        // Strategy: Look for the specific parameters in any 'href' or 'action' in the HTML
        // This is looser but much improved over a fixed string regex.

        const linkMatch = applyHtml.match(/(?:href|action)=["']([^"']*(?:instNo|dateNo|timeNo)[^"']*)["']/i);

        if (linkMatch) {
            let rawUrl = linkMatch[1];
            // Decode HTML entities (&amp; -> &)
            rawUrl = rawUrl.replace(/&amp;/g, '&');

            // Resolve relative URL
            // baseUrl is https://www.cm9.eprs.jp/shinagawa/web
            const absUrl = new URL(rawUrl, baseUrl);
            const sp = absUrl.searchParams;

            instNo = sp.get('instNo') || '';
            dateNo = sp.get('dateNo') || '';
            timeNo = sp.get('timeNo') || '';

            console.log(`[Shinagawa] Extracted IDs: inst=${instNo}, date=${dateNo}, time=${timeNo}`);
        } else {
            console.warn('[Shinagawa] Could not find Confirm Link/Form in HTML.');
            // Log snippet for debugging
            const confirmSnippet = applyHtml.substring(0, 1000).replace(/\n/g, ' ');
            console.log(`[Shinagawa] HTML Snippet: ${confirmSnippet}...`);
        }

        // CRITICAL CHECK
        if (!instNo || !dateNo || !timeNo) {
            console.error('[Shinagawa] CRITICAL: Missing required reservation parameters (instNo/dateNo/timeNo).');
            logDiagnostic('MissingParams', applyHtml);
            return {
                success: false,
                message: `${SHINAGAWA_PARAM_MISSING}: Failed to extract reservation IDs from page.`
            };
        }

        const confirmParams = new URLSearchParams();
        confirmParams.append('rsvWOpeReservedConfirmForm.instNo', instNo);
        confirmParams.append('rsvWOpeReservedConfirmForm.dateNo', dateNo);
        confirmParams.append('rsvWOpeReservedConfirmForm.timeNo', timeNo);
        confirmParams.append('rsvWOpeReservedConfirmForm.usrNum', (target.applicantCount || 2).toString());
        confirmParams.append('rsvWOpeReservedConfirmForm.eventName', '');

        const confirmRes = await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`
            },
            body: confirmParams.toString()
        });
        const confirmHtml = await confirmRes.text();

        // Check validation errors in confirmation screen
        if (confirmHtml.includes('class="error"') || confirmHtml.includes('color="red"')) {
            console.warn('[Shinagawa] Warning in Confirm screen (might be error or just notice):', confirmHtml.substring(0, 500));
            // If critical error, return failure
            if (confirmHtml.includes('入力をご確認ください') || confirmHtml.includes('既に予約されています')) {
                logDiagnostic('ConfirmError', confirmHtml);
                return { success: false, message: `${SHINAGAWA_FLOW_ERROR}: Failed at confirmation screen (validation error)` };
            }
        }

        // --- SAFE-BY-DEFAULT GUARD ---
        // 最終的な予約実行（POST）を行う前に、厳格な条件チェックを行う。
        // 条件:
        // 1. dryRun が false であること
        // 2. 環境変数 EXECUTE_RESERVATION が "true" であること
        // (注: Cloudflare Workersでは process.env は使えないため、envオブジェクト経由が必要だが、
        //  汎用スクレーパー関数には env が渡されていない。
        //  今回は target.applicantCount などと共に `target` オブジェクトに `executeReservation: boolean` プロパティが含まれていると仮定するか、
        //  あるいは呼び出し元で制御すべきだが、ここで防波堤を作るなら `target` anyキャスト等で対応) 

        const shouldExecute = (!dryRun && (target as any).executeReservation === true);

        if (!shouldExecute) {
            console.log('[Shinagawa] 🛡️ SAFETY GUARD: Skipping final reservation commit.');
            console.log(`[Shinagawa] Reason: dryRun=${dryRun}, executeReservation=${(target as any).executeReservation}`);

            if (confirmHtml.includes('受付内容確認')) {
                return { success: true, message: 'DryRun/Guard: Reached Confirm Screen successfully (Commit Skipped)' };
            } else {
                return { success: false, message: 'DryRun/Guard: Failed to reach Confirm Screen' };
            }
        }

        console.log('[Shinagawa] 🚀 EXECUTING FINAL COMMIT (Real Reservation)...');

        // 5. Complete
        const compRes = await fetch(`${baseUrl}/rsvWOpeReservedCompleteAction.do`, {
            method: 'POST',
            headers: {
                'Cookie': session.cookie,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': `${baseUrl}/rsvWOpeReservedConfirmAction.do`
            },
            body: ''
        });
        const compHtml = await compRes.text();

        // 判定ロジック強化: 予約番号の抽出を必須とする
        // パターン1: "予約番号 : 12345678"
        // パターン2: "受け付けました" + 近くに数字
        const rsvNoMatch = compHtml.match(/予約番号[:\s]*(\d+)/) || compHtml.match(/受付番号[:\s]*(\d+)/);

        if (rsvNoMatch) {
            const reservationNumber = rsvNoMatch[1];
            console.log(`[Shinagawa] ✅ Reservation Confirmed! Number: ${reservationNumber}`);
            return { success: true, message: `予約完了: No.${reservationNumber}` };
        } else if (compHtml.includes('予約完了') || compHtml.includes('受け付けました')) {
            // 文言はあるが番号が取れなかった場合
            console.warn('[Shinagawa] ⚠️ Reservation might be successful but number not found.');
            // 念のためHTMLをログに残す
            console.log(compHtml.substring(0, 3000));
            return { success: true, message: '予約完了 (番号取得失敗)' };
        } else {
            // 🚨 失敗: エラーメッセージの抽出を試みる
            console.error('[Shinagawa] ❌ Reservation Failed. Analyzing response...');

            // エラーメッセージの抽出 (赤字のfontタグなど)
            const errorMatch = compHtml.match(/<font[^>]*color=["']red["'][^>]*>([\s\S]*?)<\/font>/i) ||
                compHtml.match(/class=["']error["'][^>]*>([\s\S]*?)<\//i);

            const errorMessage = errorMatch ? errorMatch[1].replace(/<[^>]+>/g, '').trim() : '不明なエラー';

            console.error(`[Shinagawa] Error Message: ${errorMessage}`);
            console.error('[Shinagawa] HTML Dump (Partial):');
            console.log(compHtml.substring(0, 4000)); // ログ長を拡張

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
    existingSession?: ShinagawaSession
): Promise<Facility[]> {
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
