'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useOrderUpdates } from '@/lib/useOrderUpdates';

interface Notification {
  id: string;
  type: 'ORDER_UPDATE' | 'ACHIEVEMENT' | 'ANNOUNCEMENT';
  title: string;
  body: string;
  isRead: boolean;
  orderId: string | null;
  createdAt: string;
}

const TYPE_ICON: Record<string, string> = {
  ORDER_UPDATE: '🛵',
  ACHIEVEMENT: '🏆',
  ANNOUNCEMENT: '📣',
};

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.myNotifications().then(setNotifications).catch((err) => setError(err.message));
  };

  useEffect(load, []);
  // A new order-status push often means a fresh notification landed too —
  // refresh the list so it shows up without needing a manual reload.
  useOrderUpdates(load);

  const markRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    try {
      await api.markNotificationRead(id);
    } catch {
      load(); // revert to real state if the request failed
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      await api.markAllNotificationsRead();
    } catch {
      load();
    }
  };

  if (error) {
    return <p className="mx-auto max-w-md px-4 py-16 text-center text-sm text-brand-body">Couldn&apos;t load notifications. ({error})</p>;
  }

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Notifications</h1>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs font-semibold text-brand-primary underline">
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
          Nothing here yet — order updates, achievements, and shop announcements will show up here.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.isRead && markRead(n.id)}
              className={`rounded-2xl border p-4 text-left ${
                n.isRead ? 'border-brand-grey bg-brand-white' : 'border-brand-primary bg-brand-primary/5'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-xl">{TYPE_ICON[n.type] ?? '🐼'}</span>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold text-brand-black">{n.title}</p>
                    {!n.isRead && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-primary" />}
                  </div>
                  <p className="text-sm text-brand-body">{n.body}</p>
                  <p className="mt-1 text-xs text-brand-body/70">{new Date(n.createdAt).toLocaleString()}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
