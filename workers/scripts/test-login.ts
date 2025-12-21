/**
 * ログイン処理の単体テスト
 */

import { loginToShinagawa } from '../src/scraper';

async function testLogin() {
  console.log('=== ログイン処理テスト開始 ===');
  
  // 環境変数から認証情報を取得（または直接指定）
  const userId = process.env.SHINAGAWA_USER_ID || '84005349';
  const password = process.env.SHINAGAWA_PASSWORD || 'Aa1234567890';
  
  try {
    const sessionId = await loginToShinagawa(userId, password);
    
    if (sessionId) {
      console.log('✅ ログイン成功!');
      console.log('Session ID:', sessionId.substring(0, 30) + '...');
    } else {
      console.log('❌ ログイン失敗');
    }
  } catch (error) {
    console.error('❌ エラー発生:', error);
  }
  
  console.log('=== テスト終了 ===');
}

testLogin();
