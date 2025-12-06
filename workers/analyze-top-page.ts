/**
 * トップページのHTML解析 - ログインページへのリンクを探す
 */

async function analyzeTopPage() {
  const baseUrl = 'https://www.cm9.eprs.jp/shinagawa/web';
  
  console.log('=== トップページ解析 ===\n');
  
  const topResponse = await fetch(`${baseUrl}/`, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7',
      'Cache-Control': 'no-cache',
    },
  });
  
  const html = await topResponse.text();
  
  // Shift_JISでデコード
  const encoder = new TextEncoder();
  const decoder = new TextDecoder('shift-jis');
  
  // ログイン関連のリンクを探す
  console.log('ログイン関連のリンク/ボタンを検索...\n');
  
  const loginPatterns = [
    /href=["']([^"']*Login[^"']*)["']/gi,
    /href=["']([^"']*login[^"']*)["']/gi,
    /action=["']([^"']*Login[^"']*)["']/gi,
    /action=["']([^"']*login[^"']*)["']/gi,
    /<a[^>]*>[\s\S]*?ログイン[\s\S]*?<\/a>/gi,
    /<button[^>]*>[\s\S]*?ログイン[\s\S]*?<\/button>/gi,
  ];
  
  const matches = new Set<string>();
  
  for (const pattern of loginPatterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      matches.add(match[0]);
    }
  }
  
  if (matches.size > 0) {
    console.log(`発見: ${matches.size}件のマッチ\n`);
    Array.from(matches).forEach(match => {
      console.log(match);
      console.log('---');
    });
  } else {
    console.log('マッチなし\n');
  }
  
  // rsvWTransUserLoginAction.doへの参照を検索
  console.log('\nrsvWTransUserLoginAction.doへの参照を検索...\n');
  const lines = html.split('\n');
  const relevantLines = lines.filter(line => 
    line.includes('rsvWTransUserLoginAction') || 
    line.includes('UserLogin')
  );
  
  if (relevantLines.length > 0) {
    console.log(`発見: ${relevantLines.length}行\n`);
    relevantLines.slice(0, 10).forEach(line => {
      console.log(line.trim());
      console.log('---');
    });
  } else {
    console.log('参照なし');
  }
  
  // HTMLの一部を表示
  console.log('\n\nHTML構造サンプル（最初の3000文字）:\n');
  console.log(html.substring(0, 3000));
}

analyzeTopPage().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
