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
      data: { url: data.url || '/', ...(data.data || {}) },
      // Only present on the specific "out for delivery" notification —
      // every other notification type simply omits this from its
      // payload, so `actions` is undefined and no buttons show, exactly
      // as before this feature existed.
      actions: data.actions || undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  const orderId = event.notification.data?.orderId;
  const action = event.action; // '' for a plain click on the notification body itself

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      // A real action button was tapped (not just the notification
      // body) — try to hand this off to an already-open tab, which has
      // the customer's login token and can make the real authenticated
      // API call itself (a service worker has no access to that token).
      if (action && orderId) {
        for (const client of clients) {
          if ('postMessage' in client) {
            client.postMessage({ type: 'DELIVERY_PREFERENCE', orderId, preference: action });
          }
        }
        if (clients.length > 0) {
          const client = clients.find((c) => c.url.includes(url) && 'focus' in c) || clients[0];
          if ('focus' in client) return client.focus();
          return;
        }
        // No tab open at all — open one with the preference encoded in
        // the URL; the app reads this on load and submits it once it
        // has access to the stored login token (see the orders page).
        if (self.clients.openWindow) {
          return self.clients.openWindow(`/orders?highlight=${orderId}&setDeliveryPref=${action}`);
        }
        return;
      }

      // A plain tap on the notification itself (no action button) —
      // the original, unchanged behavior: focus an already-open tab on
      // the right page rather than always opening a new one.
      for (const client of clients) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
