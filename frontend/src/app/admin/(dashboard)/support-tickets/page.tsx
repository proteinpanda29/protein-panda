'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Message {
  id: string;
  isFromAdmin: boolean;
  body: string;
  createdAt: string;
  repliedByUser?: { staff: { name: string } | null } | null;
}

interface Ticket {
  id: string;
  subject: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  updatedAt: string;
  customer: { name: string };
  messages: Message[];
}

const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
const STATUS_STYLE: Record<string, string> = {
  OPEN: 'bg-yellow-100 text-yellow-800',
  IN_PROGRESS: 'bg-blue-100 text-blue-800',
  RESOLVED: 'bg-brand-primary/10 text-brand-primary',
  CLOSED: 'bg-brand-grey/50 text-brand-body',
};

export default function AdminSupportTicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);

  const load = () => {
    api.adminTickets(statusFilter || undefined).then(setTickets).catch((err) => setError(err.message));
  };

  useEffect(load, [statusFilter]);

  const openThread = async (id: string) => {
    const full = await api.adminGetTicket(id);
    setOpenTicket(full);
  };

  if (openTicket) {
    return (
      <AdminTicketThread
        ticket={openTicket}
        onBack={() => {
          setOpenTicket(null);
          load();
        }}
        onUpdated={setOpenTicket}
      />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Support Tickets</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-brand-grey bg-brand-white px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

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
            <p className="text-xs text-brand-body">{t.customer.name}</p>
            <p className="truncate text-xs text-brand-body">{t.messages[0]?.body}</p>
          </button>
        ))}
        {tickets.length === 0 && <p className="text-sm text-brand-body">No tickets here.</p>}
      </div>
    </div>
  );
}

function AdminTicketThread({
  ticket,
  onBack,
  onUpdated,
}: {
  ticket: Ticket;
  onBack: () => void;
  onUpdated: (t: Ticket) => void;
}) {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      await api.adminReplyToTicket(ticket.id, reply);
      const updated = await api.adminGetTicket(ticket.id);
      onUpdated(updated);
      setReply('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: string) => {
    await api.adminUpdateTicketStatus(ticket.id, status);
    const updated = await api.adminGetTicket(ticket.id);
    onUpdated(updated);
  };

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-xs font-semibold text-brand-body underline">
        ← Back to all tickets
      </button>
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-extrabold text-brand-black">{ticket.subject}</h1>
          <p className="text-xs text-brand-body">{ticket.customer.name}</p>
        </div>
        <select
          value={ticket.status}
          onChange={(e) => changeStatus(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-xs font-bold"
        >
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="mb-4 flex max-w-lg flex-col gap-2">
        {ticket.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-2xl p-3 text-sm ${
              m.isFromAdmin ? 'self-end bg-brand-primary text-brand-white' : 'self-start bg-brand-grey/30 text-brand-black'
            }`}
          >
            <p>{m.body}</p>
            <p className="mt-1 text-[10px] opacity-70">
              {m.isFromAdmin && m.repliedByUser?.staff?.name ? `${m.repliedByUser.staff.name} · ` : ''}
              {new Date(m.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex max-w-lg gap-2">
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
    </div>
  );
}
