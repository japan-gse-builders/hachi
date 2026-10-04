// Shows Hachi alerts sent through Firebase Cloud Messaging. Every family alert leads to the dashboard.
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const n = payload.notification || {};
  const link = (payload.fcmOptions && payload.fcmOptions.link) || '/family';
  event.waitUntil(
    self.registration.showNotification(n.title || 'Hachi', {
      body: n.body || 'Please open Hachi.',
      icon: '/icon.svg',
      data: { link },
      requireInteraction: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/family';
  event.waitUntil(self.clients.openWindow(link));
});
