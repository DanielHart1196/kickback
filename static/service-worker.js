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
