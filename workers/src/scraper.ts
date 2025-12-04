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

/**
 * 予約に必要なコンテキスト情報（週間カレンダーから抽出）
 */
export interface ReservationContext {
  selectBldCd?: string;      // 建物コード
  selectBldName?: string;    // 建物名
  selectInstCd?: string;     // 施設コード
  selectInstName?: string;   // 施設名
  selectPpsClsCd?: string;   // 目的分類コード
  selectPpsCd?: string;      // 目的コード
  viewDays?: string[];       // 7日分の日付（viewDay1〜viewDay7）
  displayNo?: string;        // 画面ID
  [key: string]: any;        // その他のフォームフィールド
}

/**
 * 週単位の空き状況結果
 * キー: "YYYY-MM-DD_HH:MM" 形式（例: "2026-01-14_09:00"）
 * 値: ステータス（"○", "×", "取", "△", "受付期間外"）
 */
export interface WeeklyAvailabilityResult {
  facilityId: string;
  facilityName: string;
  weekStartDate: string;  // 週の開始日（検索基準日）
  availability: Map<string, string>;  // "YYYY-MM-DD_HH:MM" -> status
  fetchedAt: number;
  reservationContext?: ReservationContext;  // 予約に必要なコンテキスト情報
}

// 品川区: 時間帯コード → 時間帯文字列のマッピング
export const SHINAGAWA_TIMESLOT_MAP: { [code: number]: string } = {
  10: '09:00',
  20: '11:00',
  30: '13:00',
  40: '15:00',
  50: '17:00',
  60: '19:00',
};

// 港区: 時間帯コード → 時間帯文字列のマッピング
export const MINATO_TIMESLOT_MAP: { [code: number]: string } = {
  10: '08:00',
  20: '10:00',
  30: '12:00',
  40: '13:00',
  50: '15:00',
  60: '17:00',
  70: '19:00',
};

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
  site?: 'shinagawa' | 'minato';  // 自治体
  availableTimeSlots?: string[];  // 利用可能時間帯 (例: ["09:00", "11:00", "13:00"])
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
    
    console.log('[Login] 🔐 品川区ログイン開始:', userId.substring(0, 3) + '***');
    
    // Step 1: ログイン画面アクセス（セッション確立）
    const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
      },
      redirect: 'manual',
    });
    
    console.log(`[Login] Step1: ログイン画面アクセス - Status: ${initResponse.status}`);
    
    // Response Bodyを読み取る
    const initHtml = await initResponse.text().catch(() => '');
    
    // Set-Cookie ヘッダーチェック
    const setCookieHeader = initResponse.headers.get('set-cookie');
    if (!setCookieHeader) {
      console.error('[Login] ❌ No session cookie received from init');
      console.error(`[Login] Response headers:`, JSON.stringify(Object.fromEntries(initResponse.headers.entries())));
      return null;
    }
    
    const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (!sessionIdMatch) {
      console.error('[Login] ❌ Failed to parse JSESSIONID from:', setCookieHeader);
      return null;
    }
    
    const sessionId = sessionIdMatch[1];
    console.log('[Login] ✅ Session established:', sessionId.substring(0, 20) + '...');
    
    // 隠しフィールド（org.apache.struts.taglib.html.TOKEN など）を抽出
    const hiddenFields: Record<string, string> = {};
    const hiddenPattern = /<input[^>]*type=["']?hidden["']?[^>]*>/gi;
    const matches = initHtml.match(hiddenPattern) || [];
    for (const match of matches) {
      const nameMatch = match.match(/name=["']?([^"'\s>]+)["']?/i);
      const valueMatch = match.match(/value=["']?([^"']*)["']?/i);
      if (nameMatch && valueMatch) {
        hiddenFields[nameMatch[1]] = valueMatch[1];
        console.log('[Login] Hidden field:', nameMatch[1], '=', valueMatch[1].substring(0, 20) + (valueMatch[1].length > 20 ? '...' : ''));
      }
    }
    
    // Step 2: ログイン実行（隠しフィールドを含める）
    const loginParams = new URLSearchParams({
      'rsvWTransUserLoginForm.usrId': userId,
      'rsvWTransUserLoginForm.usrPswd': password,
      ...hiddenFields,  // 隠しフィールドを追加
    });
    
    const loginResponse = await fetch(`${baseUrl}/rsvWUserAttestationLoginAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Origin': baseUrl,
        'Referer': `${baseUrl}/rsvWTransUserLoginAction.do`,
        'Cookie': `JSESSIONID=${sessionId}`,
        'Cache-Control': 'max-age=0',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-User': '?1',
      },
      body: loginParams.toString(),
      redirect: 'manual',
    });
    
    console.log(`[Login] Step2: ログイン実行 - Status: ${loginResponse.status}`);
    
    // レスポンスをShift_JISでデコード
    const responseBuffer = await loginResponse.arrayBuffer();
    const decoder = new TextDecoder('shift-jis');
    const responseText = decoder.decode(responseBuffer);
    
    // ログイン失敗チェック
    if (responseText.includes('ログインできませんでした') || 
        responseText.includes('利用者番号またはパスワードが正しくありません')) {
      console.error('[Login] ❌ 認証失敗 - ID or password incorrect');
      console.error('[Login] Response preview:', responseText.substring(0, 200));
      return null;
    }
    
    // エラーページチェック
    if (responseText.includes('pawfa1000.jsp') || responseText.includes('エラーが発生しました')) {
      console.error('[Login] ❌ エラーページ返却');
      
      // エラーメッセージを抽出 - <body>タグ内のテキストコンテンツを取得
      const bodyMatch = responseText.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      if (bodyMatch) {
        // <script>と<style>タグを除去
        let bodyText = bodyMatch[1]
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')  // HTMLタグを空白に置換
          .replace(/\s+/g, ' ')       // 連続する空白を1つに
          .trim();
        
        console.error('[Login] エラー内容:', bodyText.substring(0, 500));
      } else {
        console.error('[Login] Response preview:', responseText.substring(0, 1000));
      }
      
      return null;
    }
    
    console.log('[Login] ✅ ログイン成功');
    console.log('[Login] Response type check - Length:', responseText.length, 'chars');
    
    // Step 3: セッション有効性検証（空き状況画面にアクセス可能か）
    const testResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchInitAction.do`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWUserAttestationLoginAction.do`,
      },
    });
    
    const testHtml = await testResponse.text();
    console.log(`[Login] Step3: セッション検証 - Status: ${testResponse.status}, HTML length: ${testHtml.length}`);
    
    if (testHtml.includes('pawfa1000.jsp') || testHtml.includes('ログイン')) {
      console.error('[Login] ⚠️ セッション検証失敗 - ログインページにリダイレクト');
      console.error('[Login] Test response preview:', testHtml.substring(0, 300));
      return null;
    }
    
    console.log('[Login] ✅ セッション検証成功');
    return sessionId;
    
  } catch (error) {
    console.error('[Login] ❌ Exception:', error);
    return null;
  }
}

/**
 * 品川区の1週間分の空き状況を一括取得
 * 既存のcheckShinagawaAvailability関数を使用し、週の各日を取得
 * （サイトがエラーページを返す場合のフォールバック実装）
 */
export async function checkShinagawaWeeklyAvailability(
  facilityId: string,
  weekStartDate: string,  // YYYY-MM-DD形式の週開始日
  sessionId: string,
  facilityInfo?: Facility  // 施設情報（時間帯フィルタリング用）
): Promise<WeeklyAvailabilityResult> {
  const availability = new Map<string, string>();
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
  
  try {
    // YYYY-MM-DD → YYYYMMDD
    const useDay = weekStartDate.replace(/-/g, '');
    const today = new Date().toISOString().split('T')[0];
    
    // HARファイルから判明した正しいPOSTパラメータ
    const formData = new URLSearchParams({
      date: '4',
      daystart: today,
      days: '31',
      dayofweekClearFlg: '1',
      timezoneClearFlg: '1',
      selectAreaBcd: '1500_0', // 地域コード（必要に応じて調整）
      selectIcd: '',
      selectPpsClPpscd: '31000000_31011700', // テニス目的
      displayNo: 'prwrc2000',
      displayNoFrm: 'prwrc2000',
      selectInstCd: facilityId,
      useDay: useDay,
      selectPpsClsCd: '31000000',
      selectPpsCd: '31011700',
      applyFlg: '0',
    });
    
    console.log(`[Shinagawa Weekly] POST to rsvWOpeInstSrchVacantAction.do with facilityId=${facilityId}, useDay=${useDay}`);
    
    // 空き状況カレンダーを取得（POST送信）
    const searchResponse = await fetch(`${baseUrl}/rsvWOpeInstSrchVacantAction.do`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': 'https://www.cm9.eprs.jp/shinagawa/web/rsvWUserAttestationLoginAction.do',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      },
      body: formData.toString(),
    });
    
    const htmlText = await searchResponse.text();
    
    // ログイン失敗チェック
    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
      throw new Error('Login failed or session expired');
    }
    
    // エラーページチェック（pawfa1000.jsp はエラーページ）
    if (htmlText.includes('pawfa1000') || htmlText.length < 10000) {
      console.log(`[Shinagawa Weekly] ERROR: Got error page. HTML length: ${htmlText.length}`);
      throw new Error('Session state invalid - got error page');
    }
    
    console.log(`[Shinagawa Weekly] Response length: ${htmlText.length} bytes`);
    
    // デバッグ: HTMLにどのような<td>タグが含まれているか確認
    const sampleTdPattern = /<td[^>]*id="([^"]*)"[^>]*>/gi;
    const sampleIds: string[] = [];
    let sampleMatch;
    while ((sampleMatch = sampleTdPattern.exec(htmlText)) !== null && sampleIds.length < 20) {
      if (sampleMatch[1]) sampleIds.push(sampleMatch[1]);
    }
    if (sampleIds.length > 0) {
      console.log(`[Shinagawa Weekly] Sample cell IDs found: ${sampleIds.slice(0, 10).join(', ')}`);
    } else {
      console.log(`[Shinagawa Weekly] ⚠️ No <td id="..."> tags found in HTML`);
      // HTMLの最初の800文字をログ出力
      console.log(`[Shinagawa Weekly] HTML sample: ${htmlText.substring(0, 800).replace(/\s+/g, ' ')}`);
    }
    
    // カレンダーのセルを全てパース
    // 実際のHTML構造: id="YYYYMMDD_時間帯コード" (例: id="20251213_20" で 11:00~)
    // 時間帯コード: 10=9:00, 20=11:00, 30=13:00, 40=15:00, 50=17:00, 60=19:00
    const cellPattern = /<td[^>]*\sid="(\d{8})_(\d{2})"[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    let foundCells = 0;
    let detectedCells = 0;
    
    // 時間帯コードから時間帯文字列への変換マップ
    const timeCodeToSlot: Record<string, string> = {
      '10': '09:00-11:00',
      '20': '11:00-13:00',
      '30': '13:00-15:00',
      '40': '15:00-17:00',
      '50': '17:00-19:00',
      '60': '19:00-21:00',
    };
    
    while ((match = cellPattern.exec(htmlText)) !== null) {
      const dateStr = match[1]; // "20251213"
      const timeCode = match[2]; // "20" (11:00~)
      const cellContent = match[3];
      
      foundCells++;
      
      // 時間帯コードを時間帯文字列に変換
      const timeSlot = timeCodeToSlot[timeCode];
      if (!timeSlot) {
        console.log(`[Shinagawa Weekly] Unknown time code: ${timeCode}`);
        continue;
      }
      
      // 施設の利用可能時間帯チェック（指定されている場合）
      if (facilityInfo?.availableTimeSlots) {
        const timeStart = timeSlot.split('-')[0]; // "09:00-11:00" → "09:00"
        if (!facilityInfo.availableTimeSlots.includes(timeStart)) {
          // この時間帯はこの施設では利用不可
          continue; // スキップ
        }
      }
      
      // 日付をYYYY-MM-DD形式に変換
      const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
      
      // ステータスを判定（○, ×, 取）
      let status = '×';
      
      // 画像のalt属性で判定（より確実）
      if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) {
        status = '○';
      } else if (cellContent.includes('alt="取消処理中"') || cellContent.includes('calendar_delete')) {
        status = '取';
      } else if (cellContent.includes('alt="予約あり"') || cellContent.includes('calendar_full')) {
        status = '×';
      } else if (cellContent.includes('alt="一部空き"') || cellContent.includes('calendar_few-available')) {
        status = '△';
      }
      // フォールバック: テキストでも判定
      else if (cellContent.includes('○')) {
        status = '○';
      } else if (cellContent.includes('取')) {
        status = '取';
      } else if (cellContent.includes('×')) {
        status = '×';
      }
      
      // キー: "YYYY-MM-DD_HH:MM-HH:MM"
      const key = `${formattedDate}_${timeSlot}`;
      availability.set(key, status);
      
      // 重要なステータスのみログ（ログサイズ削減）
      if (status === '○' || status === '取') {
        detectedCells++;
        console.log(`[Shinagawa Weekly] ⚡ ${status}: ${key}`);
      }
    }
    
    console.log(`[Shinagawa Weekly] Found ${foundCells} cells in calendar (${detectedCells} available or 取)`);
    
    // HTMLから予約に必要なフォーム情報を抽出
    const reservationContext: ReservationContext = {};
    
    // hidden fieldsを抽出（正規表現で取得）
    const extractField = (name: string): string | undefined => {
      const match = htmlText.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i'));
      return match ? match[1] : undefined;
    };
    
    reservationContext.selectBldCd = extractField('selectBldCd');
    reservationContext.selectBldName = extractField('selectBldName');
    reservationContext.selectInstCd = extractField('selectInstCd') || facilityId;
    reservationContext.selectInstName = extractField('selectInstName');
    reservationContext.selectPpsClsCd = extractField('selectPpsClsCd') || '31000000';
    reservationContext.selectPpsCd = extractField('selectPpsCd') || '31011700';
    reservationContext.displayNo = 'prwrc2000';
    
    // viewDay1〜viewDay7を抽出
    const viewDays: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const viewDay = extractField(`viewDay${i}`);
      if (viewDay) viewDays.push(viewDay);
    }
    reservationContext.viewDays = viewDays;
    
    // その他のフォームフィールドも抽出
    const additionalFields = [
      'date', 'daystart', 'days', 'dayofweekClearFlg', 'timezoneClearFlg',
      'selectAreaBcd', 'selectIcd', 'selectPpsClPpscd', 'displayNoFrm',
      'useDay', 'applyFlg'
    ];
    
    additionalFields.forEach(field => {
      const value = extractField(field);
      if (value) reservationContext[field] = value;
    });
    
    console.log(`[Shinagawa Weekly] Extracted context: selectBldCd=${reservationContext.selectBldCd}, selectInstCd=${reservationContext.selectInstCd}, viewDays=${viewDays.length}`);
    
    console.log(`[Shinagawa Weekly] 取得完了: ${facilityId} ${weekStartDate}〜 (${availability.size}セル)`);
    
    return {
      facilityId,
      facilityName: '品川区施設',
      weekStartDate,
      availability,
      fetchedAt: Date.now(),
      reservationContext,
    };
    
  } catch (error: any) {
    console.error('[Shinagawa Weekly] Error:', error.message);
    throw error;
  }
}

/**
 * 港区の1週間分の空き状況を一括取得
 * HTMLカレンダーから7日×7時間帯=最大49セルを一度に取得
 */
export async function checkMinatoWeeklyAvailability(
  facilityId: string,
  weekStartDate: string,  // YYYY-MM-DD形式の週開始日
  sessionId: string,
  facilityInfo?: Facility  // 施設情報（時間帯フィルタリング用）
): Promise<WeeklyAvailabilityResult> {
  const availability = new Map<string, string>();
  const baseUrl = 'https://web101.rsv.ws-scs.jp/web';
  
  try {
    // 空き状況カレンダーを取得（週単位表示）
    const searchParams = new URLSearchParams({
      'rsvWOpeInstSrchVacantForm.instCd': facilityId,
      'rsvWOpeInstSrchVacantForm.srchDate': weekStartDate,
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
    
    // カレンダーのセルを全てパース
    // セルID形式: id="YYYYMMDD_TimeCode" (例: id="20260114_10")
    const cellPattern = /<td[^>]*id="(\d{8})_(\d{2})"[^>]*>([\s\S]*?)<\/td>/gi;
    let match;
    
    while ((match = cellPattern.exec(htmlText)) !== null) {
      const dateStr = match[1]; // "20260114"
      const timeCode = parseInt(match[2], 10); // 10, 20, 30, 40, 50, 60, 70
      const cellContent = match[3];
      
      // 時間帯コードから時間帯文字列に変換
      const timeSlot = MINATO_TIMESLOT_MAP[timeCode];
      if (!timeSlot) continue; // 不明な時間帯コードはスキップ
      
      // 施設の利用可能時間帯チェック（指定されている場合）
      if (facilityInfo?.availableTimeSlots && !facilityInfo.availableTimeSlots.includes(timeSlot)) {
        // この時間帯はこの施設では利用不可
        continue; // スキップ
      }
      
      // 日付をYYYY-MM-DD形式に変換
      const formattedDate = `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
      
      // ステータスを判定（港区は「取」なし）
      let status = '×';
      if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) {
        status = '○';
      } else if (cellContent.includes('alt="予約あり"') || cellContent.includes('calendar_full')) {
        status = '×';
      } else if (cellContent.includes('alt="一部空き"') || cellContent.includes('calendar_few-available')) {
        status = '△';
      } else if (cellContent.includes('alt="受付期間外"') || cellContent.includes('calendar_term_out')) {
        status = '受付期間外';
      }
      
      // キー: "YYYY-MM-DD_HH:MM"
      const key = `${formattedDate}_${timeSlot}`;
      availability.set(key, status);
      
      // 空きのみログ（ログサイズ削減）
      if (status === '○') {
        console.log(`[Minato Weekly] ⚡ ${status}: ${key}`);
      }
    }
    
    console.log(`[Minato Weekly] 取得完了: ${facilityId} ${weekStartDate}〜 (${availability.size}セル)`);
    
    return {
      facilityId,
      facilityName: '港区施設',
      weekStartDate,
      availability,
      fetchedAt: Date.now(),
    };
    
  } catch (error: any) {
    console.error('[Minato Weekly] Error:', error.message);
    throw error;
  }
}

export async function checkShinagawaAvailability(
  facilityId: string,
  date: string,
  timeSlot: string,
  credentials: SiteCredentials,
  existingReservations?: ReservationHistory[],
  sessionId?: string | null  // 既存セッションIDを受け取る（省略時は自動ログイン）
): Promise<AvailabilityResult> {
  try {
    // ログサイズ削減のため詳細ログを無効化
    // console.log(`[Shinagawa] Checking availability: ${facilityId}, ${date}, ${timeSlot}`);
    
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
    
    // セッションIDがない場合のみ新規ログイン
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      console.log(`[Shinagawa] No session provided, attempting login`);
      activeSessionId = await loginToShinagawa(credentials.username, credentials.password);
      if (!activeSessionId) {
        throw new Error('Login failed');
      }
    } else {
      console.log(`[Shinagawa] Using provided session: ${activeSessionId.substring(0, 20)}...`);
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
        'Cookie': `JSESSIONID=${activeSessionId}`,
        'Referer': `${baseUrl}/rsvWOpeInstMenuAction.do`,
      },
    });
    
    const htmlText = await searchResponse.text();
    
    // デバッグ: HTML長とセルIDパターンをログ出力
    console.log(`[Shinagawa Individual] Response length: ${htmlText.length} bytes for ${facilityId} ${date} ${timeSlot}`);
    
    // ログイン失敗チェック
    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
      throw new Error('Login failed or session expired');
    }
    
    // デバッグ: 対象日付のセルIDパターンを全て抽出してログ出力
    const targetDateStr = date.replace(/-/g, '');
    const allCellsPattern = new RegExp(`<td[^>]*\\sid="${targetDateStr}_([^"]+)"[^>]*>`, 'gi');
    const foundCellIds: string[] = [];
    let cellMatch2;
    while ((cellMatch2 = allCellsPattern.exec(htmlText)) !== null) {
      foundCellIds.push(`${targetDateStr}_${cellMatch2[1]}`);
    }
    if (foundCellIds.length > 0) {
      console.log(`[Shinagawa Individual] Found cell IDs for ${date}: ${foundCellIds.slice(0, 10).join(', ')}${foundCellIds.length > 10 ? ` (+${foundCellIds.length - 10} more)` : ''}`);
    } else {
      console.log(`[Shinagawa Individual] ⚠️ No cells found with pattern "${targetDateStr}_*"`);
      // HTMLの最初の500文字をログ出力（構造確認用）
      console.log(`[Shinagawa Individual] HTML sample: ${htmlText.substring(0, 500).replace(/\s+/g, ' ')}`);
    }
    
    // 時間帯を時間帯コードに変換 (HH:MM-HH:MM → コード)
    // 例: "11:00-13:00" → "20"
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
      console.log(`[Shinagawa] ⚠️ Unknown time slot: ${timeSlot}`);
      return {
        available: false,
        facilityId,
        facilityName: '品川区施設',
        date,
        timeSlot,
        currentStatus: '×',
        changedToAvailable: false,
      };
    }
    
    // 該当セルを抽出 (例: id="20251213_20")
    const cellIdPattern = `${date.replace(/-/g, '')}_${timeCode}`;
    const cellMatch = htmlText.match(new RegExp(`<td[^>]*\\sid="${cellIdPattern}"[^>]*>([\\s\\S]*?)<\\/td>`));
    
    let currentStatus = '×';
    if (cellMatch) {
      const cellContent = cellMatch[1];
      
      // ステータスを判定（○, ×, 取）
      // 画像のalt属性で判定（最優先）
      if (cellContent.includes('alt="空き"') || cellContent.includes('calendar_available')) {
        currentStatus = '○';
      } else if (cellContent.includes('alt="取消処理中"') || cellContent.includes('calendar_delete')) {
        currentStatus = '取';
      } else if (cellContent.includes('alt="予約あり"') || cellContent.includes('calendar_full')) {
        currentStatus = '×';
      } else if (cellContent.includes('alt="一部空き"') || cellContent.includes('calendar_few-available')) {
        currentStatus = '△';
      }
      // フォールバック: テキストでも判定
      else if (cellContent.includes('取')) {
        currentStatus = '取';
      } else if (cellContent.includes('○')) {
        currentStatus = '○';
      } else if (cellContent.includes('×')) {
        currentStatus = '×';
      }
    } else {
      console.log(`[Shinagawa] ⚠️ Cell not found: ${cellIdPattern}`);
    }
    
    const isAvailable = currentStatus === '○' || currentStatus === '取';
    
    // 重要なステータス（取/○）のみログ出力（ログサイズ削減）
    if (currentStatus === '取' || currentStatus === '○') {
      console.log(`[Shinagawa] ⚡ ${currentStatus} 検知: ${facilityId}, ${date}, ${timeSlot}`);
    }
    
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
  existingReservations?: ReservationHistory[],
  sessionId?: string | null  // 既存セッションIDを受け取る（省略時は自動ログイン）
): Promise<AvailabilityResult> {
  try {
    // ログサイズ削減のため詳細ログを無効化
    // console.log(`[Minato] Checking availability: ${facilityId}, ${date}, ${timeSlot}`);
    
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
    
    // セッションIDがない場合のみ新規ログイン
    let activeSessionId = sessionId;
    if (!activeSessionId) {
      console.log(`[Minato] No session provided, attempting login`);
      activeSessionId = await loginToMinato(credentials.username, credentials.password);
      if (!activeSessionId) {
        throw new Error('Login failed');
      }
    } else {
      console.log(`[Minato] Using provided session: ${activeSessionId.substring(0, 20)}...`);
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
    
    // ログイン失敗チェック
    if (htmlText.includes('ログイン') || htmlText.includes('セッションが切れました') || htmlText.includes('再ログイン')) {
      throw new Error('Login failed or session expired');
    }
    
    // 港区は「○×」のみ（「取」なし）
    const statusMatch = htmlText.match(new RegExp(`${timeSlot}[^<]*([○×])`));
    const currentStatus = statusMatch ? statusMatch[1] : '×';
    const isAvailable = currentStatus === '○';
    
    // 空きのみログ出力（ログサイズ削減）
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

export async function makeShinagawaReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,
  target: { applicantCount?: number },
  weeklyContext?: ReservationContext  // 週間カレンダー経由の予約用コンテキスト
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`[Shinagawa] Making reservation: ${facilityId}, ${date}, ${timeSlot} [weeklyContext: ${weeklyContext ? 'あり' : 'なし'}]`);
    
    // セッションIDを使用（自動ログイン不要）
    
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    let instNo = '';
    let dateNo = '';
    let timeNo = '';
    
    // 週間コンテキストがある場合は週間カレンダー経由の予約フロー
    if (weeklyContext && weeklyContext.selectInstCd && weeklyContext.viewDays && weeklyContext.viewDays.length > 0) {
      console.log(`[Shinagawa] Using weekly calendar context`);
      
      // 週間カレンダーのコンテキストを使って予約申込画面に遷移
      const formattedDate = date.replace(/-/g, ''); // YYYYMMDD
      
      // 週間カレンダーから予約申込に遷移するPOSTリクエスト
      const applyFormData = new URLSearchParams();
      
      // コンテキストから取得したパラメータを使用
      if (weeklyContext.selectBldCd) applyFormData.append('selectBldCd', weeklyContext.selectBldCd);
      if (weeklyContext.selectBldName) applyFormData.append('selectBldName', weeklyContext.selectBldName);
      if (weeklyContext.selectInstCd) applyFormData.append('selectInstCd', weeklyContext.selectInstCd);
      if (weeklyContext.selectInstName) applyFormData.append('selectInstName', weeklyContext.selectInstName);
      applyFormData.append('useDay', formattedDate);
      
      // viewDay1〜viewDay7を設定
      weeklyContext.viewDays.forEach((day, index) => {
        applyFormData.append(`viewDay${index + 1}`, day);
      });
      
      // その他の必須パラメータ
      applyFormData.append('applyFlg', '1');  // 予約申込フラグ
      applyFormData.append('selectPpsClsCd', weeklyContext.selectPpsClsCd || '31000000');
      applyFormData.append('selectPpsCd', weeklyContext.selectPpsCd || '31011700');
      applyFormData.append('displayNo', 'prwrc2000');
      applyFormData.append('displayNoFrm', 'prwrc2000');
      
      // カレンダーから取得した他のパラメータも追加
      const additionalParams = ['date', 'daystart', 'days', 'dayofweekClearFlg', 'timezoneClearFlg', 'selectAreaBcd', 'selectIcd', 'selectPpsClPpscd'];
      additionalParams.forEach(param => {
        if (weeklyContext[param]) applyFormData.append(param, weeklyContext[param]);
      });
      
      console.log(`[Shinagawa] POST to apply page (weekly context)...`);
      const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': `JSESSIONID=${sessionId}`,
          'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15',
        },
        body: applyFormData.toString(),
      });
      
      const applyHtml = await applyResponse.text();
      
      // instNo, dateNo, timeNoを抽出（利用規約画面から）
      const linkMatch = applyHtml.match(/instNo=([^&"]*)&dateNo=([^&"]*)&timeNo=([^"]*)/);
      if (!linkMatch) {
        console.log('[Shinagawa] Failed to extract reservation params from weekly context');
        return { success: false, message: '予約パラメータの取得に失敗しました' };
      }
      [, instNo, dateNo, timeNo] = linkMatch;
      
    } else {
      // 従来の個別日付チェック方式（フォールバック）
      console.log(`[Shinagawa] Using individual date check (fallback)`);
      
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
      
      [, instNo, dateNo, timeNo] = linkMatch;
    }
    
    const applyParams = new URLSearchParams({ instNo, dateNo, timeNo });
    
    // Step 1: 予約画面（利用規約画面）を取得
    const applyResponse = await fetch(`${baseUrl}/rsvWOpeReservedApplyAction.do?${applyParams}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeInstSrchVacantAction.do`,
      },
    });
    await applyResponse.text();
    
    // Step 2: 利用規約に同意
    const ruleParams = new URLSearchParams({
      'ruleFg': '1', // 1: 同意する, 2: 同意しない
    });
    
    const ruleResponse = await fetch(`${baseUrl}/rsvWInstUseruleRsvApplyAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWOpeReservedApplyAction.do?${applyParams}`,
      },
      body: ruleParams.toString(),
    });
    await ruleResponse.text();
    
    // Step 3: 予約内容確認画面へ（利用人数・催し物名を送信）
    const applicantCount = target.applicantCount?.toString() || '2';
    
    const confirmParams = new URLSearchParams({
      'rsvWOpeReservedConfirmForm.instNo': instNo,
      'rsvWOpeReservedConfirmForm.dateNo': dateNo,
      'rsvWOpeReservedConfirmForm.timeNo': timeNo,
      'rsvWOpeReservedConfirmForm.usrNum': applicantCount,
      'rsvWOpeReservedConfirmForm.eventName': '', // 催し物名（任意）
    });
    
    const confirmResponse = await fetch(`${baseUrl}/rsvWOpeReservedConfirmAction.do`, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': `JSESSIONID=${sessionId}`,
        'Referer': `${baseUrl}/rsvWInstUseruleRsvApplyAction.do`,
      },
      body: confirmParams.toString(),
    });
    await confirmResponse.text();
    
    // Step 4: 予約確定
    const reserveParams = new URLSearchParams({
      'rsvWOpeReservedConfirmForm.instNo': instNo,
      'rsvWOpeReservedConfirmForm.dateNo': dateNo,
      'rsvWOpeReservedConfirmForm.timeNo': timeNo,
      'rsvWOpeReservedConfirmForm.usrNum': applicantCount,
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
    
    // 🔍 デバッグ: レスポンスHTMLの詳細をログ出力
    console.log('[Shinagawa] 🔍 DEBUG: Reservation response status:', reserveResponse.status);
    console.log('[Shinagawa] 🔍 DEBUG: Response HTML length:', reserveHtml.length);
    console.log('[Shinagawa] 🔍 DEBUG: Response HTML (first 3000 chars):', reserveHtml.substring(0, 3000));
    
    // キーワード検索
    const keywords = ['予約', '完了', '受付', '成功', '失敗', 'エラー', '満室', '空き', '予約済'];
    console.log('[Shinagawa] 🔍 DEBUG: Keyword search results:');
    keywords.forEach(keyword => {
      const index = reserveHtml.indexOf(keyword);
      if (index !== -1) {
        // キーワードの前後50文字を表示
        const start = Math.max(0, index - 50);
        const end = Math.min(reserveHtml.length, index + keyword.length + 50);
        const context = reserveHtml.substring(start, end).replace(/\s+/g, ' ');
        console.log(`  - "${keyword}" found at ${index}: ...${context}...`);
      }
    });
    
    // 成功判定: 「予約完了」画面のタイトルまたはメッセージで判定
    const hasCompletedTitle = reserveHtml.includes('予約完了');
    const hasCompletedMessage = reserveHtml.includes('以下の内容で予約しました');
    const hasReservationNumber = reserveHtml.includes('予約番号');
    
    console.log('[Shinagawa] 🔍 DEBUG: Success check - 予約完了:', hasCompletedTitle);
    console.log('[Shinagawa] 🔍 DEBUG: Success check - 以下の内容で予約しました:', hasCompletedMessage);
    console.log('[Shinagawa] 🔍 DEBUG: Success check - 予約番号:', hasReservationNumber);
    
    if (hasCompletedTitle || hasCompletedMessage || hasReservationNumber) {
      console.log('[Shinagawa] ✅ Reservation successful');
      
      // 予約番号を抽出
      const reservationNumberMatch = reserveHtml.match(/予約番号[：:\s]*(\d+)/);
      const reservationNumber = reservationNumberMatch ? reservationNumberMatch[1] : '';
      
      return { 
        success: true, 
        message: reservationNumber ? `予約に成功しました（予約番号: ${reservationNumber}）` : '予約に成功しました'
      };
    } else {
      console.error('[Shinagawa] ❌ Reservation failed - success keywords not found');
      console.error('[Shinagawa] 💡 HINT: Check the DEBUG logs above to find the actual success message');
      return { success: false, message: '予約に失敗しました（成功メッセージが見つかりませんでした）' };
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
  kv: KVNamespace,
  userId?: string
): Promise<Facility[]> {
  try {
    // KVキャッシュをチェック（6時間有効、ユーザー別）
    const cacheKey = userId ? `shinagawa:facilities:${userId}` : 'shinagawa:facilities:cache';
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
    
    // KVにキャッシュ（6時間、ユーザー権限変更に対応）
    await kv.put(cacheKey, JSON.stringify(facilities), {
      expirationTtl: 21600, // 6時間
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
  
  // Step 1: ホーム画面にアクセスしてセッションを確立
  const homeUrl = `${baseUrl}/rsvWOpeHomeAction.do`;
  const homeRes = await fetch(homeUrl, {
    method: 'GET',
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    },
  });
  
  if (!homeRes.ok) {
    throw new Error(`Home page access failed: ${homeRes.status}`);
  }
  
  // Step 2: 空き施設検索画面の初期表示にアクセス（GET）
  const searchInitUrl = `${baseUrl}/rsvWOpeInstSrchVacantAction.do`;
  const searchInitRes = await fetch(searchInitUrl, {
    method: 'GET',
    headers: {
      'Cookie': `JSESSIONID=${sessionId}`,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Referer': homeUrl,
    },
  });
  
  if (!searchInitRes.ok) {
    throw new Error(`Search init page access failed: ${searchInitRes.status}`);
  }
  
  const initHtml = await searchInitRes.text();
  console.log(`[Facilities] Search init page loaded, HTML length: ${initHtml.length}`);
  
  // Step 3: 検索条件を指定してPOSTリクエスト
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '/');
  
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
  
  const response = await fetch(searchInitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Cookie': `JSESSIONID=${sessionId}`,
      'Referer': searchInitUrl,
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      'Origin': 'https://www.cm9.eprs.jp',
    },
    body: formData.toString(),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch area facilities: ${response.status}`);
  }
  
  // Shift_JISエンコーディングで取得したHTMLをUTF-8に変換
  const buffer = await response.arrayBuffer();
  const decoder = new TextDecoder('shift-jis');
  const html = decoder.decode(buffer);
  
  console.log(`[Facilities] ${areaName} HTML loaded, length: ${html.length}`);
  console.log(`[Facilities] HTML contains "庭球": ${html.includes('庭球')}`);
  console.log(`[Facilities] HTML contains "select": ${html.includes('select')}`);
  
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
  
  // デバッグ: select要素を全て検索して詳細表示
  const allSelects = html.match(/<select[^>]*>[\s\S]*?<\/select>/gi);
  if (allSelects) {
    console.log(`[Parser] Found ${allSelects.length} select elements in HTML`);
    allSelects.forEach((select, index) => {
      const idMatch = select.match(/id="([^"]+)"/);
      const nameMatch = select.match(/name="([^"]+)"/);
      const classMatch = select.match(/class="([^"]+)"/);
      const optionCount = (select.match(/<option/gi) || []).length;
      console.log(`[Parser] Select ${index}: id="${idMatch?.[1] || 'none'}", name="${nameMatch?.[1] || 'none'}", class="${classMatch?.[1] || 'none'}", options=${optionCount}`);
      
      // 最初の3つのoptionを表示
      const options = select.match(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/gi);
      if (options && options.length > 0) {
        const firstThree = options.slice(0, 3).map(opt => {
          const val = opt.match(/value="([^"]*)"/)?.[1];
          const text = opt.match(/>([^<]*)</)?.[1];
          return `value="${val}" text="${text}"`;
        });
        console.log(`[Parser]   First options:`, firstThree.join(' | '));
      }
    });
  }
  
  // 複数のパターンで館セレクトボックスを検索
  let mansionSelectMatch = html.match(
    /<select[^>]*id="mansion-select"[^>]*>([\s\S]*?)<\/select>/i
  );
  
  // idで見つからない場合、nameで検索
  if (!mansionSelectMatch) {
    mansionSelectMatch = html.match(
      /<select[^>]*name="selectAreaBcd"[^>]*>([\s\S]*?)<\/select>/i
    );
    if (mansionSelectMatch) {
      console.log('[Parser] Found mansion select by name="selectAreaBcd"');
    }
  }
  
  // さらに見つからない場合、class等で検索
  if (!mansionSelectMatch) {
    mansionSelectMatch = html.match(
      /<select[^>]*name="selectIcd"[^>]*>([\s\S]*?)<\/select>/i
    );
    if (mansionSelectMatch) {
      console.log('[Parser] Found mansion select by name="selectIcd"');
    }
  }
  
  if (!mansionSelectMatch) {
    console.warn('[Parser] Could not find mansion-select with any pattern');
    console.log('[Parser] HTML length:', html.length);
    console.log('[Parser] HTML contains "select":', html.includes('select'));
    console.log('[Parser] HTML contains "庭球":', html.includes('庭球'));
    console.log('[Parser] HTML snippet (first 1000 chars):', html.substring(0, 1000));
    console.log('[Parser] HTML snippet (around 庭球):', html.substring(html.indexOf('庭球') - 200, html.indexOf('庭球') + 300));
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
  
  // 施設セレクトボックスをパース（複数パターン対応）
  let facilitySelectMatch = html.match(
    /<select[^>]*id="facility-select"[^>]*>([\s\S]*?)<\/select>/i
  );
  
  // idで見つからない場合、他のパターンを試す
  if (!facilitySelectMatch) {
    // テニスコート選択用のselectを検索
    const possiblePatterns = [
      /<select[^>]*name="selectPpsClPpscd"[^>]*>([\s\S]*?)<\/select>/i,
      /<select[^>]*class="[^"]*facility[^"]*"[^>]*>([\s\S]*?)<\/select>/i,
    ];
    
    for (const pattern of possiblePatterns) {
      facilitySelectMatch = html.match(pattern);
      if (facilitySelectMatch) {
        console.log('[Parser] Found facility select with alternative pattern');
        break;
      }
    }
  }
  
  if (!facilitySelectMatch) {
    console.warn('[Parser] Could not find facility-select with any pattern');
    console.log('[Parser] Buildings found:', buildings.length);
    
    // 館が見つかっている場合は、各館に対してデフォルトコートを生成
    if (buildings.length > 0) {
      console.log('[Parser] Generating default courts for found buildings');
      buildings.forEach(building => {
        // 仮のコートIDを生成（実際の構造に応じて調整が必要）
        ['Ａ', 'Ｂ', 'Ｃ', 'Ｄ'].forEach((court, index) => {
          const courtId = `${building.id}00${(index + 1) * 10}`;
          facilities.push({
            facilityId: courtId,
            facilityName: `${building.name} 庭球場${court}`,
            category: 'tennis',
            isTennisCourt: true,
            buildingId: building.id,
            buildingName: building.name,
            areaCode: areaCode,
            areaName: areaName,
          });
        });
      });
    }
    
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
 * フォールバック用のハードコードされた施設一覧（品川区全24施設）
 */
function getShinagawaFacilitiesFallback(): Facility[] {
  console.log('[Facilities] Using fallback Shinagawa facilities');
  
  // 品川区の全施設で利用可能な時間帯（09:00〜19:00の2時間枠）
  const shinagawaTimeSlots = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00'];
  
  const facilities: Facility[] = [
    // 大井地区: しながわ区民公園（コートA〜D）
    { facilityId: '10400010', facilityName: 'しながわ区民公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10400020', facilityName: 'しながわ区民公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10400030', facilityName: 'しながわ区民公園 庭球場Ｃ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10400040', facilityName: 'しながわ区民公園 庭球場Ｄ', category: 'tennis', isTennisCourt: true, buildingId: '1040', buildingName: 'しながわ区民公園', areaCode: '1200', areaName: '大井地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    
    // 品川地区: しながわ中央公園（コートA、B）
    { facilityId: '10100010', facilityName: 'しながわ中央公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1010', buildingName: 'しながわ中央公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10100020', facilityName: 'しながわ中央公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1010', buildingName: 'しながわ中央公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    
    // 品川地区: 東品川公園（コートA、B）
    { facilityId: '10200010', facilityName: '東品川公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1020', buildingName: '東品川公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10200020', facilityName: '東品川公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1020', buildingName: '東品川公園', areaCode: '1400', areaName: '品川地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    
    // 八潮地区: 八潮北公園（コートA〜E）
    { facilityId: '10300010', facilityName: '八潮北公園 庭球場Ａ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10300020', facilityName: '八潮北公園 庭球場Ｂ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10300030', facilityName: '八潮北公園 庭球場Ｃ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10300040', facilityName: '八潮北公園 庭球場Ｄ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
    { facilityId: '10300050', facilityName: '八潮北公園 庭球場Ｅ', category: 'tennis', isTennisCourt: true, buildingId: '1030', buildingName: '八潮北公園', areaCode: '1500', areaName: '八潮地区', site: 'shinagawa', availableTimeSlots: shinagawaTimeSlots },
  ];
  
  return facilities;
}/**
 * 品川区のテニスコートのみを取得
 */
export async function getShinagawaTennisCourts(
  credentials: SiteCredentials,
  kv: KVNamespace,
  userId?: string
): Promise<Facility[]> {
  const allFacilities = await getShinagawaFacilities(credentials, kv, userId);
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
  kv: KVNamespace,
  userId?: string
): Promise<Facility[]> {
  try {
    // KVキャッシュチェック（ユーザー別）
    const cacheKey = userId ? `minato:facilities:${userId}` : 'facilities:minato';
    const cached = await kv.get(cacheKey);
    if (cached) {
      console.log('[Facilities] Using cached Minato facilities for user:', userId);
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
    
    // デバッグ: 施設リンクのパターンを検索
    console.log('[Minato Parser] Searching for facility links...');
    
    // 複数のパターンで施設リンクを検索
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
        const facilityName = match[2].trim();
        
        // HTMLエンティティをデコード
        const decodedName = facilityName
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        
        const isTennisCourt = decodedName.includes('テニス');
        
        // テニスコートのみを追加
        if (isTennisCourt) {
          tempFacilities.push({
            facilityId,
            facilityName: decodedName,
            category: 'tennis',
            isTennisCourt: true,
          });
        }
      }
      
      if (tempFacilities.length > 0) {
        console.log(`[Minato Parser] Found ${tempFacilities.length} facilities with pattern`);
        facilities.push(...tempFacilities);
        break; // 最初に見つかったパターンを使用
      }
    }
    
    if (!foundAny) {
      console.warn('[Minato Parser] No facility links found with any pattern');
      console.log('[Minato Parser] HTML snippet:', html.substring(0, 500));
    }
    
    console.log(`[Facilities] Found ${facilities.length} Minato facilities (${facilities.filter(f => f.isTennisCourt).length} tennis courts)`);
    
    // 動的取得が成功した場合のみキャッシュ（6時間、ユーザー別）
    if (facilities.length > 0) {
      const cacheKey = userId ? `minato:facilities:${userId}` : 'facilities:minato';
      await kv.put(cacheKey, JSON.stringify(facilities), {
        expirationTtl: 21600, // 6時間
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
 * 港区施設のフォールバックデータ（全テニスコート）
 */
function getMinatoFacilitiesFallback(): Facility[] {
  // 港区の全施設で利用可能な時間帯（08:00〜19:00の7時間帯）
  const minatoTimeSlots = ['08:00', '10:00', '12:00', '13:00', '15:00', '17:00', '19:00'];
  
  return [
    // 麻布地区: 麻布運動公園（コートA〜D）
    { facilityId: '1001', facilityName: '麻布運動公園 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '1002', facilityName: '麻布運動公園 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '1003', facilityName: '麻布運動公園 テニスコートＣ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '1004', facilityName: '麻布運動公園 テニスコートＤ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    
    // 赤坂地区: 青山運動場（コートA、B）
    { facilityId: '2001', facilityName: '青山運動場 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '2002', facilityName: '青山運動場 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    
    // 芝浦港南地区: 芝浦中央公園運動場（コートA〜D）
    { facilityId: '5001', facilityName: '芝浦中央公園運動場 テニスコートＡ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '5002', facilityName: '芝浦中央公園運動場 テニスコートＢ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '5003', facilityName: '芝浦中央公園運動場 テニスコートＣ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
    { facilityId: '5004', facilityName: '芝浦中央公園運動場 テニスコートＤ', category: 'tennis', isTennisCourt: true, site: 'minato', availableTimeSlots: minatoTimeSlots },
  ];
}

/**
 * 港区で予約実行（4段階フロー: 検索→申込→確認→完了）
 */
export async function makeMinatoReservation(
  facilityId: string,
  date: string,
  timeSlot: string,
  sessionId: string,
  target: { applicantCount?: number }
): Promise<{ success: boolean; reservationId?: string; error?: string }> {
  try {
    // セッションIDを使用（自動ログイン不要）

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
      'purpose': '2000_2000040',  // テニス（屋外スポーツ）
      'applyNum': (target.applicantCount || 4).toString(),  // 利用人数（未設定時は港区デフォルトの4人）
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

    // 🔍 デバッグ: レスポンスHTMLの詳細をログ出力
    console.log('[Minato] 🔍 DEBUG: Reservation response status:', completeResponse.status);
    console.log('[Minato] 🔍 DEBUG: Response HTML length:', completeHtml.length);
    console.log('[Minato] 🔍 DEBUG: Response HTML (first 3000 chars):', completeHtml.substring(0, 3000));
    
    // キーワード検索
    const keywords = ['予約', '完了', '受付', '番号', '成功', '失敗', 'エラー', '満室', '空き', '予約済'];
    console.log('[Minato] 🔍 DEBUG: Keyword search results:');
    keywords.forEach(keyword => {
      const index = completeHtml.indexOf(keyword);
      if (index !== -1) {
        // キーワードの前後50文字を表示
        const start = Math.max(0, index - 50);
        const end = Math.min(completeHtml.length, index + keyword.length + 50);
        const context = completeHtml.substring(start, end).replace(/\s+/g, ' ');
        console.log(`  - "${keyword}" found at ${index}: ...${context}...`);
      }
    });
    
    // 受付番号の検索パターンをテスト
    const idPatterns = [
      { name: '予約受付番号', regex: /予約受付番号[：:]\s*([0-9]+)/ },
      { name: '受付番号', regex: /受付番号[：:]\s*([0-9]+)/ },
      { name: '予約番号', regex: /予約番号[：:]\s*([0-9]+)/ },
      { name: '番号（任意）', regex: /番号[：:]\s*([A-Z0-9-]+)/ },
    ];
    console.log('[Minato] 🔍 DEBUG: Reservation ID pattern search:');
    idPatterns.forEach(pattern => {
      const match = completeHtml.match(pattern.regex);
      if (match) {
        console.log(`  - ${pattern.name}: MATCHED - "${match[0]}" (ID: ${match[1]})`);
      } else {
        console.log(`  - ${pattern.name}: NOT MATCHED`);
      }
    });
    
    // 現在の成功判定
    const hasCompletedMessage = completeHtml.includes('予約が完了しました');
    const hasReservationId = completeHtml.includes('予約受付番号');
    console.log('[Minato] 🔍 DEBUG: Success check - 予約が完了しました:', hasCompletedMessage);
    console.log('[Minato] 🔍 DEBUG: Success check - 予約受付番号:', hasReservationId);

    if (hasCompletedMessage || hasReservationId) {
      const reservationIdMatch = completeHtml.match(/予約受付番号[：:]\s*([0-9]+)/);
      const reservationId = reservationIdMatch ? reservationIdMatch[1] : `MINATO_${Date.now()}`;

      console.log(`[Minato] ✅ Reservation successful: ${reservationId}`);
      return { success: true, reservationId };
    } else {
      console.error('[Minato] ❌ Reservation failed - success keywords not found');
      console.error('[Minato] 💡 HINT: Check the DEBUG logs above to find the actual success message');
      return { success: false, error: 'Reservation failed at completion step (success keywords not found)' };
    }

  } catch (error: any) {
    console.error('[Minato] Reservation error:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
}
