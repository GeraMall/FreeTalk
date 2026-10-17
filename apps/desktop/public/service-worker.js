self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('message', (event) => {
  if (
    event.data?.type === 'trlka-incoming-call-resolved' &&
    typeof event.data.invitationId === 'string'
  ) {
    event.waitUntil(
      self.registration
        .getNotifications({ tag: `trlka-call-${event.data.invitationId}` })
        .then((notifications) => notifications.forEach((notification) => notification.close())),
    );
    return;
  }
  if (event.data?.type !== 'trlka-muted-chats' || !Array.isArray(event.data.chatIds)) return;
  event.waitUntil(
    caches
      .open('trlka-preferences')
      .then((cache) =>
        cache.put(
          '/app/__muted_chats__',
          new Response(JSON.stringify(event.data.chatIds.filter((id) => typeof id === 'string'))),
        ),
      ),
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: 'Trlka', body: event.data?.text() ?? 'Новое сообщение' };
  }
  const title = payload.title || 'Trlka';
  event.waitUntil(
    caches.open('trlka-preferences').then(async (cache) => {
      const stored = await cache.match('/app/__muted_chats__');
      const mutedChatIds = stored ? await stored.json().catch(() => []) : [];
      if (payload.chatId && mutedChatIds.includes(payload.chatId)) return;
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.some((client) => client.visibilityState === 'visible')) return;
      return self.registration.showNotification(title, {
        body: payload.body || 'Новое сообщение',
        icon: payload.icon || '/app/icons/trlka-192.png',
        badge: payload.badge || '/app/icons/trlka-192.png',
        tag:
          payload.type === 'incoming-call'
            ? `trlka-call-${payload.invitationId || payload.roomId}`
            : payload.chatId
              ? `trlka-chat-${payload.chatId}`
              : 'trlka-message',
        renotify: true,
        requireInteraction: payload.type === 'incoming-call',
        vibrate: payload.type === 'incoming-call' ? [300, 180, 300, 180, 500] : [180],
        data: {
          url: payload.url || '/app/',
          chatId: payload.chatId || null,
          invitationId: payload.invitationId || null,
        },
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
