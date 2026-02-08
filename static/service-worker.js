// Simple passthrough service worker to satisfy installability requirements.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Network passthrough; add caching here if desired.
});

self.addEventListener('push', (event) => {
  try {
    const data = event.data ? event.data.json() : null;
    const title = data?.title ?? 'Kickback';
    const body = data?.body ?? '';
    const icon = data?.icon ?? '/favicon.png';
    const badge = data?.badge ?? '/favicon.png';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon,
        badge
      })
    );
  } catch (e) {}
});
