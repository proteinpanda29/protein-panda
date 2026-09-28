'use client';

import { useEffect, useRef, useState } from 'react';
import { useOrderUpdates } from '@/lib/useOrderUpdates';

const SOUND_URL = '/sounds/new-order.mp3';
const BANNER_SECONDS = 20;

interface OrderAlert {
  orderId: string;
  orderNumber: string;
}

/**
 * Shows a banner and plays the shop's alert sound whenever a brand-new
 * order arrives, on whichever admin page is open. Mounted once in the
 * admin layout and once on the standalone Kitchen page, so an order can
 * never arrive silently just because staff were on a different screen.
 *
 * Browsers refuse to play sound on a page nobody has clicked yet, so
 * the first click or key press anywhere quietly "unlocks" audio; until
 * then a small hint tells staff to tap the page once.
 */
export function NewOrderAlert() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<OrderAlert[]>([]);
  const [soundReady, setSoundReady] = useState(false);

  useEffect(() => {
    const audio = new Audio(SOUND_URL);
    audio.preload = 'auto';
    audioRef.current = audio;

    const unlock = () => {
      audio.muted = true;
      audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          setSoundReady(true);
          window.removeEventListener('pointerdown', unlock);
          window.removeEventListener('keydown', unlock);
        })
        .catch(() => {
          audio.muted = false;
        });
    };

    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useOrderUpdates((event) => {
    // An order only ever has status RECEIVED at the moment it is
    // created, so that is what identifies a genuinely new order (as
    // opposed to a status change on an existing one).
    if (event.status !== 'RECEIVED') return;
    if (seenRef.current.has(event.orderId)) return;
    seenRef.current.add(event.orderId);

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => undefined);
    }

    setAlerts((prev) => [...prev, { orderId: event.orderId, orderNumber: event.orderNumber }]);
    setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.orderId !== event.orderId));
    }, BANNER_SECONDS * 1000);
  });

  return (
    <div>
      <div className="pointer-events-none fixed right-4 top-4 z-[100] flex flex-col gap-2">
        {alerts.map((a) => (
          <div
            key={a.orderId}
            className="pointer-events-auto flex animate-pulse items-center gap-3 rounded-2xl border-2 border-white bg-brand-primary px-4 py-3 text-brand-white shadow-2xl"
          >
            <span className="text-2xl">🔔</span>
            <div>
              <p className="text-sm font-extrabold uppercase tracking-wide">New order #{a.orderNumber}</p>
              <a href="/admin/orders" className="text-xs font-semibold underline">
                Open orders
              </a>
            </div>
            <button
              onClick={() => setAlerts((prev) => prev.filter((x) => x.orderId !== a.orderId))}
              className="ml-2 rounded-full px-2 text-lg font-bold leading-none hover:bg-white/20"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {!soundReady && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[100] rounded-full bg-brand-black/80 px-3 py-1.5 text-[11px] font-semibold text-brand-white">
          🔇 Tap anywhere once to turn on order sound
        </div>
      )}
    </div>
  );
}
