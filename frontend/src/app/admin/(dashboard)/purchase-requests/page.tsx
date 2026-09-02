'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface PurchaseRequestRow {
  id: string;
  requestedQty: string;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'FULFILLED';
  requestedByUserId: string;
  rejectionReason: string | null;
  createdAt: string;
  ingredient: { name: string; unit: string };
  requestedByUser: { staff: { name: string } | null } | null;
  approvedByUser: { staff: { name: string } | null } | null;
}

interface Ingredient {
  id: string;
  name: string;
  unit: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-brand-primary/20 text-brand-primary',
  REJECTED: 'bg-red-100 text-red-700',
  FULFILLED: 'bg-blue-100 text-blue-700',
};

export default function PurchaseRequestsPage() {
  const [requests, setRequests] = useState<PurchaseRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);

  const load = () =>
    api
      .adminListPurchaseRequests()
      .then(setRequests)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    setMyUserId(localStorage.getItem('pp_user_id'));
  }, []);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Purchase Requests</h1>
          <p className="text-sm text-brand-body">Request → Approval, before it becomes a real purchase.</p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ New Request'}
        </button>
      </div>

      {showForm && <NewRequestForm onCreated={() => { setShowForm(false); load(); }} />}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-brand-body">Loading…</p>}
      {!loading && requests.length === 0 && !error && <p className="text-sm text-brand-body">No purchase requests yet.</p>}

      <div className="flex flex-col gap-3">
        {requests.map((r) => (
          <RequestCard key={r.id} request={r} myUserId={myUserId} onDecided={load} />
        ))}
      </div>
    </div>
  );
}

function NewRequestForm({ onCreated }: { onCreated: () => void }) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminIngredients().then(setIngredients).catch(() => undefined);
  }, []);

  const submit = async () => {
    if (!ingredientId || !qty) {
      setError('Pick an ingredient and enter a quantity.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminCreatePurchaseRequest({ ingredientId, requestedQty: Number(qty), note: note || undefined });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selected = ingredients.find((i) => i.id === ingredientId);

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <select
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        >
          <option value="">Select ingredient…</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
          placeholder={selected ? `Quantity (${selected.unit})` : 'Quantity'}
          inputMode="decimal"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
        />
      </div>
      <button
        onClick={submit}
        disabled={saving}
        className="rounded-full bg-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-black/80 disabled:opacity-60"
      >
        {saving ? 'Submitting…' : 'Submit Request'}
      </button>
    </div>
  );
}

function RequestCard({
  request,
  myUserId,
  onDecided,
}: {
  request: PurchaseRequestRow;
  myUserId: string | null;
  onDecided: () => void;
}) {
  const [deciding, setDeciding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwnRequest = myUserId != null && request.requestedByUserId === myUserId;

  const decide = async (decision: 'APPROVED' | 'REJECTED') => {
    let rejectionReason: string | undefined;
    if (decision === 'REJECTED') {
      rejectionReason = window.prompt('Reason for rejecting this request?') ?? undefined;
      if (!rejectionReason) return;
    }
    setDeciding(true);
    setError(null);
    try {
      await api.adminDecidePurchaseRequest(request.id, decision, rejectionReason);
      onDecided();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDeciding(false);
    }
  };

  return (
    <div className="rounded-2xl border border-brand-grey bg-brand-white p-4">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-sm font-bold text-brand-black">
          {request.ingredient.name} — {request.requestedQty} {request.ingredient.unit}
        </p>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${STATUS_COLORS[request.status]}`}>{request.status}</span>
      </div>
      {request.note && <p className="mb-1 text-sm text-brand-body">{request.note}</p>}
      <p className="text-xs text-brand-body">
        Requested by {request.requestedByUser?.staff?.name ?? 'Unknown'} · {new Date(request.createdAt).toLocaleDateString()}
      </p>
      {request.status === 'REJECTED' && request.rejectionReason && (
        <p className="mt-1 text-xs text-red-600">Rejected: {request.rejectionReason}</p>
      )}
      {request.status !== 'PENDING' && request.approvedByUser && (
        <p className="mt-1 text-xs text-brand-body">Decided by {request.approvedByUser.staff?.name ?? 'Unknown'}</p>
      )}

      {request.status === 'PENDING' && (
        <div className="mt-3">
          {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
          {isOwnRequest ? (
            <p className="text-xs italic text-brand-body">You raised this request — a different approver is required.</p>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={() => decide('APPROVED')}
                disabled={deciding}
                className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
              >
                Approve
              </button>
              <button
                onClick={() => decide('REJECTED')}
                disabled={deciding}
                className="rounded-full border-2 border-red-300 px-4 py-2 text-xs font-bold uppercase text-red-600 hover:bg-red-50 disabled:opacity-60"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
