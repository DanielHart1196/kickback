self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : {};
    const title = data.title || 'Kickback';
    const body = data.body || '';
    const icon = data.icon || '/favicon.png';
    const badge = data.badge || '/favicon.png';
    event.waitUntil(self.registration.showNotification(title, { body, icon, badge }));
  } catch {
    event.waitUntil(self.registration.showNotification('Kickback', { body: '' }));
  }
});

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});
