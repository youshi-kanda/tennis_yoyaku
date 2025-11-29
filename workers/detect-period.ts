/**
 * 品川区の予約可能期間を動的に検出するスクリプト
 * 
 * 使用方法:
 * SHINAGAWA_USER=xxx SHINAGAWA_PASS=xxx npx tsx detect-period.ts
 */

interface DateInfo {
  date: string;
  isSelectable: boolean;
  status: string;
}

async function decryptPassword(encryptedPassword: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const keyData = enc.encode(key.padEnd(32, '0').slice(0, 32));
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  
  const encryptedBuffer = Uint8Array.from(atob(encryptedPassword), c => c.charCodeAt(0));
  const iv = encryptedBuffer.slice(0, 12);
  const ciphertext = encryptedBuffer.slice(12);
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    ciphertext
  );
  
  return new TextDecoder().decode(decrypted);
}

async function loginToShinagawa(userId: string, password: string): Promise<string | null> {
  try {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    
    console.log('[Login] 初期セッション確立中...');
    const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      },
      redirect: 'manual',
    });
    
    await initResponse.text().catch(() => {});
    
    const setCookieHeader = initResponse.headers.get('set-cookie');
    if (!setCookieHeader) {
      console.error('[Login] セッションCookieが取得できませんでした');
      return null;
    }
    
    const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (!sessionIdMatch) {
      console.error('[Login] JSESSIONIDのパースに失敗しました');
      return null;
    }
    
    const sessionId = sessionIdMatch[1];
    console.log('[Login] セッション確立:', sessionId.substring(0, 20) + '...');
    
    console.log('[Login] ログイン実行中...');
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
    
    const loginBody = await loginResponse.text();
    
    if (loginBody.includes('ログイン処理が失敗') || loginBody.includes('エラー')) {
      console.error('[Login] ログイン失敗');
      return null;
    }
    
    console.log('[Login] ✅ ログイン成功');
    return sessionId;
  } catch (error) {
    console.error('[Login] エラー:', error);
    return null;
  }
}

async function fetchCalendarPage(sessionId: string, targetDate: string): Promise<string | null> {
  try {
    const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
    
    // 八潮北公園(館ID: 10100) 庭球場A(施設ID: 10100010)
    const url = `${baseUrl}/rsvWOpeInstSrchVacantAction.do?rsvWOpeInstSrchVacantForm.instCd=10100010&rsvWOpeInstSrchVacantForm.srchDate=${targetDate}`;
    
    console.log(`[Fetch] カレンダーページ取得: ${targetDate}`);
    const response = await fetch(url, {
      headers: {
        'Cookie': `JSESSIONID=${sessionId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${baseUrl}/rsvWOpeHomeAction.do`,
      },
    });
    
    if (response.status !== 200) {
      console.error(`[Fetch] HTTPエラー: ${response.status}`);
      return null;
    }
    
    const html = await response.text();
    
    // デバッグ: HTMLを保存
    if (html.includes('エラー') || html.includes('pawfa1000')) {
      console.log('[Fetch] ⚠️ エラーページが返されました');
      console.log('[Fetch] HTMLサイズ:', html.length, 'bytes');
    } else {
      console.log('[Fetch] ✅ 正常なHTMLを取得 サイズ:', html.length, 'bytes');
    }
    
    return html;
  } catch (error) {
    console.error('[Fetch] エラー:', error);
    return null;
  }
}

function analyzeCalendarHTML(html: string, targetMonth: string): DateInfo[] {
  const results: DateInfo[] = [];
  
  // カレンダーテーブルからセルを抽出
  // <td>の中に日付数字と状態(○, △, ×, ー)が含まれる
  const cellPattern = /<td[^>]*>[\s\S]*?<\/td>/g;
  const cells = html.match(cellPattern) || [];
  
  for (const cell of cells) {
    // 日付を抽出
    const dateMatch = cell.match(/>\s*(\d{1,2})\s*</);
    if (!dateMatch) continue;
    
    const day = parseInt(dateMatch[1]);
    const date = `${targetMonth}-${String(day).padStart(2, '0')}`;
    
    // 状態を判定
    let status = 'unknown';
    let isSelectable = false;
    
    if (cell.includes('○') || cell.includes('空き')) {
      status = '○';
      isSelectable = true;
    } else if (cell.includes('△') || cell.includes('残りわずか')) {
      status = '△';
      isSelectable = true;
    } else if (cell.includes('×') || cell.includes('満')) {
      status = '×';
      isSelectable = true;
    } else if (cell.includes('ー') || cell.includes('受付期間外')) {
      status = 'ー';
      isSelectable = false;
    } else if (cell.includes('休') || cell.includes('休館')) {
      status = '休';
      isSelectable = false;
    }
    
    results.push({ date, isSelectable, status });
  }
  
  return results;
}

async function detectReservationPeriod(userId: string, password: string): Promise<void> {
  console.log('='.repeat(60));
  console.log('品川区 予約可能期間 動的検出');
  console.log('='.repeat(60));
  console.log('');
  
  // 1. ログイン
  const sessionId = await loginToShinagawa(userId, password);
  if (!sessionId) {
    console.error('❌ ログインに失敗しました');
    return;
  }
  
  console.log('');
  console.log('[検出] 今日から3ヶ月分のカレンダーを確認します...');
  console.log('');
  
  const today = new Date();
  const monthsToCheck = [0, 1, 2]; // 今月、来月、再来月
  
  let lastSelectableDate: string | null = null;
  let firstUnselectableDate: string | null = null;
  
  for (const monthOffset of monthsToCheck) {
    const targetDate = new Date(today);
    targetDate.setMonth(targetDate.getMonth() + monthOffset);
    targetDate.setDate(1);
    
    const yearMonth = targetDate.toISOString().split('T')[0].substring(0, 7); // YYYY-MM
    const dateStr = `${yearMonth}-01`;
    
    console.log(`[検出] ${yearMonth} を確認中...`);
    
    const html = await fetchCalendarPage(sessionId, dateStr);
    if (!html) {
      console.log(`  ⚠️ HTMLの取得に失敗`);
      continue;
    }
    
    const dateInfos = analyzeCalendarHTML(html, yearMonth);
    
    if (dateInfos.length === 0) {
      console.log(`  ⚠️ カレンダーデータが見つかりません`);
      continue;
    }
    
    // 選択可能な日付と不可能な日付を集計
    const selectable = dateInfos.filter(d => d.isSelectable);
    const unselectable = dateInfos.filter(d => !d.isSelectable && d.status === 'ー');
    
    console.log(`  選択可能: ${selectable.length}日, 受付期間外: ${unselectable.length}日`);
    
    if (selectable.length > 0) {
      const lastDate = selectable[selectable.length - 1].date;
      lastSelectableDate = lastDate;
      console.log(`  📅 最終選択可能日: ${lastDate}`);
    }
    
    if (unselectable.length > 0 && !firstUnselectableDate) {
      firstUnselectableDate = unselectable[0].date;
      console.log(`  🚫 最初の受付期間外: ${firstUnselectableDate}`);
    }
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('📊 検出結果');
  console.log('='.repeat(60));
  
  if (lastSelectableDate && firstUnselectableDate) {
    const last = new Date(lastSelectableDate);
    const first = new Date(firstUnselectableDate);
    const diffDays = Math.ceil((first.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    
    console.log(`最終予約可能日: ${lastSelectableDate}`);
    console.log(`受付期間外開始: ${firstUnselectableDate}`);
    console.log(`\n✅ 予約可能期間: 約 ${diffDays} 日`);
  } else {
    console.log('⚠️ 予約可能期間を正確に検出できませんでした');
  }
  
  console.log('='.repeat(60));
}

// メイン実行
async function main() {
  const userId = process.env.SHINAGAWA_USER || '84005349';
  let password = process.env.SHINAGAWA_PASS;
  
  // 暗号化されたパスワードがある場合は復号化を優先
  if (process.env.SHINAGAWA_PASS_ENCRYPTED && process.env.ENCRYPTION_KEY) {
    console.log('[Setup] 暗号化されたパスワードを復号化中...');
    try {
      password = await decryptPassword(process.env.SHINAGAWA_PASS_ENCRYPTED, process.env.ENCRYPTION_KEY);
      console.log('[Setup] ✅ 復号化完了');
    } catch (error) {
      console.error('[Setup] ❌ パスワードの復号化に失敗:', error);
      process.exit(1);
    }
  }
  
  if (!password) {
    console.error('❌ パスワードが設定されていません');
    console.log('');
    console.log('使用方法:');
    console.log('  SHINAGAWA_USER=xxx SHINAGAWA_PASS=xxx npx tsx detect-period.ts');
    console.log('');
    console.log('または暗号化されたパスワードの場合:');
    console.log('  SHINAGAWA_USER=xxx SHINAGAWA_PASS_ENCRYPTED=xxx ENCRYPTION_KEY=xxx npx tsx detect-period.ts');
    process.exit(1);
  }
  
  await detectReservationPeriod(userId, password);
}

main().catch(console.error);
