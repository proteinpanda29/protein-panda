'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface AuditEntry {
  id: string;
  action: string;
  actorRole: 'ADMIN' | 'CUSTOMER' | 'DELIVERY';
  entityType: string;
  entityId: string | null;
  summary: string;
  createdAt: string;
  actor: { phone: string | null; email: string | null; staff: { name: string } | null };
}

const ENTITY_TYPES = ['Product', 'Customer', 'Order', 'Staff'];

function actorLabel(actor: AuditEntry['actor']): string {
  return actor.staff?.name ?? actor.phone ?? actor.email ?? 'Unknown';
}

export default function AdminAuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .adminAuditLog(entityType ? { entityType } : undefined)
      .then(setEntries)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [entityType]);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Audit Log</h1>
      <p className="mb-6 text-sm text-brand-body">A real record of who changed what, and when — price changes, blocks/unblocks, and more as they happen.</p>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setEntityType('')}
          className={`rounded-full border-2 px-4 py-2 text-xs font-bold uppercase ${
            entityType === '' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
          }`}
        >
          All
        </button>
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setEntityType(t)}
            className={`rounded-full border-2 px-4 py-2 text-xs font-bold uppercase ${
              entityType === t ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && entries.length === 0 && !error && (
        <p className="text-sm text-brand-body">No audit entries yet{entityType ? ` for ${entityType}` : ''}.</p>
      )}

      <div className="flex flex-col gap-2">
        {entries.map((e) => (
          <div key={e.id} className="rounded-xl border border-brand-grey bg-brand-white p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="rounded-full bg-brand-bg px-2 py-0.5 text-[10px] font-bold uppercase text-brand-body">{e.entityType}</span>
              <span className="text-xs text-brand-body">{new Date(e.createdAt).toLocaleString()}</span>
            </div>
            <p className="text-sm text-brand-black">{e.summary}</p>
            <p className="mt-1 text-xs text-brand-body">by {actorLabel(e.actor)} ({e.actorRole.toLowerCase()})</p>
          </div>
        ))}
      </div>
    </div>
  );
}
