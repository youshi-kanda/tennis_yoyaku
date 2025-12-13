/**
 * Web Push通知機能
 * VAPID認証を使用してPWAにプッシュ通知を送信
 */

export interface Env {
  USERS: KVNamespace;
  SESSIONS: KVNamespace;
  MONITORING: KVNamespace;
  RESERVATIONS: KVNamespace;
  ENVIRONMENT: string;
  ENCRYPTION_KEY: string;
  JWT_SECRET: string;
  ADMIN_KEY: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data?: {
    url?: string;
    timestamp?: number;
    [key: string]: any;
  };
}

export interface NotificationHistoryItem {
  id: string;
  title: string;
  body: string;
  icon?: string;
  timestamp: number;
  data?: any;
}

/**
 * Base64 URL-safe エンコーディング
 */
function base64UrlEncode(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = new Uint8Array(buffer as any);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Base64 URL-safe デコーディング
 */
function base64UrlDecode(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * HKDF-SHA256によるキー派生
 */
async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  // HMAC-SHA256でPRKを生成
  const key = await crypto.subtle.importKey(
    'raw',
    salt,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const prk = await crypto.subtle.sign('HMAC', key, ikm);

  // HKDFでOKMを生成
  const prkKey = await crypto.subtle.importKey(
    'raw',
    prk,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const infoAndCounter = new Uint8Array(info.length + 1);
  infoAndCounter.set(info);
  infoAndCounter[info.length] = 1;

  const okm = await crypto.subtle.sign('HMAC', prkKey, infoAndCounter);
  return new Uint8Array(okm.slice(0, length) as ArrayBuffer);
}

/**
 * Web Push用のペイロード暗号化（aes128gcm）
 * RFC 8291準拠
 */
/**
 * Web Push用のペイロード暗号化（aes128gcm）
 * RFC 8291準拠 (iOS/Safari対応)
 */
async function encryptPayload(
  payload: string,
  userPublicKey: string,
  userAuthSecret: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // 1. サーバー側のECDH鍵ペア生成（P-256）
  const serverKeyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;

  const serverPublicKeyRaw = (await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)) as ArrayBuffer;
  const serverPublicKeyBytes = new Uint8Array(serverPublicKeyRaw);

  // 2. クライアント公開鍵・Authシークレットをデコード
  const clientPublicKeyBytes = base64UrlDecode(userPublicKey);
  const authSecret = base64UrlDecode(userAuthSecret);

  // 3. 共有シークレット生成 (ECDH)
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey } as any,
    serverKeyPair.privateKey,
    256
  );

  // 4. ソルト生成 (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. PRK_key生成 (HKDF-SHA256)
  // key_info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = new Uint8Array(new TextEncoder().encode('WebPush: info\0').length + clientPublicKeyBytes.length + serverPublicKeyBytes.length);
  let offset = 0;
  keyInfo.set(new TextEncoder().encode('WebPush: info\0'), offset); offset += 14;
  keyInfo.set(clientPublicKeyBytes, offset); offset += clientPublicKeyBytes.length;
  keyInfo.set(serverPublicKeyBytes, offset);

  // IKM = shared_secret
  const prkKey = await hkdf(authSecret, new Uint8Array(sharedSecret), keyInfo, 32);

  // 6. CEK (Content Encryption Key) と Nonce の生成
  // RFC 8291: "Content-Encoding: aes128gcm" || 0x00
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const prk = await hkdf(salt, prkKey, cekInfo, 16); // CEK

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, prkKey, nonceInfo, 12); // Nonce

  // 7. ペイロードのパディングと暗号化
  // Padding: 末尾に 0x02 || 0x00 (padding length 0 の場合) を追加
  // RFC 8188: plain_text || 0x02 || padding (0x00...)
  // ここではパディングなしで最小構成にする
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 0x02; // Record separator

  const key = await crypto.subtle.importKey('raw', prk, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    paddedPayload
  );

  // 8. ヘッダー構築 (RFC 8188)
  // Header = Salt (16) || Record Size (4) || Key ID Len (1) || Key ID (0)
  const ciphertextBytes = new Uint8Array(encrypted);
  const recordSize = ciphertextBytes.length + 128 / 8; // Tag included in ciphertext? Yes for AES-GCM webcrypto result.
  // WebCrypto encrypt returns ciphertext + tag appended.
  // Record Size = length of (plaintext + padding + tag) ? No.
  // RFC 8188: "rs" is the size of the records. default is 4096.
  // We are sending a single record.
  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  // Record Size (4096 default, big endian)
  header[16] = 0x00; header[17] = 0x00; header[18] = 0x10; header[19] = 0x00;
  header[20] = 0x00; // Key ID length

  // 結合: Header || Ciphertext
  const finalBody = new Uint8Array(header.length + ciphertextBytes.length);
  finalBody.set(header);
  finalBody.set(ciphertextBytes, header.length);

  return {
    ciphertext: finalBody,
    salt: salt, // Not used in header anymore but returned for interface compat
    serverPublicKey: serverPublicKeyBytes, // Not used in header anymore but returned
  };
}

/**
 * VAPID JWTトークンを生成
 */
async function generateVapidJWT(
  audience: string,
  subject: string,
  privateKey: string,
  publicKey: string
): Promise<string> {
  // JWTヘッダー
  const header = {
    typ: 'JWT',
    alg: 'ES256',
  };

  // JWTペイロード（有効期限: 12時間）
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };

  // Base64 URL-safe エンコード
  const encodedHeader = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(header))
  );
  const encodedPayload = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  try {
    // VAPID秘密鍵をデコード（Base64 URL-safe → ArrayBuffer）
    const privateKeyBytes = Uint8Array.from(
      atob(privateKey.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );

    // 公開鍵をデコード（65バイト: 0x04 + x(32) + y(32)）
    const publicKeyBytes = Uint8Array.from(
      atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    );

    // P-256秘密鍵をJWK形式に変換
    // Web CryptoではJWK形式が必要 (秘密鍵 + 公開鍵座標)
    const jwk = {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(publicKeyBytes.slice(1, 33)),  // x座標 (32バイト)
      y: base64UrlEncode(publicKeyBytes.slice(33, 65)), // y座標 (32バイト)
      d: base64UrlEncode(privateKeyBytes),              // 秘密鍵 (32バイト)
      ext: true
    };

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign']
    );

    // 署名生成
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(unsignedToken)
    );

    const encodedSignature = base64UrlEncode(signature);
    return `${unsignedToken}.${encodedSignature}`;
  } catch (error) {
    console.error('[VAPID] JWT generation failed:', error);
    throw new Error(`VAPID JWT generation failed: ${error}`);
  }
}

/**
 * ユーザーのプッシュ通知サブスクリプションを取得
 */
export async function getUserSubscription(
  userId: string,
  env: Env
): Promise<PushSubscription | null> {
  const key = `push_subscription:${userId}`;
  const data = await env.USERS.get(key);

  if (!data) {
    console.warn(`[Push] No subscription found for user: ${userId}`);
    return null;
  }

  try {
    return JSON.parse(data) as PushSubscription;
  } catch (err) {
    console.error(`[Push] Failed to parse subscription for user ${userId}:`, err);
    return null;
  }
}

/**
 * プッシュ通知を送信
 */
export async function sendPushNotification(
  userId: string,
  payload: PushNotificationPayload,
  env: Env
): Promise<boolean> {
  try {
    // ユーザーのサブスクリプションを取得
    const subscription = await getUserSubscription(userId, env);
    if (!subscription) {
      console.warn(`[Push] Cannot send notification - no subscription for user: ${userId}`);
      return false;
    }

    // VAPID設定を取得
    const vapidPublicKey = env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
    const vapidSubject = env.VAPID_SUBJECT;

    if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
      console.error('[Push] VAPID configuration missing');
      return false;
    }

    // エンドポイントからオリジンを抽出（JWT audience用）
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;

    // VAPID JWTトークンを生成
    const vapidToken = await generateVapidJWT(audience, vapidSubject, vapidPrivateKey, vapidPublicKey);

    // 通知ペイロードを作成
    const notificationPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/badge-72x72.png',
      data: {
        timestamp: Date.now(),
        ...payload.data,
      },
    });

    // ペイロードを暗号化（aes128gcm）
    let encrypted;
    try {
      encrypted = await encryptPayload(
        notificationPayload,
        subscription.keys.p256dh,
        subscription.keys.auth
      );
    } catch (e: any) {
      console.error(`[Push] Encryption failed for user ${userId}:`, e);
      if (e instanceof RangeError) {
        console.error('[Push] Keys:', subscription.keys);
      }
      return false;
    }

    // Crypto-Keyヘッダー（サーバー公開鍵）
    const serverPublicKeyBase64 = base64UrlEncode(encrypted.serverPublicKey.buffer as ArrayBuffer);

    // Encryptionヘッダー（ソルト）
    // aes128gcmではヘッダー不要（ボディに含まれる）

    // Web Push APIにリクエスト送信
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Authorization': `vapid t=${vapidToken}, k=${vapidPublicKey}`,
        'TTL': '86400', // 24時間
      },
      body: encrypted.ciphertext,
    });

    if (response.ok) {
      console.log(`[Push] Notification sent successfully to user: ${userId}`);
      // 通知履歴を保存 (非同期で実行し、メインフローをブロックしない)
      await saveNotificationHistory(userId, payload, env).catch(err =>
        console.error(`[Push] Failed to save history for user ${userId}:`, err)
      );
      return true;
    } else {
      const errorText = await response.text();
      console.error(
        `[Push] Failed to send notification to user ${userId}: ${response.status} ${errorText}`
      );

      // 410 Gone: サブスクリプションが無効 → 削除
      if (response.status === 410) {
        await env.USERS.delete(`push_subscription:${userId}`);
        console.log(`[Push] Deleted invalid subscription for user: ${userId}`);
      }

      return false;
    }
  } catch (err) {
    console.error(`[Push] Error sending notification to user ${userId}:`, err);
    return false;
  }
}

/**
 * プッシュ通知サブスクリプションを保存
 */
export async function savePushSubscription(
  userId: string,
  subscription: PushSubscription,
  env: Env
): Promise<void> {
  const key = `push_subscription:${userId}`;
  await env.USERS.put(key, JSON.stringify(subscription));
  console.log(`[Push] Saved subscription for user: ${userId}`);
}

/**
 * プッシュ通知サブスクリプションを削除
 */
export async function deletePushSubscription(
  userId: string,
  env: Env
): Promise<void> {
  const key = `push_subscription:${userId}`;
  await env.USERS.delete(key);
  console.log(`[Push] Deleted subscription for user: ${userId}`);
}

/**
 * 通知履歴を保存 (最大50件)
 */
export async function saveNotificationHistory(
  userId: string,
  payload: PushNotificationPayload,
  env: Env
): Promise<void> {
  const key = `notification_history:${userId}`;

  // 既存の履歴を取得
  let history: NotificationHistoryItem[] = [];
  const existingData = await env.USERS.get(key);
  if (existingData) {
    try {
      history = JSON.parse(existingData);
    } catch (e) {
      console.error(`[Push] Failed to parse history for user ${userId}`, e);
    }
  }

  // 新しい通知を追加
  const newItem: NotificationHistoryItem = {
    id: crypto.randomUUID(),
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    timestamp: Date.now(),
    data: payload.data
  };

  // 先頭に追加し、最大50件に制限
  history.unshift(newItem);
  if (history.length > 50) {
    history = history.slice(0, 50);
  }

  // 保存 (TTL 30日)
  await env.USERS.put(key, JSON.stringify(history), { expirationTtl: 60 * 60 * 24 * 30 });
}

/**
 * 通知履歴を取得
 */
export async function getNotificationHistory(
  userId: string,
  env: Env
): Promise<NotificationHistoryItem[]> {
  const key = `notification_history:${userId}`;
  const data = await env.USERS.get(key);

  if (!data) return [];

  try {
    return JSON.parse(data) as NotificationHistoryItem[];
  } catch (e) {
    console.error(`[Push] Failed to parse history for user ${userId}`, e);
    return [];
  }
}

