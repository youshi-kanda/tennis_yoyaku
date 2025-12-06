/**
 * loginToShinagawa関数の直接テスト
 * トップページアクセス → ログイン画面アクセス → loginJKey抽出を確認
 */
import * as process from 'process';

async function testLoginFlow() {
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';

  console.log('=== 品川区ログインフロー テスト ===\n');

  // Step 0: トップページアクセス
  console.log('Step 0: トップページアクセス...');
  const topResponse = await fetch(`${baseUrl}/`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
    },
    redirect: 'manual',
  });

  console.log(`  Status: ${topResponse.status}`);
  console.log(`  Headers:`, Object.fromEntries(topResponse.headers.entries()));

  const topCookieHeader = topResponse.headers.get('set-cookie');
  let sessionId = '';

  if (topCookieHeader) {
    const topSessionMatch = topCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (topSessionMatch) {
      sessionId = topSessionMatch[1];
      console.log(`  ✅ Session ID: ${sessionId.substring(0, 30)}...`);
    } else {
      console.log(`  ❌ JSESSIONID not found in: ${topCookieHeader}`);
    }
  } else {
    console.log(`  ❌ No Set-Cookie header`);
  }

  const topHtml = await topResponse.text();
  console.log(`  Body length: ${topHtml.length} chars`);
  console.log(`  Body preview: ${topHtml.substring(0, 200)}`);

  // ログインリンクを探す
  console.log(`\n  🔍 Searching for login link...`);
  const loginLinkMatch = topHtml.match(/href=["']?([^"'\s>]*rsvWTransUserLoginAction[^"'\s>]*)["']?/i);
  if (loginLinkMatch) {
    console.log(`  ✅ Found login link: ${loginLinkMatch[1]}`);
  } else {
    console.log(`  ❌ Login link not found`);
  }

  // Step 1: ログイン画面アクセス
  console.log('Step 1: ログイン画面アクセス（POST）...');

  // トップページからhidden fieldsを抽出（最低限のパラメータ）
  // トップページからhidden fieldsを抽出（最低限のパラメータ）
  const loginParams = new URLSearchParams();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  loginParams.append('date', '4');
  loginParams.append('daystart', today);
  loginParams.append('days', '31');
  loginParams.append('dayofweekClearFlg', '0');
  loginParams.append('timezoneClearFlg', '0');
  loginParams.append('selectAreaBcd', '');
  loginParams.append('selectIcd', '');
  loginParams.append('selectPpsClPpscd', '');
  loginParams.append('e430000', '%92n%88%E6%82%DC%82%BD%82%CD%8A%D9%82%AA%8Ew%92%E8%82%B3%82%EA%82%C4%82%A2%82%DC%82%B9%82%F1%81B%5B%82%C7%82%B1%82%C5%81F%5D%82%F0%91I%91%F0%82%B5%82%C4%89%BA%82%B3%82%A2%81B');
  loginParams.append('e430010', '%97%98%97p%96%DA%93I%82%AA%8Ew%92%E8%82%B3%82%EA%82%C4%82%A2%82%DC%82%B9%82%F1%81B%5B%89%BD%82%F0%82%B7%82%E9%81F%5D%82%F0%91I%91%F0%82%B5%82%C4%89%BA%82%B3%82%A2%81B');
  loginParams.append('e430020', '%8AJ%8En%93%FA%82%CC%93%FC%97%CD%82%C9%8C%EB%82%E8%82%AA%82%A0%82%E8%82%DC%82%B7%81B%90%B3%82%B5%82%A2%93%FA%95t%82%F0%93%FC%97%CD%82%B5%82%C6%89%BA%82%B3%82%A2%81B');
  loginParams.append('ValidEndPWYMD', '0');
  loginParams.append('e150990', '%83p%83X%83%8F%81%5B%83h%97L%8C%F8%8A%FA%8C%C0%82%AA%90%D8%82%EA%82%C4%82%A2%82%DC%82%B7%81B%83p%83X%83%8F%81%5B%83h%95%CF%8DX%91%80%8D%EC%82%F0%8Ds%82%C1%82%C4%89%BA%82%B3%82%A2%81B');
  loginParams.append('lYear', '%94N');
  loginParams.append('lMonth', '%8C%8E');
  loginParams.append('lDay', '%93%FA');
  loginParams.append('lToday', '%8D%A1%93%FA');
  loginParams.append('lTomorrow', '%96%BE%93%FA');
  loginParams.append('lThisweek', '1%8FT%8A%D4');
  loginParams.append('lThismonth', '1%82%A9%8C%8E');
  loginParams.append('lMonday', '%8C%8E');
  loginParams.append('lTuesday', '%89%CE');
  loginParams.append('lWednesday', '%90%85');
  loginParams.append('lThursday', '%96%D8');
  loginParams.append('lFriday', '%8B%E0');
  loginParams.append('lSaturday', '%93y');
  loginParams.append('lSunday', '%93%FA');
  loginParams.append('lAllday', '%8FI%93%FA');
  loginParams.append('lMorning', '%8C%DF%91O');
  loginParams.append('lAfternoon', '%8C%DF%8C%E3');
  loginParams.append('lEvening', '%96%E9%8A%D4');
  loginParams.append('lField', '%96%CA');
  loginParams.append('item540', '%8Ew%92%E8%82%C8%82%B5');
  loginParams.append('displayNo', 'pawab2000');
  loginParams.append('displayNoFrm', 'pawab2000');

  // 空のPOSTで試す

  const initResponse = await fetch(`${baseUrl}/rsvWTransUserLoginAction.do`, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      'Origin': baseUrl,
      'Referer': `${baseUrl}/`,
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-User': '?1',
      ...(sessionId && { 'Cookie': `JSESSIONID=${sessionId}` }),
    },
    body: loginParams.toString(),
    redirect: 'manual',
  });

  console.log(`  Status: ${initResponse.status}`);
  console.log(`  Headers:`, Object.fromEntries(initResponse.headers.entries()));

  const setCookieHeader = initResponse.headers.get('set-cookie');
  if (setCookieHeader) {
    const sessionIdMatch = setCookieHeader.match(/JSESSIONID=([^;]+)/);
    if (sessionIdMatch) {
      sessionId = sessionIdMatch[1];
      console.log(`  ✅ Session updated: ${sessionId.substring(0, 30)}...`);
    }
  } else {
    console.log(`  ℹ️  No session update`);
  }

  const initHtml = await initResponse.text();
  console.log(`  Body length: ${initHtml.length} chars`);

  // エラーページチェック
  if (initHtml.includes('pawfa1000.jsp')) {
    console.log(`  ❌ エラーページが返された！`);
    console.log(`  Body preview: ${initHtml.substring(0, 500)}`);
    return;
  }

  console.log(`  Body preview: ${initHtml.substring(0, 300)}\n`);

  // loginJKey抽出
  console.log('Step 2: loginJKey抽出...');
  const loginJKeyMatch = initHtml.match(/name=["']?loginJKey["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
  if (loginJKeyMatch) {
    const loginJKey = loginJKeyMatch[1];
    console.log(`  ✅ loginJKey: ${loginJKey.substring(0, 60)}...`);
  } else {
    console.log(`  ❌ loginJKey not found`);
    // より詳細な検索
    console.log(`  Searching for 'loginJKey' in HTML...`);
    const loginJKeyLines = initHtml.split('\n').filter(line => line.includes('loginJKey'));
    if (loginJKeyLines.length > 0) {
      console.log(`  Found ${loginJKeyLines.length} lines containing 'loginJKey':`);
      loginJKeyLines.slice(0, 3).forEach(line => console.log(`    ${line.trim()}`));
    } else {
      console.log(`  'loginJKey' not found anywhere in HTML`);
    }
  }

  // displayNo抽出
  const displayNoMatch = initHtml.match(/name=["']?displayNo["']?[^>]*value=["']?([^"'\s>]*)["']?/i);
  if (displayNoMatch) {
    console.log(`  ✅ displayNo: ${displayNoMatch[1]}`);
  } else {
    console.log(`  ❌ displayNo not found`);
  }

  console.log('\n=== テスト完了 ===');
}

testLoginFlow().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
