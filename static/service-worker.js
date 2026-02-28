self.addEventListener('install', () => {
  try {
    self.skipWaiting();
  } catch {}
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch {}
    })()
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json?.() ?? {};
  } catch {
    payload = { title: 'Kickback', body: event.data?.text?.() ?? '' };
  }
  const title = payload.title || 'Kickback';
  const body = payload.body || '';
  const url = payload.url || '/';
  const options = {
    body,
    data: { url },
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate?.(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })()
  );
});
