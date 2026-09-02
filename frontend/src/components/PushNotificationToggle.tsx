'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

// Standard, well-known conversion — the Push API requires the VAPID
// public key as a raw Uint8Array, not the base64url string the server
// hands out (which is the more convenient format to store/transmit).
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function PushNotificationToggle() {
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return; // not supported on this browser — the toggle just doesn't render, no error shown
    }
    setSupported(true);

    navigator.serviceWorker.register('/sw.js').then(async (registration) => {
      const existing = await registration.pushManager.getSubscription();
      setSubscribed(!!existing);
    });
  }, []);

  const enable = async () => {
    setError(null);
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setError('Notifications were not allowed — you can enable them in your browser settings and try again.');
        return;
      }

      const { key } = await api.getVapidPublicKey();
      if (!key) {
        setError('Push notifications are not set up yet — check back later.');
        return;
      }

      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });

      await api.subscribePush(subscription.toJSON());
      setSubscribed(true);
    } catch (err: any) {
      setError(err.message ?? 'Could not enable notifications');
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
    } finally {
      setBusy(false);
    }
  };

  if (!supported) return null;

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">🔔 Push Notifications</h2>
      <p className="mb-3 text-sm text-brand-body">
        {subscribed
          ? 'You\u2019ll get a real notification on this device for order updates and more.'
          : 'Get notified on this device the moment your order status changes.'}
      </p>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={subscribed ? disable : enable}
        disabled={busy}
        className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-60 ${
          subscribed ? 'border-2 border-red-600 text-red-600 hover:bg-red-50' : 'bg-brand-primary text-brand-white hover:bg-brand-accent'
        }`}
      >
        {busy ? 'Working…' : subscribed ? 'Turn Off' : 'Enable on This Device'}
      </button>
    </div>
  );
}
