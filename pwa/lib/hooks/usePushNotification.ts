import { useState, useEffect } from 'react';

interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function usePushNotification() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsSupported('serviceWorker' in navigator && 'PushManager' in window);
    }
  }, []);

  useEffect(() => {
    if (isSupported) {
      checkSubscription();
    }
  }, [isSupported]);



  const checkSubscription = async () => {
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();

      if (sub) {
        // Robust key extraction for iOS
        const p256dh = arrayBufferToBase64(sub.getKey('p256dh'));
        const auth = arrayBufferToBase64(sub.getKey('auth'));

        if (!p256dh || !auth) {
          console.warn('[Push] Existing subscription missing keys. Unsubscribing to fix.');
          await sub.unsubscribe().catch(e => console.error(e));
          setIsSubscribed(false);
          return;
        }

        const pushSubscription: PushSubscription = {
          endpoint: sub.endpoint,
          keys: { p256dh, auth },
        };

        setSubscription(pushSubscription);
        setIsSubscribed(true);

        // Backendと同期
        sendSubscriptionToBackend(pushSubscription).catch(e =>
          console.warn('[Push] Failed to sync subscription on load:', e)
        );
      } else {
        setIsSubscribed(false);
      }
    } catch (err) {
      console.error('Failed to check subscription:', err);
    }
  };

  const subscribe = async (): Promise<boolean> => {
    if (!isSupported) {
      setError('このブラウザはプッシュ通知に対応していません');
      return false;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Request notification permission
      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        setError('通知の許可が拒否されました');
        setIsLoading(false);
        return false;
      }

      // Register service worker
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        scope: '/',
      });

      await navigator.serviceWorker.ready;

      // Subscribe to push
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        throw new Error('VAPID public key not configured');
      }

      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      });

      // Robust key extraction
      const p256dh = arrayBufferToBase64(sub.getKey('p256dh'));
      const auth = arrayBufferToBase64(sub.getKey('auth'));

      if (!p256dh || !auth) {
        throw new Error('プッシュ通知の鍵情報の取得に失敗しました (iOS compatible mode)');
      }

      const pushSubscription: PushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh, auth },
      };

      setSubscription(pushSubscription);
      setIsSubscribed(true);
      setIsLoading(false);

      // TODO: Send subscription to backend
      await sendSubscriptionToBackend(pushSubscription);

      return true;
    } catch (err: unknown) {
      console.error('Failed to subscribe:', err);
      // 詳細なエラー情報をログに残す
      const axiosError = err as { response?: { data?: { error?: string } }; message?: string };
      if (axiosError.response?.data) {
        console.error('Backend Error Details:', axiosError.response.data);
      }

      const errorMessage = axiosError.response?.data?.error || axiosError.message || 'プッシュ通知の登録に失敗しました';
      setError(errorMessage);
      setIsLoading(false);
      return false;
    }
  };

  const unsubscribe = async (): Promise<boolean> => {
    if (!isSubscribed) return false;

    setIsLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();

      if (sub) {
        await sub.unsubscribe();
        setIsSubscribed(false);
        setSubscription(null);

        // TODO: Remove subscription from backend
        await removeSubscriptionFromBackend();
      }

      setIsLoading(false);
      return true;
    } catch (err: unknown) {
      console.error('Failed to unsubscribe:', err);
      const errorMsg = (err instanceof Error) ? err.message : 'プッシュ通知の解除に失敗しました';
      setError(errorMsg);
      setIsLoading(false);
      return false;
    }
  };

  return {
    isSupported,
    isSubscribed,
    subscription,
    isLoading,
    error,
    subscribe,
    unsubscribe,
  };
}

// Helper function to convert VAPID key
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer: ArrayBuffer | null): string {
  if (!buffer) return '';
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return window.btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendSubscriptionToBackend(subscription: PushSubscription) {
  try {
    const { apiClient } = await import('@/lib/api/client');
    // ブラウザのPushSubscriptionを独自型に変換
    const subscriptionData = {
      endpoint: subscription.endpoint,
      keys: subscription.keys,
    };
    await apiClient.subscribePush(subscriptionData);
    console.log('[Push] Subscription sent to backend:', subscription.endpoint);
  } catch (error) {
    console.error('[Push] Failed to send subscription to backend:', error);
    throw error;
  }
}

async function removeSubscriptionFromBackend() {
  try {
    const { apiClient } = await import('@/lib/api/client');
    await apiClient.unsubscribePush();
    console.log('[Push] Subscription removed from backend');
  } catch (error) {
    console.error('[Push] Failed to remove subscription from backend:', error);
    throw error;
  }
}
