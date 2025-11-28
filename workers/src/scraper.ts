// 品川区・港区予約システムのスクレイピングロジック

export interface SiteCredentials {
  username: string;
  password: string;
}

export interface AvailabilityResult {
  available: boolean;
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlot: string;
  previousStatus?: string;
  currentStatus: string;
  changedToAvailable: boolean;
}

export interface SessionData {
  sessionId: string;
  site: 'shinagawa' | 'minato';
  loginTime: number;
  lastUsed: number;
  isValid: boolean;
  userId: string;
}

export interface Facility {
  facilityId: string;
  facilityName: string;
  category: string;
  isTennisCourt: boolean;
  buildingId?: string;  // 館ID (例: "1010")
  buildingName?: string; // 館名 (例: "しながわ中央公園")
  areaCode?: string;     // 地区コード (例: "1400")
  areaName?: string;     // 地区名 (例: "品川地区")
}

export interface ReservationHistory {
  id: string;
  userId: string;
  targetId: string;
  site: 'shinagawa' | 'minato';
  facilityId: string;
  facilityName: string;
  date: string;
  timeSlot: string;
  status: 'success' | 'failed' | 'cancelled';
  message?: string;
  createdAt: number;
}

/**
 * 品川区サイトにログインしてセッションを確立
 */
export async function loginToShinagawa(userId: string, password: string): Promise<string | null> {
  try {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    
    const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
      redirect: 'manual',
    });
    
    // Response Bodyを読み切る（stalled警告を回避）
    await initResponse.text().catch(() => {});
    
    const setCookieHeader = initResponse.headers.get('set-cookie');
    if (!setCookieHeader) {
      console.error('Shinagawa: No session cookie received');
      return null;
    }
    
    const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (!sessionIdMatch) {
      console.error('Shinagawa: Failed to parse JSESSIONID');
      return null;
    }
    
    const sessionId = sessionIdMatch[1];
    console.log('Shinagawa: Session established:', sessionId.substring(0, 20) + '...');
    
    const loginParams = new URLSearchParams({
      'rsvWTransUserLoginForm.usrId': userId,
      'rsvWTransUserLoginForm.usrPswd': password,
    });
    
    const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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
      
      if (responseText.includes('ログインできませんでした') || 
          responseText.includes('利用者番号またはパスワードが正しくありません')) {
        console.error('Shinagawa: Login failed - Invalid credentials');
        return null;
      }
      
      console.log('Shinagawa: Login successful');
      return sessionId;
    } else {
      console.error('Shinagawa: Login failed with status:', loginResponse.status);
      return null;
    }
    
  } catch (error) {
    console.error('Shinagawa: Login error:', error);
    return null;
  }
}

export async function checkShinagawaAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials,
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  try {
    console.log(`[Shinagawa] Checking availability: ${facilityId}, ${date}, ${timeSlot}`);
    
    // 既に予約済み（キャンセル済み除く）かチェック
    const isAlreadyReserved = existingReservations?.some(
      r => r.site === 'shinagawa' && 
           r.facilityId === facilityId && 
           r.date === date && 
           r.timeSlot === timeSlot &&
           r.status === 'success'
    );
    
    if (isAlreadyReserved) {
      console.log(`[Shinagawa] Already reserved: ${facilityId}, ${date}, ${timeSlot}`);
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
    
    // 自動ログイン
    const sessionId = await loginToShinagawa(credentials.username, credentials.password);
    if (!sessionId) {
      throw new Error('Login failed');
    }
    
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    const searchParams = new URLSearchParams({
      'rsvWOpeInstSrchVacantForm.instCd': facilityId,
      'rsvWOpeInstSrchVacantForm.srchDate': date,
    });
    
    const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
      },
    });
    
    const htmlText = await searchResponse.text();
    
    // ログイン失敗チェック
    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
      throw new Error('Login failed or session expired');
    }
    
    const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×取])`));
    const currentStatus = statusMatch ? statusMatch[1] : '×';
    const isAvailable = currentStatus === '○';
    
    console.log(`[Shinagawa] Status for ${timeSlot}: ${currentStatus}`);
    
    return {
      available: isAvailable,
      facilityId,
      facilityName: '品川区施設',
      date,
      timeSlot,
      currentStatus,
      changedToAvailable: isAvailable,
    };
    
  } catch (error: any) {
    console.error('[Shinagawa] Scraping error:', error);
    throw new Error(`Failed to check Shinagawa availability: ${error.message}`);
  }
}

export async function checkMinatoAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials,
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  try {
    console.log(`[Minato] Checking availability: ${facilityId}, ${date}, ${timeSlot}`);
    
    // 既に予約済み（キャンセル済み除く）かチェック
    const isAlreadyReserved = existingReservations?.some(
      r => r.site === 'minato' && 
           r.facilityId === facilityId && 
           r.date === date && 
           r.timeSlot === timeSlot &&
           r.status === 'success'
    );
    
    if (isAlreadyReserved) {
      console.log(`[Minato] Already reserved: ${facilityId}, ${date}, ${timeSlot}`);
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
    
    // 自動ログイン
    const sessionId = await loginToMinato(credentials.username, credentials.password);
    if (!sessionId) {
      throw new Error('Login failed');
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
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
      },
    });
    
    const htmlText = await searchResponse.text();
    
    // ログイン失敗チェック
    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
      throw new Error('Login failed or session expired');
    }
    
    // 港区は「○×」のみ（「取」なし）
    const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×])`));
    const currentStatus = statusMatch ? statusMatch[1] : '×';
    const isAvailable = currentStatus === '○';
    
    console.log(`[Minato] Status for ${timeSlot}: ${currentStatus}`);
    
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

export async function makeShinagawaReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[Shinagawa] Making reservation: ${facilityId}, ${date}, ${timeSlot}`);
    
    // 自動ログイン
    const sessionId = await loginToShinagawa(credentials.username, credentials.password);
    if (!sessionId) {
      return { success: false, message: 'ログインに失敗しました' };
    }
    
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    
    const searchParams = new URLSearchParams({
      'rsvWOpeInstSrchVacantForm.instCd': facilityId,
      'rsvWOpeInstSrchVacantForm.srchDate': date,
    });
    
    const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do?${searchParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
      },
    });
    
    const searchHtml = await searchResponse.text();
    
    const linkMatch = searchHtml.match(/rsvWOpeReservedApplyAction\.do\?[^"]*instNo=([^&"]*)&dateNo=([^&"]*)&timeNo=([^"]*)/);
    
    if (!linkMatch) {
      return { success: false, message: '予約対象が見つかりません' };
    }
    
    const [, instNo, dateNo, timeNo] = linkMatch;
    
    const applyParams = new URLSearchParams({ instNo, dateNo, timeNo });
    
    const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do?${applyParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
      },
    });
    // Response Bodyを読み切る
    await applyResponse.text().catch(() => {});
    
    const confirmParams = new URLSearchParams({
      'rsvWOpeReservedApplyForm.instNo': instNo,
      'rsvWOpeReservedApplyForm.dateNo': dateNo,
      'rsvWOpeReservedApplyForm.timeNo': timeNo,
      'rsvWOpeReservedApplyForm.agree': 'on',
    });
    
    const confirmResponse = await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`,
      },
      body: confirmParams.toString(),
    });
    // Response Bodyを読み切る
    await confirmResponse.text().catch(() => {});
    
    const reserveParams = new URLSearchParams({
      'rsvWOpeReservedConfirmForm.instNo': instNo,
      'rsvWOpeReservedConfirmForm.dateNo': dateNo,
      'rsvWOpeReservedConfirmForm.timeNo': timeNo,
      'rsvWOpeReservedConfirmForm.usrNum': '2',
    });
    
    const reserveResponse = await fetch(`${baseUrl}/rsvWOpeReservedCompleteAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeReservedConfirmAction.do`,
      },
      body: reserveParams.toString(),
    });
    
    const reserveHtml = await reserveResponse.text();
    
    if (reserveHtml.includes('予約が完了しました') || reserveHtml.includes('予約を受け付けました')) {
      console.log('[Shinagawa] Reservation successful');
      return { success: true, message: '予約に成功しました' };
    } else {
      console.error('[Shinagawa] Reservation failed');
      return { success: false, message: '予約に失敗しました' };
    }
    
  } catch (error: any) {
    console.error('[Shinagawa] Reservation error:', error);
    return {
      success: false,
      message: `予約エラー: ${error.message}`,
    };
  }
}

/**
 * セッション情報を保存（永続化）
 */
export async function saveSession(
  site: 'shinagawa' | 'minato',
  sessionData: SessionData,
  kv: KVNamespace
): Promise<void> {
  const key = `session:${site}:${sessionData.userId}`;
  await kv.put(key, JSON.stringify(sessionData), {
    expirationTtl: 86400, // 24時間
  });
  console.log(`[Session] Saved for ${site}:${sessionData.userId}`);
}

/**
 * セッション情報を取得
 */
export async function getSession(
  site: 'shinagawa' | 'minato',
  userId: string,
  kv: KVNamespace
): Promise<SessionData | null> {
  const key = `session:${site}:${userId}`;
  const data = await kv.get(key);
  if (!data) return null;
  
  const session: SessionData = JSON.parse(data);
  
  // 3:15〜5:00はシステムリセット期間（セッション無効）
  const now = new Date();
  const hour = now.getHours();
  if (hour >= 3 && hour < 5) {
    session.isValid = false;
  }
  
  return session;
}

/**
 * セッションの有効性を検証
 */
export async function validateSession(
  sessionId: string,
  site: 'shinagawa' | 'minato'
): Promise<boolean> {
  try {
    const baseUrl = site === 'shinagawa' 
      ? 'https://www.cm9.eprs.jp/shinagawa/web'
      : 'https://web101.rsv.ws-scs.jp/web';
    
    const response = await fetch(`${baseUrl}/rsvWMyPageMenuAction.do`, {
      method: 'GET',
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    
    const html = await response.text();
    return !html.includes('rsvWTransUserLoginAction') && response.status === 200;
  } catch (error) {
    console.error('[Session] Validation error:', error);
    return false;
  }
}

/**
 * セッションを取得または新規ログイン
 */
export async function getOrCreateSession(
  site: 'shinagawa' | 'minato',
  credentials: SiteCredentials,
  kv: KVNamespace
): Promise<string | null> {
  const existingSession = await getSession(site, credentials.username, kv);
  
  if (existingSession && existingSession.isValid) {
    const isValid = await validateSession(existingSession.sessionId, site);
    
    if (isValid) {
      console.log(`[Session] Reusing existing session for ${site}`);
      existingSession.lastUsed = Date.now();
      await saveSession(site, existingSession, kv);
      return existingSession.sessionId;
    }
  }
  
  // 新規ログイン
  console.log(`[Session] Creating new session for ${site}`);
  const sessionId = site === 'shinagawa'
    ? await loginToShinagawa(credentials.username, credentials.password)
    : null;
  
  if (sessionId) {
    const sessionData: SessionData = {
      sessionId,
      site,
      loginTime: Date.now(),
      lastUsed: Date.now(),
      isValid: true,
      userId: credentials.username,
    };
    await saveSession(site, sessionData, kv);
  }
  
  return sessionId;
}

/**
 * 品川区の施設一覧を動的に取得
 */
export async function getShinagawaFacilities(
  credentials: SiteCredentials,
  kv: KVNamespace
): Promise<Facility[]> {
  try {
    // KVキャッシュをチェック（24時間有効）
    const cacheKey = 'shinagawa:facilities:cache';
    const cached = await kv.get(cacheKey, 'json');
    
    if (cached) {
      console.log('[Facilities] Returning cached Shinagawa facilities');
      return cached as Facility[];
    }

    console.log('[Facilities] Fetching Shinagawa facilities dynamically');
    
    // ログイン
    const sessionId = await loginToShinagawa(credentials.username, credentials.password);
    
    if (!sessionId) {
      console.error('[Facilities] Failed to login to Shinagawa');
      return getShinagawaFacilitiesFallback();
    }
    
    const facilities: Facility[] = [];
    
    // 地区リスト（大井、品川、八潮）
    const areas = [
      { code: '1200', name: '大井地区' },
      { code: '1400', name: '品川地区' },
      { code: '1500', name: '八潮地区' },
    ];
    
    for (const area of areas) {
      try {
        // 各地区のテニスコート検索
        const areaFacilities = await fetchShinagawaAreaFacilities(
          sessionId,
          area.code,
          area.name
        );
        facilities.push(...areaFacilities);
      } catch (error) {
        console.error(`[Facilities] Error fetching ${area.name}:`, error);
      }
    }
    
    // 施設が取得できなかった場合はフォールバック
    if (facilities.length === 0) {
      console.warn('[Facilities] No facilities fetched, using fallback');
      return getShinagawaFacilitiesFallback();
    }
    
    // KVにキャッシュ（24時間）
    await kv.put(cacheKey, JSON.stringify(facilities), {
      expirationTtl: 86400, // 24時間
    });
    
    console.log(`[Facilities] Fetched ${facilities.length} Shinagawa facilities`);
    return facilities;
  } catch (error) {
    console.error('[Facilities] Error fetching Shinagawa facilities:', error);
    
    // エラー時はフォールバック
    return getShinagawaFacilitiesFallback();
  }
}

/**
 * 品川区の特定地区の施設を取得
 */
async function fetchShinagawaAreaFacilities(
  sessionId: string,
  areaCode: string,
  areaName: string
): Promise<Facility[]> {
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
  
  // まずホーム画面にアクセスしてセッションを確立
  const homeUrl = `${baseUrl}/rsvWOpeHomeAction.do`;
  await fetch(homeUrl, {
    method: 'GET',
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
  });
  
  // 空き検索画面にアクセス（テニスで検索）
  const searchUrl = `${baseUrl}/rsvWOpeInstSrchVacantAction.do`;
  
  const today = new Date().toISOString().split('T')[0];
  
  const formData = new URLSearchParams({
    'date': '4',  // 1か月表示
    'daystart': today,
    'days': '31',  // 1か月
    'dayofweekClearFlg': '1',
    'timezoneClearFlg': '1',
    'selectAreaBcd': `${areaCode}_0`,  // 地区すべて
    'selectIcd': '',  // 空文字
    'selectPpsClPpscd': '31000000_31011700',  // テニス
    'displayNo': 'pawab2000',
    'displayNoFrm': 'pawab2000',
  });
  
  const response = await fetch(searchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': `${baseUrl}/rsvWOpeHomeAction.do`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    },
    body: formData.toString(),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch area facilities: ${response.status}`);
  }
  
  const html = await response.text();
  
  // デバッグ: HTMLの詳細を出力
  console.log(`[Parser] Area: ${areaName} (${areaCode})`);
  console.log(`[Parser] HTML length: ${html.length}`);
  console.log(`[Parser] Has mansion-select: ${html.includes('mansion-select')}`);
  console.log(`[Parser] Has facility-select: ${html.includes('facility-select')}`);
  console.log(`[Parser] HTML preview:`, html.substring(0, 1000));
  
  // HTMLから施設・コート情報を抽出
  return parseShinagawaFacilitiesFromHtml(html, areaCode, areaName);
}

/**
 * 品川区のHTMLから施設情報をパース
 */
function parseShinagawaFacilitiesFromHtml(
  html: string,
  areaCode: string,
  areaName: string
): Facility[] {
  const facilities: Facility[] = [];
  
  // 館セレクトボックスをパース
  const mansionSelectMatch = html.match(
    /<select[^>]*id="mansion-select"[^>]*>([\s\S]*?)<\/select>/i
  );
  
  if (!mansionSelectMatch) {
    console.warn('[Parser] Could not find mansion-select');
    return facilities;
  }
  
  const mansionOptions = mansionSelectMatch[1];
  
  // 各館のオプションを抽出
  const optionRegex = /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
  let match;
  
  const buildings: Array<{id: string; name: string}> = [];
  
  while ((match = optionRegex.exec(mansionOptions)) !== null) {
    const buildingId = match[1];
    const buildingName = match[2];
    buildings.push({ id: buildingId, name: buildingName });
  }
  
  // 施設セレクトボックスをパース
  const facilitySelectMatch = html.match(
    /<select[^>]*id="facility-select"[^>]*>([\s\S]*?)<\/select>/i
  );
  
  if (!facilitySelectMatch) {
    console.warn('[Parser] Could not find facility-select');
    return facilities;
  }
  
  const facilityOptions = facilitySelectMatch[1];
  
  // 各コートのオプションを抽出
  const facilityRegex = /<option[^>]*value="(\d+)"[^>]*>([^<]+)<\/option>/gi;
  
  while ((match = facilityRegex.exec(facilityOptions)) !== null) {
    const courtId = match[1];
    const courtName = match[2];
    
    // コートIDから館IDを抽出（最初の4桁）
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
        areaCode: areaCode,
        areaName: areaName,
      });
    }
  }
  
  return facilities;
}

/**
 * フォールバック用のハードコードされた施設一覧
 */
function getShinagawaFacilitiesFallback(): Facility[] {
  console.log('[Facilities] Using fallback Shinagawa facilities');
  
  const facilities: Facility[] = [
    // しながわ中央公園（コートA〜B）
    {
      facilityId: '10100010',
      facilityName: 'しながわ中央公園 庭球場Ａ',
      category: 'tennis',
      isTennisCourt: true,
      buildingId: '1010',
      buildingName: 'しながわ中央公園',
      areaCode: '1400',
      areaName: '品川地区',
    },
    {
      facilityId: '10100020',
      facilityName: 'しながわ中央公園 庭球場Ｂ',
      category: 'tennis',
      isTennisCourt: true,
      buildingId: '1010',
      buildingName: 'しながわ中央公園',
      areaCode: '1400',
      areaName: '品川地区',
    },
    // 東品川公園
    {
      facilityId: '10200010',
      facilityName: '東品川公園 庭球場Ａ',
      category: 'tennis',
      isTennisCourt: true,
      buildingId: '1020',
      buildingName: '東品川公園',
      areaCode: '1400',
      areaName: '品川地区',
    },
    // しながわ区民公園
    {
      facilityId: '10400010',
      facilityName: 'しながわ区民公園 庭球場Ａ',
      category: 'tennis',
      isTennisCourt: true,
      buildingId: '1040',
      buildingName: 'しながわ区民公園',
      areaCode: '1200',
      areaName: '大井地区',
    },
    // 八潮北公園
    {
      facilityId: '10300010',
      facilityName: '八潮北公園 庭球場Ａ',
      category: 'tennis',
      isTennisCourt: true,
      buildingId: '1030',
      buildingName: '八潮北公園',
      areaCode: '1500',
      areaName: '八潮地区',
    },
  ];
  
  
  return facilities;
}/**
 * 品川区のテニスコートのみを取得
 */
export async function getShinagawaTennisCourts(
  credentials: SiteCredentials,
  kv: KVNamespace
): Promise<Facility[]> {
  const allFacilities = await getShinagawaFacilities(credentials, kv);
  return allFacilities.filter(f => f.isTennisCourt);
}

/**
 * 港区サイトにログイン
 */
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
    
    // Response Bodyを読み切る（stalled警告を回避）
    await initResponse.text().catch(() => {});
    
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
    
    const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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

/**
 * 港区の施設一覧を取得
 */
export async function getMinatoFacilities(
  sessionId: string,
  kv: KVNamespace
): Promise<Facility[]> {
  try {
    // KVキャッシュチェック
    const cached = await kv.get('facilities:minato');
    if (cached) {
      console.log('[Facilities] Using cached Minato facilities');
      return JSON.parse(cached);
    }

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
    
    const facilityPattern = /rsvWOpeInstMenuAction\.do\?instNo=([^"']+)["'][^>]*>([^<]+)</g;
    let match;
    
    while ((match = facilityPattern.exec(html)) !== null) {
      const facilityId = match[1];
      const facilityName = match[2].trim();
      const isTennisCourt = facilityName.includes('テニス');
      
      facilities.push({
        facilityId,
        facilityName,
        category: isTennisCourt ? 'tennis' : 'other',
        isTennisCourt,
      });
    }
    
    console.log(`[Facilities] Found ${facilities.length} Minato facilities (${facilities.filter(f => f.isTennisCourt).length} tennis courts)`);
    
    // 動的取得が成功した場合のみキャッシュ
    if (facilities.length > 0) {
      await kv.put('facilities:minato', JSON.stringify(facilities), {
        expirationTtl: 3600,
      });
      return facilities;
    }
    
    // フォールバック: 動的取得失敗時はハードコードデータを返す
    console.log('[Facilities] Using fallback hardcoded Minato facilities');
    return getMinatoFacilitiesFallback();
    
  } catch (error) {
    console.error('[Facilities] Error fetching Minato facilities:', error);
    // エラー時もフォールバックを返す
    return getMinatoFacilitiesFallback();
  }
}

/**
 * 港区施設のフォールバックデータ（動的取得失敗時用）
 */
function getMinatoFacilitiesFallback(): Facility[] {
  return [
    // 麻布運動公園（コートA〜D）
    { facilityId: 'azabu-a', facilityName: '麻布運動公園 テニスコートA', category: 'tennis', isTennisCourt: true },
    { facilityId: 'azabu-b', facilityName: '麻布運動公園 テニスコートB', category: 'tennis', isTennisCourt: true },
    { facilityId: 'azabu-c', facilityName: '麻布運動公園 テニスコートC', category: 'tennis', isTennisCourt: true },
    { facilityId: 'azabu-d', facilityName: '麻布運動公園 テニスコートD', category: 'tennis', isTennisCourt: true },
    // 青山運動場（コートA〜D）
    { facilityId: 'aoyama-ground-a', facilityName: '青山運動場 テニスコートA', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-ground-b', facilityName: '青山運動場 テニスコートB', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-ground-c', facilityName: '青山運動場 テニスコートC', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-ground-d', facilityName: '青山運動場 テニスコートD', category: 'tennis', isTennisCourt: true },
    // 青山中学校（コートA〜D）
    { facilityId: 'aoyama-jhs-a', facilityName: '青山中学校 テニスコートA', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-jhs-b', facilityName: '青山中学校 テニスコートB', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-jhs-c', facilityName: '青山中学校 テニスコートC', category: 'tennis', isTennisCourt: true },
    { facilityId: 'aoyama-jhs-d', facilityName: '青山中学校 テニスコートD', category: 'tennis', isTennisCourt: true },
    // 高松中学校（コートA〜D）
    { facilityId: 'takamatsu-jhs-a', facilityName: '高松中学校 テニスコートA', category: 'tennis', isTennisCourt: true },
    { facilityId: 'takamatsu-jhs-b', facilityName: '高松中学校 テニスコートB', category: 'tennis', isTennisCourt: true },
    { facilityId: 'takamatsu-jhs-c', facilityName: '高松中学校 テニスコートC', category: 'tennis', isTennisCourt: true },
    { facilityId: 'takamatsu-jhs-d', facilityName: '高松中学校 テニスコートD', category: 'tennis', isTennisCourt: true },
    // 芝浦中央公園運動場（コートA〜D）
    { facilityId: 'shibaura-chuo-a', facilityName: '芝浦中央公園運動場 テニスコートA', category: 'tennis', isTennisCourt: true },
    { facilityId: 'shibaura-chuo-b', facilityName: '芝浦中央公園運動場 テニスコートB', category: 'tennis', isTennisCourt: true },
    { facilityId: 'shibaura-chuo-c', facilityName: '芝浦中央公園運動場 テニスコートC', category: 'tennis', isTennisCourt: true },
    { facilityId: 'shibaura-chuo-d', facilityName: '芝浦中央公園運動場 テニスコートD', category: 'tennis', isTennisCourt: true },
  ];
}

/**
 * 港区で予約実行（4段階フロー: 検索→申込→確認→完了）
 */
export async function makeMinatoReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials
): Promise<{ success: boolean; reservationId?: string; error?: string }> {
  try {
    // 自動ログイン
    const sessionId = await loginToMinato(credentials.username, credentials.password);
    if (!sessionId) {
      return { success: false, error: 'ログインに失敗しました' };
    }

    const baseUrl = 'https://web101.rsv.ws-scs.jp/web';

    // ステップ1: 空き検索
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

    // 時間枠のリンクからrsvYykNoを抽出
    const rsvYykNoMatch = searchHtml.match(/rsvWOpeRsvRgstAction\.do\?rsvYykNo=([^&"']+)/);
    if (!rsvYykNoMatch) {
      return { success: false, error: 'Time slot not available' };
    }
    const rsvYykNo = rsvYykNoMatch[1];

    // ステップ2: 予約申込（港区は同意画面スキップ）
    const applyResponse = await fetch(`${baseUrl}/rsvWOpeRsvRgstAction.do?rsvYykNo=${rsvYykNo}`, {
      method: 'GET',
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
      },
    });

    const applyHtml = await applyResponse.text();

    // フォームパラメータ抽出
    const extractFormValue = (html: string, name: string): string => {
      const match = html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'));
      return match ? match[1] : '';
    };

    const formData = new URLSearchParams({
      'rsvWOpeRsvRgstForm.rsvYykNo': extractFormValue(applyHtml, 'rsvWOpeRsvRgstForm.rsvYykNo'),
      'rsvWOpeRsvRgstForm.instCd': extractFormValue(applyHtml, 'rsvWOpeRsvRgstForm.instCd'),
      'rsvWOpeRsvRgstForm.instCls': extractFormValue(applyHtml, 'rsvWOpeRsvRgstForm.instCls'),
      'rsvWOpeRsvRgstForm.useStartDate': extractFormValue(applyHtml, 'rsvWOpeRsvRgstForm.useStartDate'),
      'rsvWOpeRsvRgstForm.useEndDate': extractFormValue(applyHtml, 'rsvWOpeRsvRgstForm.useEndDate'),
    });

    // ステップ3: 予約確認
    const confirmResponse = await fetch(`${baseUrl}/rsvWOpeRsvRgstConfAction.do`, {
      method: 'POST',
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': `${baseUrl}/rsvWOpeRsvRgstAction.do`,
      },
      body: formData.toString(),
    });

    const confirmHtml = await confirmResponse.text();

    // ステップ4: 予約確定
    const completeResponse = await fetch(`${baseUrl}/rsvWOpeRsvRgstCompAction.do`, {
      method: 'POST',
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': `${baseUrl}/rsvWOpeRsvRgstConfAction.do`,
      },
      body: formData.toString(),
    });

    const completeHtml = await completeResponse.text();

    if (completeHtml.includes('予約が完了しました') || completeHtml.includes('予約受付番号')) {
      const reservationIdMatch = completeHtml.match(/予約受付番号[：:]\s*([0-9]+)/);
      const reservationId = reservationIdMatch ? reservationIdMatch[1] : `MINATO_${Date.now()}`;

      console.log(`[Minato] Reservation successful: ${reservationId}`);
      return { success: true, reservationId };
    } else {
      return { success: false, error: 'Reservation failed at completion step' };
    }

  } catch (error: any) {
    console.error('[Minato] Reservation error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}
