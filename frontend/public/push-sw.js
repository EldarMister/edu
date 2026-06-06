self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || 'EDU POS';
  const options = {
    body: payload.body || 'Новое уведомление',
    icon: '/icon.png',
    badge: '/icon.png',
    tag: payload.orderId || payload.orderNumber || 'edu-pos-notification',
    renotify: true,
    requireInteraction: payload.type === 'error',
    data: {
      url: payload.url || '/waiter',
      orderId: payload.orderId,
      orderNumber: payload.orderNumber,
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/waiter', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
