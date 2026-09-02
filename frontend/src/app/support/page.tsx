'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Message {
  id: string;
  isFromAdmin: boolean;
  body: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  updatedAt: string;
  messages: Message[];
}

const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  RESOLVED: 'bg-brand-primary/10 text-brand-primary',
  CLOSED: 'bg-brand-grey/50 text-brand-body',
};

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const load = () => {
    api.myTickets().then(setTickets).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const openThread = async (id: string) => {
    try {
      const full = await api.getTicket(id);
      setOpenTicket(full);
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (openTicket) {
    return (
      <TicketThread
        ticket={openTicket}
        onBack={() => {
          setOpenTicket(null);
          load();
        }}
        onReplySent={(updated) => setOpenTicket(updated)}
      />
    );
  }

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Support</h1>
        <button
          onClick={() => setShowNewForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          {showNewForm ? 'Cancel' : '+ New Ticket'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showNewForm && (
        <NewTicketForm
          onCreated={() => {
            setShowNewForm(false);
            load();
          }}
        />
      )}

      <div className="flex flex-col gap-2">
        {tickets.map((t) => (
          <button
            key={t.id}
            onClick={() => openThread(t.id)}
            className="rounded-2xl border border-brand-grey bg-brand-white p-4 text-left"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="font-bold text-brand-black">{t.subject}</p>
              <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[t.status]}`}>
                {t.status.replace('_', ' ')}
              </span>
            </div>
            <p className="truncate text-xs text-brand-body">{t.messages[0]?.body}</p>
            <p className="mt-1 text-xs text-brand-body/70">{new Date(t.updatedAt).toLocaleString()}</p>
          </button>
        ))}
        {tickets.length === 0 && !showNewForm && (
          <p className="rounded-2xl border border-brand-grey bg-brand-white p-6 text-center text-sm text-brand-body">
            No support tickets yet. Need help with an order or your account? Start one above.
          </p>
        )}
      </div>
    </section>
  );
}

function NewTicketForm({ onCreated }: { onCreated: () => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.createTicket(subject, body);
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="What's this about?"
        className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Tell us what happened…"
        rows={4}
        className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving || !subject.trim() || !body.trim()}
        className="w-full rounded-full bg-brand-primary py-3 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
      >
        {saving ? 'Sending…' : 'Submit Ticket'}
      </button>
    </div>
  );
}

function TicketThread({
  ticket,
  onBack,
  onReplySent,
}: {
  ticket: Ticket;
  onBack: () => void;
  onReplySent: (t: Ticket) => void;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await api.replyToTicket(ticket.id, reply);
      const updated = await api.getTicket(ticket.id);
      onReplySent(updated);
      setReply('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      <button onClick={onBack} className="mb-4 text-xs font-semibold text-brand-body underline">
        ← Back to all tickets
      </button>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-extrabold text-brand-black">{ticket.subject}</h1>
        <span className={`rounded-full px-2 py-1 text-xs font-bold ${STATUS_STYLE[ticket.status]}`}>
          {ticket.status.replace('_', ' ')}
        </span>
      </div>

      <div className="mb-4 flex flex-col gap-2">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl p-3 text-sm ${
              m.isFromAdmin ? 'self-start bg-brand-grey/30 text-brand-black' : 'self-end bg-brand-primary text-brand-white'
            }`}
          >
            <p>{m.body}</p>
            <p className="mt-1 text-[10px] opacity-70">{new Date(m.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <input
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Type a reply…"
          className="flex-1 rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <button
          onClick={send}
          disabled={sending || !reply.trim()}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50"
        >
          {sending ? '...' : 'Send'}
        </button>
      </div>
    </section>
  );
}
