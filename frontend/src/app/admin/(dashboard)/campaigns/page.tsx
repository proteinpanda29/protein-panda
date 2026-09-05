'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const SEGMENTS = [
  { value: 'LAPSED_30_DAYS', label: 'No Order in 30 Days', icon: '💤' },
  { value: 'HIGH_SPENDERS', label: 'Top Spenders', icon: '💰' },
  { value: 'ACTIVE_MEMBERS', label: 'Active Members', icon: '🏋️' },
  { value: 'MEMBERSHIP_EXPIRING_SOON', label: 'Membership Expiring Soon', icon: '⏰' },
  { value: 'CLOSE_TO_MONTHLY_REWARD', label: 'Close to Monthly Reward', icon: '🏆' },
] as const;

interface CampaignRow {
  id: string;
  name: string;
  segmentType: string;
  title: string;
  body: string;
  recipientCount: number;
  sentAt: string;
  sentByUser: { staff: { name: string } | null } | null;
}

function segmentLabel(type: string): string {
  return SEGMENTS.find((s) => s.value === type)?.label ?? type;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () =>
    api
      .adminListCampaigns()
      .then(setCampaigns)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Campaigns</h1>
          <p className="text-sm text-brand-body">Send a real message to a live-computed customer segment.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ New Campaign'}
        </button>
      </div>

      {showForm && <NewCampaignForm onSent={() => { setShowForm(false); load(); }} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && campaigns.length === 0 && !error && <p className="text-sm text-brand-body">No campaigns sent yet.</p>}

      <div className="flex flex-col gap-2">
        {campaigns.map((c) => (
          <div key={c.id} className="rounded-xl border border-brand-grey bg-brand-white p-4">
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-bold text-brand-black">{c.name}</p>
              <span className="rounded-full bg-brand-bg px-2 py-1 text-[10px] font-bold uppercase text-brand-body">
                {segmentLabel(c.segmentType)}
              </span>
            </div>
            <p className="mb-1 text-sm text-brand-black">
              <strong>{c.title}</strong> — {c.body}
            </p>
            <p className="text-xs text-brand-body">
              Sent to {c.recipientCount} customer{c.recipientCount === 1 ? '' : 's'} by {c.sentByUser?.staff?.name ?? 'Unknown'} ·{' '}
              {new Date(c.sentAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewCampaignForm({ onSent }: { onSent: () => void }) {
  const [name, setName] = useState('');
  const [segmentType, setSegmentType] = useState<(typeof SEGMENTS)[number]['value']>('LAPSED_30_DAYS');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminGetSegment(segmentType).then((customers) => setPreviewCount(customers.length)).catch(() => setPreviewCount(null));
  }, [segmentType]);

  const submit = async () => {
    if (!name || !title || !body) {
      setError('Campaign name, title, and message are all required.');
      return;
    }
    if (!window.confirm(`Send "${title}" to ${previewCount ?? 'this'} customer(s) in "${segmentLabel(segmentType)}"?`)) return;
    setSending(true);
    setError(null);
    try {
      await api.adminSendCampaign({ name, segmentType, title, body });
      onSent();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Campaign name (internal)" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        <select
          value={segmentType}
          onChange={(e) => setSegmentType(e.target.value as any)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        >
          {SEGMENTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.icon} {s.label}
            </option>
          ))}
        </select>
      </div>
      {previewCount !== null && (
        <p className="mb-3 text-xs text-brand-body">
          {previewCount} customer{previewCount === 1 ? '' : 's'} currently in this segment.
        </p>
      )}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Notification title" className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm" />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Message"
        rows={3}
        className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <button
        onClick={submit}
        disabled={sending}
        className="rounded-full bg-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-black/80 disabled:opacity-60"
      >
        {sending ? 'Sending…' : 'Send Campaign'}
      </button>
    </div>
  );
}
