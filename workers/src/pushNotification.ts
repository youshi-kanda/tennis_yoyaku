/**
 * Web Push通知機能
 * VAPID認証を使用してPWAにプッシュ通知を送信
 * RFC 8291 (aes128gcm) 準拠
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

// -----------------------------------------------------------------------------
//  Manual Crypto Implementation for RFC 8291 (aes128gcm)
// -----------------------------------------------------------------------------

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

function base64UrlEncode(buffer: ArrayBuffer | ArrayBufferView): string {
  const bytes = new Uint8Array(buffer as any);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    salt,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const prk = await crypto.subtle.sign('HMAC', key, ikm);
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

async function encryptPayload(
  payload: string,
  userPublicKey: string,
  userAuthSecret: string
): Promise<{ ciphertext: Uint8Array; salt: Uint8Array; serverPublicKey: Uint8Array }> {
  // 1. Server ECDH Key Pair
  const serverKeyPair = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;
  const serverPublicKeyRaw = (await crypto.subtle.exportKey('raw', serverKeyPair.publicKey)) as ArrayBuffer;
  const serverPublicKeyBytes = new Uint8Array(serverPublicKeyRaw);

  // 2. Client Public Key & Auth Secret
  const clientPublicKeyBytes = base64UrlDecode(userPublicKey);
  const authSecret = base64UrlDecode(userAuthSecret);

  // 3. Shared Secret
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

  // 4. Salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 5. PRK (Pseudo-Random Key)
  // Info = "WebPush: info" || 0x00 || ua_public || as_public
  const keyInfo = new Uint8Array(13 + 1 + clientPublicKeyBytes.length + serverPublicKeyBytes.length);
  let offset = 0;
  keyInfo.set(new TextEncoder().encode('WebPush: info\0'), 0); offset += 14;
  keyInfo.set(clientPublicKeyBytes, offset); offset += clientPublicKeyBytes.length;
  keyInfo.set(serverPublicKeyBytes, offset);

  const prkKey = await hkdf(authSecret, new Uint8Array(sharedSecret), keyInfo, 32);

  // 6. CEK (Content Encryption Key) & Nonce
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = await hkdf(salt, prkKey, cekInfo, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = await hkdf(salt, prkKey, nonceInfo, 12);

  // 7. Encrypt (AES-128-GCM)
  // Padding = 0x02 || 0x00 (Record delimiter + zero padding)
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 1);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 0x02; // Record separator (0x02) implies end of data + padding follows? Using 0x02 as described in RFC8188 examples.

  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, tagLength: 128 },
    key,
    paddedPayload
  );

  // 8. Construct Header (RFC 8291 / 8188)
  // Header = Salt (16) || RS (4) || IDLen (1) || KeyID (65)
  const header = new Uint8Array(16 + 4 + 1 + 65);

  // Salt
  header.set(salt, 0);

  // Record Size = 4096 (0x00001000) - Big Endian
  header[16] = 0x00; header[17] = 0x00; header[18] = 0x10; header[19] = 0x00;

  // Key ID Length = 65 (Server Public Key length)
  header[20] = 65;

  // Key ID (Server Public Key)
  header.set(serverPublicKeyBytes, 21);

  // 9. Combine Header + Ciphertext
  const ciphertextBytes = new Uint8Array(encrypted);
  const finalBody = new Uint8Array(header.length + ciphertextBytes.length);
  finalBody.set(header);
  finalBody.set(ciphertextBytes, header.length);

  return {
    ciphertext: finalBody,
    salt: salt,
    serverPublicKey: serverPublicKeyBytes
  };
}

async function generateVapidJWT(
  audience: string,
  subject: string,
  privateKey: string,
  publicKey: string
): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  };

  const encodedHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKeyBytes = base64UrlDecode(privateKey);
  const publicKeyBytes = base64UrlDecode(publicKey);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKeyBytes.slice(1, 33)),
    y: base64UrlEncode(publicKeyBytes.slice(33, 65)),
    d: base64UrlEncode(privateKeyBytes),
    ext: true
  };

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${base64UrlEncode(signature)}`;
}

// -----------------------------------------------------------------------------
//  Main Functions
// -----------------------------------------------------------------------------

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

export async function sendPushNotification(
  userId: string,
  payload: PushNotificationPayload,
  env: Env
): Promise<boolean> {
  try {
    const subscription = await getUserSubscription(userId, env);
    if (!subscription) {
      return false;
    }

    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      console.error('[Push] VAPID configuration missing');
      return false;
    }

    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const vapidToken = await generateVapidJWT(audience, env.VAPID_SUBJECT, env.VAPID_PRIVATE_KEY, env.VAPID_PUBLIC_KEY);

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

    // 暗号化 (aes128gcm)
    const encrypted = await encryptPayload(
      notificationPayload,
      subscription.keys.p256dh,
      subscription.keys.auth
    );

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Authorization': `vapid t=${vapidToken}, k=${env.VAPID_PUBLIC_KEY}`,
        'TTL': '86400',
        'Content-Type': 'application/octet-stream',
      },
      body: encrypted.ciphertext,
    });

    if (response.ok) {
      console.log(`[Push] Notification sent successfully to user: ${userId}`);
      await saveNotificationHistory(userId, payload, env).catch(e => console.error(e));
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[Push] Error ${response.status}: ${errorText}`);
      if (response.status === 410) {
        await env.USERS.delete(`push_subscription:${userId}`);
      }
      return false;
    }
  } catch (err) {
    console.error(`[Push] Error sending notification:`, err);
    return false;
  }
}

export async function savePushSubscription(
  userId: string,
  subscription: PushSubscription,
  env: Env
): Promise<void> {
  const key = `push_subscription:${userId}`;
  await env.USERS.put(key, JSON.stringify(subscription));
  console.log(`[Push] Saved subscription for user: ${userId}`);
}

export async function deletePushSubscription(
  userId: string,
  env: Env
): Promise<void> {
  const key = `push_subscription:${userId}`;
  await env.USERS.delete(key);
  console.log(`[Push] Deleted subscription for user: ${userId}`);
}

export async function saveNotificationHistory(
  userId: string,
  payload: PushNotificationPayload,
  env: Env
): Promise<void> {
  const key = `notification_history:${userId}`;
  let history: NotificationHistoryItem[] = [];
  const existingData = await env.USERS.get(key);
  if (existingData) {
    try {
      history = JSON.parse(existingData);
    } catch { }
  }
  const newItem: NotificationHistoryItem = {
    id: crypto.randomUUID(),
    title: payload.title,
    body: payload.body,
    icon: payload.icon,
    timestamp: Date.now(),
    data: payload.data
  };
  history.unshift(newItem);
  if (history.length > 50) history = history.slice(0, 50);
  await env.USERS.put(key, JSON.stringify(history), { expirationTtl: 60 * 60 * 24 * 30 });
}

export async function getNotificationHistory(
  userId: string,
  env: Env
): Promise<NotificationHistoryItem[]> {
  const key = `notification_history:${userId}`;
  const data = await env.USERS.get(key);
  if (!data) return [];
  try {
    return JSON.parse(data) as NotificationHistoryItem[];
  } catch {
    return [];
  }
}
