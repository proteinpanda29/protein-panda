'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Announcement {
  id: string;
  title: string;
  body: string;
  recipientCount: number;
  createdAt: string;
  sentByUser: { staff: { name: string } | null } | null;
}

export default function AdminAnnouncementsPage() {
  const [history, setHistory] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    api.adminAnnouncementHistory().then(setHistory).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const send = async () => {
    if (!confirm('Send this announcement to every active customer? This cannot be undone.')) return;
    setSending(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.adminBroadcastAnnouncement(title, body);
      setMessage(`Sent to ${result.recipientCount} customer${result.recipientCount === 1 ? '' : 's'}.`);
      setTitle('');
      setBody('');
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Announcements</h1>
      <p className="mb-6 text-sm text-brand-body">
        Sends an in-app notification to every customer with an active account — e.g. &quot;closed tomorrow for maintenance.&quot;
      </p>

      <div className="mb-8 rounded-2xl border border-brand-grey bg-brand-white p-5">
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        {message && <p className="mb-3 text-sm text-brand-primary">{message}</p>}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (e.g. Closed Tomorrow)"
          className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message"
          rows={3}
          className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={sending || !title.trim() || !body.trim()}
          className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
        >
          {sending ? 'Sending…' : 'Send to All Customers'}
        </button>
      </div>

      <h2 className="mb-3 text-lg font-extrabold uppercase tracking-tight text-brand-black">History</h2>
      <div className="flex flex-col gap-3">
        {history.map((a) => (
          <div key={a.id} className="rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="font-bold text-brand-black">{a.title}</p>
              <span className="text-xs font-semibold text-brand-body">{a.recipientCount} recipients</span>
            </div>
            <p className="mb-1 text-sm text-brand-body">{a.body}</p>
            <p className="text-xs text-brand-body/70">
              {new Date(a.createdAt).toLocaleString()} {a.sentByUser?.staff?.name && `· by ${a.sentByUser.staff.name}`}
            </p>
          </div>
        ))}
        {history.length === 0 && <p className="text-sm text-brand-body">No announcements sent yet.</p>}
      </div>
    </div>
  );
}
