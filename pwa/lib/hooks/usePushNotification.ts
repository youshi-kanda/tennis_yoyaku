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
        const subscriptionData = sub.toJSON();
        setSubscription({
          endpoint: subscriptionData.endpoint!,
          keys: {
            p256dh: subscriptionData.keys!.p256dh as string,
            auth: subscriptionData.keys!.auth as string,
          },
        });
        setIsSubscribed(true);
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

      const subscriptionData = sub.toJSON();
      const pushSubscription: PushSubscription = {
        endpoint: subscriptionData.endpoint!,
        keys: {
          p256dh: subscriptionData.keys!.p256dh as string,
          auth: subscriptionData.keys!.auth as string,
        },
      };

      setSubscription(pushSubscription);
      setIsSubscribed(true);
      setIsLoading(false);

      // TODO: Send subscription to backend
      await sendSubscriptionToBackend(pushSubscription);

      return true;
    } catch (err: any) {
      console.error('Failed to subscribe:', err);
      setError(err.message || 'プッシュ通知の登録に失敗しました');
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
    } catch (err: any) {
      console.error('Failed to unsubscribe:', err);
      setError(err.message || 'プッシュ通知の解除に失敗しました');
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

// TODO: Implement backend API calls
async function sendSubscriptionToBackend(subscription: PushSubscription) {
  // const response = await apiClient.subscribePush(subscription);
  console.log('Subscription sent to backend:', subscription);
}

async function removeSubscriptionFromBackend() {
  // const response = await apiClient.unsubscribePush();
  console.log('Subscription removed from backend');
}
