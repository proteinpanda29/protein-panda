// Real push notification handling — this file runs in its own worker
// context, completely separate from the main app's JS, which is why it
// can't import anything from the rest of the codebase and has to stay
// self-contained.

self.addEventListener('push', (event) => {
  let data = { title: 'Protein Panda', body: 'You have a new update.' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // A malformed/non-JSON payload falls back to the generic message
    // above rather than failing to show anything at all.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an already-open tab on the right page rather than always
      // opening a new one — the expected, less jarring behavior.
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
