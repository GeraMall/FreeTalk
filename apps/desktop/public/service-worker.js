self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: 'Trlka', body: event.data?.text() ?? 'Новое сообщение' };
  }
  const title = payload.title || 'Trlka';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      if (clients.some((client) => client.visibilityState === 'visible')) return;
      return self.registration.showNotification(title, {
        body: payload.body || 'Новое сообщение',
        icon: payload.icon || '/app/icons/trlka-192.png',
        badge: payload.badge || '/app/icons/trlka-192.png',
        tag: payload.chatId ? `trlka-chat-${payload.chatId}` : 'trlka-message',
        renotify: true,
        data: { url: payload.url || '/app/', chatId: payload.chatId || null },
      });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const app = clients.find((client) => client.url.startsWith(`${self.location.origin}/app/`));
      if (app) {
        await app.focus();
        app.postMessage({
          type: 'trlka-notification-open',
          chatId: event.notification.data?.chatId,
        });
        return;
      }
      await self.clients.openWindow(target);
    }),
  );
});
