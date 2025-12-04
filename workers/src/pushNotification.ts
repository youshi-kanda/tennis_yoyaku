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

/**
 * Base64 URL-safe エンコーディング
 */
function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
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
  return new Uint8Array(okm.slice(0, length));
}

/**
 * Web Push用のペイロード暗号化（aes128gcm）
 * RFC 8291準拠
 */
async function encryptPayload(
  payload: string,
  userPublicKey: string,
  userAuthSecret: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // 1. サーバー側のECDH鍵ペア生成（P-256）
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );

  // 2. サーバー公開鍵をraw形式でエクスポート（65バイト: 0x04 + x + y）
  const serverPublicKeyRaw = await crypto.subtle.exportKey('raw', serverKeyPair.publicKey);
  const serverPublicKeyBytes = new Uint8Array(serverPublicKeyRaw);

  // 3. クライアント公開鍵をデコード
  const clientPublicKeyBytes = base64UrlDecode(userPublicKey);

  // 4. クライアント公開鍵をインポート
  const clientPublicKey = await crypto.subtle.importKey(
    'raw',
    clientPublicKeyBytes,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // 5. ECDH共有シークレット生成
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );

  // 6. authシークレットをデコード
  const authSecret = base64UrlDecode(userAuthSecret);

  // 7. ソルト生成（16バイト）
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 8. PRKの生成（HKDF-SHA256）
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
  const prk = await hkdf(authSecret, new Uint8Array(sharedSecret), authInfo, 32);

  // 9. コンテキスト情報の構築
  const context = new Uint8Array(135); // 1 + 2 + 65 + 2 + 65
  let offset = 0;

  // ラベル "P-256" (0x00で終端なし、長さプレフィックス)
  context[offset++] = 0; // ラベル長（廃止済みフィールド）
  
  // クライアント公開鍵長（2バイト、ビッグエンディアン）
  context[offset++] = 0;
  context[offset++] = 65;
  context.set(clientPublicKeyBytes, offset);
  offset += 65;

  // サーバー公開鍵長（2バイト、ビッグエンディアン）
  context[offset++] = 0;
  context[offset++] = 65;
  context.set(serverPublicKeyBytes, offset);

  // 10. IKM生成（HKDF）
  const cekInfo = new Uint8Array(
    new TextEncoder().encode('Content-Encoding: aesgcm\0P-256\0').length + context.length
  );
  cekInfo.set(new TextEncoder().encode('Content-Encoding: aesgcm\0P-256\0'));
  cekInfo.set(context, new TextEncoder().encode('Content-Encoding: aesgcm\0P-256\0').length);

  const ikm = await hkdf(salt, prk, cekInfo, 16);

  // 11. ノンス生成（HKDF）
  const nonceInfo = new Uint8Array(
    new TextEncoder().encode('Content-Encoding: nonce\0P-256\0').length + context.length
  );
  nonceInfo.set(new TextEncoder().encode('Content-Encoding: nonce\0P-256\0'));
  nonceInfo.set(context, new TextEncoder().encode('Content-Encoding: nonce\0P-256\0').length);

  const nonce = await hkdf(salt, prk, nonceInfo, 12);

  // 12. ペイロードにパディング追加（2バイトのパディング長 + 実データ）
  const paddingLength = 0; // パディングなし
  const paddedPayload = new Uint8Array(2 + payload.length);
  paddedPayload[0] = (paddingLength >> 8) & 0xff;
  paddedPayload[1] = paddingLength & 0xff;
  paddedPayload.set(new TextEncoder().encode(payload), 2);

  // 13. AES-GCM暗号化
  const key = await crypto.subtle.importKey('raw', ikm, { name: 'AES-GCM' }, false, ['encrypt']);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    paddedPayload
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    salt: salt,
    serverPublicKey: serverPublicKeyBytes,
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
async function getUserSubscription(
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
    const encrypted = await encryptPayload(
      notificationPayload,
      subscription.keys.p256dh,
      subscription.keys.auth
    );

    // Crypto-Keyヘッダー（サーバー公開鍵）
    const serverPublicKeyBase64 = base64UrlEncode(encrypted.serverPublicKey.buffer);
    
    // Encryptionヘッダー（ソルト）
    const saltBase64 = base64UrlEncode(encrypted.salt.buffer);

    // Web Push APIにリクエスト送信
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aesgcm',
        'Encryption': `salt=${saltBase64}`,
        'Crypto-Key': `dh=${serverPublicKeyBase64};p256ecdsa=${vapidPublicKey}`,
        'Authorization': `vapid t=${vapidToken}, k=${vapidPublicKey}`,
        'TTL': '86400', // 24時間
      },
      body: encrypted.ciphertext,
    });

    if (response.ok) {
      console.log(`[Push] Notification sent successfully to user: ${userId}`);
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
