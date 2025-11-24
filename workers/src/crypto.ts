/**
 * AES-256-GCM暗号化ユーティリティ
 * 
 * Workers Secrets の ENCRYPTION_KEY を使用してパスワードを暗号化/復号化
 */

/**
 * パスワードを暗号化
 * 
 * @param plaintext 平文パスワード
 * @param encryptionKey 暗号化キー（Workers Secrets から取得）
 * @returns Base64エンコードされた暗号化データ（IV + 暗号文 + AuthTag）
 */
export async function encryptPassword(
  plaintext: string,
  encryptionKey: string
): Promise<string> {
  // 暗号化キーをバイト配列に変換（Hex文字列想定）
  const keyData = hexToArrayBuffer(encryptionKey);
  
  // CryptoKey オブジェクトをインポート
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  // 初期化ベクトル（IV）を生成（96ビット = 12バイト）
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 平文を UTF-8 バイト配列に変換
  const encoder = new TextEncoder();
  const plaintextData = encoder.encode(plaintext);

  // 暗号化実行
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128, // 認証タグのビット長
    },
    cryptoKey,
    plaintextData
  );

  // IV + 暗号文（+認証タグ）を結合
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  // Base64エンコードして返す
  return arrayBufferToBase64(combined.buffer);
}

/**
 * パスワードを復号化
 * 
 * @param encryptedData Base64エンコードされた暗号化データ
 * @param encryptionKey 暗号化キー（Workers Secrets から取得）
 * @returns 平文パスワード
 */
export async function decryptPassword(
  encryptedData: string,
  encryptionKey: string
): Promise<string> {
  // Base64デコード
  const combined = base64ToArrayBuffer(encryptedData);

  // IV（最初の12バイト）と暗号文を分離
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  // 暗号化キーをバイト配列に変換
  const keyData = hexToArrayBuffer(encryptionKey);

  // CryptoKey オブジェクトをインポート
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  // 復号化実行
  const plaintextData = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv,
      tagLength: 128,
    },
    cryptoKey,
    ciphertext
  );

  // UTF-8 文字列に変換
  const decoder = new TextDecoder();
  return decoder.decode(plaintextData);
}

/**
 * 新しい暗号化キーを生成（初回セットアップ用）
 * 
 * 実行例:
 * const key = await generateEncryptionKey();
 * console.log(key); // 64文字のHex文字列
 * 
 * @returns 256ビット（32バイト）の暗号化キー（Hex文字列）
 */
export async function generateEncryptionKey(): Promise<string> {
  const keyData = crypto.getRandomValues(new Uint8Array(32)); // 256ビット
  return arrayBufferToHex(keyData.buffer);
}

// ========================================
// ヘルパー関数
// ========================================

/**
 * Hex文字列を ArrayBuffer に変換
 */
function hexToArrayBuffer(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

/**
 * ArrayBuffer を Hex文字列 に変換
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * ArrayBuffer を Base64文字列 に変換
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Base64文字列 を ArrayBuffer に変換
 */
function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * パスワードが暗号化済みかどうかを判定
 * 
 * @param password チェックするパスワード
 * @returns 暗号化済みの場合 true
 */
export function isEncrypted(password: string): boolean {
  // Base64形式で、かつ最小限の長さ（IV 12バイト + 暗号文 + 認証タグ 16バイト = 最小28バイト → Base64で約38文字以上）
  if (!password || password.length < 38) {
    return false;
  }
  
  // Base64文字列かどうかをチェック
  const base64Regex = /^[A-Za-z0-9+/]+=*$/;
  return base64Regex.test(password);
}
