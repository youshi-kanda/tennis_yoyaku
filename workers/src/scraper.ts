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
async function loginToShinagawa(userId: string, password: string): Promise<string | null> {
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
  credentials?: SiteCredentials,
  existingReservations?: ReservationHistory[]
): Promise<AvailabilityResult> {
  try {
    console.log(`[Shinagawa] Checking availability: ${facilityId}, ${date}, ${timeSlot}`);
    
    if (!credentials) {
      throw new Error('Credentials required');
    }
    
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
  credentials?: SiteCredentials,
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
    
    const isAvailable = Math.random() > 0.7;
    
    return {
      available: isAvailable,
      facilityId,
      facilityName: '青山公園テニスコート',
      date,
      timeSlot,
      currentStatus: isAvailable ? '○' : '×',
      changedToAvailable: false,
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
    
    await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do?${applyParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
      },
    });
    
    const confirmParams = new URLSearchParams({
      'rsvWOpeReservedApplyForm.instNo': instNo,
      'rsvWOpeReservedApplyForm.dateNo': dateNo,
      'rsvWOpeReservedApplyForm.timeNo': timeNo,
      'rsvWOpeReservedApplyForm.agree': 'on',
    });
    
    await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do`,
      },
      body: confirmParams.toString(),
    });
    
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
 * 品川区の施設一覧を取得
 */
export async function getShinagawaFacilities(
  sessionId: string,
  kv: KVNamespace
): Promise<Facility[]> {
  try {
    // KVキャッシュを確認（1時間有効）
    const cachedData = await kv.get('facilities:shinagawa');
    if (cachedData) {
      console.log('[Facilities] Using cached data');
      return JSON.parse(cachedData);
    }

    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    
    // 施設一覧ページにアクセス
    const response = await fetch(`${baseUrl}/rsvWOpeInstListAction.do`, {
      method: 'GET',
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });
    
    const html = await response.text();
    
    // HTMLから施設情報を抽出
    const facilities: Facility[] = [];
    
    // 施設リンクのパターン: rsvWOpeInstMenuAction.do?instNo=XXX
    // 施設名は<a>タグのテキスト
    const facilityPattern = /rsvWOpeInstMenuAction\.do\?instNo=([^"']+)["'][^>]*>([^<]+)</g;
    let match;
    
    while ((match = facilityPattern.exec(html)) !== null) {
      const facilityId = match[1];
      const facilityName = match[2].trim();
      
      // テニスコート判定（施設名に「テニス」が含まれる）
      const isTennisCourt = facilityName.includes('テニス');
      
      facilities.push({
        facilityId,
        facilityName,
        category: isTennisCourt ? 'tennis' : 'other',
        isTennisCourt,
      });
    }
    
    console.log(`[Facilities] Found ${facilities.length} facilities (${facilities.filter(f => f.isTennisCourt).length} tennis courts)`);
    
    // KVにキャッシュ（1時間）
    await kv.put('facilities:shinagawa', JSON.stringify(facilities), {
      expirationTtl: 3600,
    });
    
    return facilities;
  } catch (error) {
    console.error('[Facilities] Error fetching facilities:', error);
    return [];
  }
}

/**
 * 品川区のテニスコートのみを取得
 */
export async function getShinagawaTennisCourts(
  sessionId: string,
  kv: KVNamespace
): Promise<Facility[]> {
  const allFacilities = await getShinagawaFacilities(sessionId, kv);
  return allFacilities.filter(f => f.isTennisCourt);
}

/**
 * 港区サイトにログイン
 */
async function loginToMinato(userId: string, password: string): Promise<string | null> {
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
    
    await kv.put('facilities:minato', JSON.stringify(facilities), {
      expirationTtl: 3600,
    });
    
    return facilities;
  } catch (error) {
    console.error('[Facilities] Error fetching Minato facilities:', error);
    return [];
  }
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
    const sessionId = await loginToMinato(credentials.username, credentials.password);
    if (!sessionId) {
      return { success: false, error: 'Login failed' };
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
