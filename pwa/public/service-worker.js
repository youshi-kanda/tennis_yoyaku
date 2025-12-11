// Service Worker for PWA
const CACHE_NAME = 'tennis-yoyaku-v1';
const urlsToCache = [
  '/',
  '/dashboard',
];

// Install event
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching app shell');
      return cache.addAll(urlsToCache);
    })
  );
  self.skipWaiting();
});

// Activate event
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event - Network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // POSTリクエストはキャッシュしない
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone the response
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);

  let data = { title: 'テニスコート予約', body: '新しい通知があります' };

  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data.body = event.data.text();
    }
  }

  // 通知タイプに応じて表示をカスタマイズ
  const notificationType = data.data?.type || 'default';

  let options = {
    body: data.body,
    icon: '/icon-192x192.png',
    badge: '/icon-96x96.png',
    vibrate: [200, 100, 200],
    tag: 'tennis-notification',
    requireInteraction: true,
    data: {
      url: data.url || '/dashboard',
      timestamp: Date.now(),
      type: notificationType,
      targetId: data.data?.targetId,
    },
    actions: [
      {
        action: 'open',
        title: '開く',
      },
      {
        action: 'close',
        title: '閉じる',
      },
    ],
  };

  // 「取」マーク検知の場合は、より目立つ通知に
  if (notificationType === 'status_tori_detected') {
    options.vibrate = [300, 200, 300, 200, 300]; // より長い振動
    options.tag = 'tori-detected-' + Date.now(); // ユニークなタグで複数表示可能に
    options.badge = '/icon-96x96.png';
    options.requireInteraction = true; // 必ず手動で閉じる必要がある

    // 🔥 アイコンとして絵文字を使用（視覚的に目立つ）
    options.icon = '/icon-192x192.png';
    console.log('[SW] 🔥 "取" マーク検知通知を表示');
  }

  // 空き検知の場合
  if (notificationType === 'vacant_detected') {
    options.vibrate = [200, 100, 200, 100, 200];
    options.tag = 'vacant-detected-' + Date.now(); // ユニークなタグで複数表示可能に
    options.requireInteraction = true;
    console.log('[SW] ○ 空き検知通知を表示');
  }

  // 「取」→「○」変化検知の場合（最も重要）
  if (notificationType === 'tori_to_vacant') {
    options.vibrate = [400, 200, 400, 200, 400, 200, 400]; // 非常に長い振動
    options.tag = 'tori-to-vacant-' + Date.now(); // ユニークなタグで複数表示可能に
    options.requireInteraction = true; // 必ず手動で閉じる必要がある
    options.renotify = true; // 再通知を有効化
    console.log('[SW] 🎉 "取"→"○" 変化検知通知を表示');
  }

  // 予約成功の場合
  if (notificationType === 'reservation_success') {
    options.vibrate = [100, 50, 100, 50, 100];
    options.tag = 'reservation-success-' + Date.now();
    options.requireInteraction = false; // 自動で消える
    console.log('[SW] ✅ 予約成功通知を表示');
  }

  // 予約失敗の場合
  if (notificationType === 'reservation_failed') {
    options.vibrate = [200, 100, 200];
    options.tag = 'reservation-failed-' + Date.now();
    options.requireInteraction = false;
    console.log('[SW] ❌ 予約失敗通知を表示');
  }

  // 「取」マーク消失の場合
  if (notificationType === 'tori_disappeared') {
    options.vibrate = [150, 100, 150];
    options.tag = 'tori-disappeared-' + Date.now();
    options.requireInteraction = false;
    console.log('[SW] ℹ️ "取"マーク消失通知を表示');
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);

  event.notification.close();

  if (event.action === 'close') {
    return;
  }

  const urlToOpen = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Check if a window is already open
      for (const client of clientList) {
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

// Background sync (future implementation)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  if (event.tag === 'sync-reservations') {
    // event.waitUntil(syncReservations());
    console.log('Sync not implemented');
  }
});

// async function syncReservations() {
//   console.log('[SW] Syncing reservations...');
//   // TODO: Implement background sync logic
// }
