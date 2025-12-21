/**
 * 暗号化キー生成スクリプト
 * 
 * 実行方法:
 * cd workers
 * npx ts-node generate-encryption-key.ts
 * 
 * 出力されたキーを以下のコマンドでWorkers Secretsに登録:
 * npx wrangler secret put ENCRYPTION_KEY
 */

import { generateEncryptionKey } from '../src/crypto';

async function main() {
  console.log('🔐 暗号化キーを生成しています...\n');
  
  const key = await generateEncryptionKey();
  
  console.log('✅ 暗号化キーの生成が完了しました！\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('以下のキーをWorkers Secretsに登録してください:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(key);
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📋 登録コマンド:');
  console.log('npx wrangler secret put ENCRYPTION_KEY\n');
  console.log('⚠️  注意: このキーは安全に保管してください！');
  console.log('   キーを紛失すると、既存の暗号化パスワードを復号化できなくなります。\n');
}

main().catch(console.error);
