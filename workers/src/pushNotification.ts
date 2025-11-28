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
 * VAPID JWTトークンを生成
 */
async function generateVapidJWT(
  audience: string,
  subject: string,
  privateKey: string
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

  // VAPID秘密鍵をインポート（Base64 URL-safe → ArrayBuffer）
  const privateKeyBuffer = Uint8Array.from(
    atob(privateKey.replace(/-/g, '+').replace(/_/g, '/')),
    (c) => c.charCodeAt(0)
  );

  const key = await crypto.subtle.importKey(
    'raw',
    privateKeyBuffer,
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
    const vapidToken = await generateVapidJWT(audience, vapidSubject, vapidPrivateKey);

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

    // Web Push APIにリクエスト送信
    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'aes128gcm',
        'Authorization': `vapid t=${vapidToken}, k=${vapidPublicKey}`,
        'TTL': '86400', // 24時間
      },
      body: notificationPayload,
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
