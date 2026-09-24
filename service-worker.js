self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  const title = data.title || 'DockFlow — Você foi chamado';
  const body = data.body || 'Dirija-se à doca indicada.';
  const url = data.url || './';
  const options = {
    body,
    tag: data.tag || 'dockflow-driver-call',
    renotify: true,
    requireInteraction: true,
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [500, 180, 500, 180, 900],
    data: { url }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        if (new URL(client.url).origin === new URL(url, self.location.href).origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(url);
          return;
        }
      } catch (_) {}
    }
    return self.clients.openWindow(url);
  })());
});
