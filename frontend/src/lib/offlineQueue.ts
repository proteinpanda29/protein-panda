const QUEUE_KEY = 'pp_pos_offline_queue';

export type QueuedSaleStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface QueuedSale {
  id: string; // also used as the order's idempotencyKey
  payload: {
    customerId: string;
    paymentMethod: 'CASH' | 'UPI' | 'CARD';
    items: { productId: string; quantity: number; addonIds?: string[] }[];
    couponCode?: string;
    redemptionId?: string;
  };
  customerLabel: string; // for display — name/phone, since we don't re-fetch it
  totalRs: number;
  createdAt: string;
  status: QueuedSaleStatus;
  errorMessage?: string;
}

function generateId(): string {
  // crypto.randomUUID is available in every modern browser; this is only
  // ever used as a client-generated idempotency key, not for anything
  // security-sensitive.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function getQueue(): QueuedSale[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedSale[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export function enqueueSale(payload: QueuedSale['payload'], customerLabel: string, totalRs: number): QueuedSale {
  const sale: QueuedSale = {
    id: generateId(),
    payload,
    customerLabel,
    totalRs,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
  saveQueue([...getQueue(), sale]);
  return sale;
}

function updateQueueItem(id: string, updates: Partial<QueuedSale>) {
  saveQueue(getQueue().map((s) => (s.id === id ? { ...s, ...updates } : s)));
}

export function clearSynced() {
  saveQueue(getQueue().filter((s) => s.status !== 'synced'));
}

/**
 * Replays every pending/failed sale against the real API, in the order
 * they were taken, attaching each one's client-generated id as the
 * order's idempotencyKey. Stops retrying on the first network-level
 * failure (connectivity likely dropped again mid-sync) so remaining
 * sales stay queued for the next attempt rather than firing a burst of
 * doomed requests — but a business-logic error (e.g. shop closed) marks
 * that one sale 'failed' and keeps going, since retrying it won't help.
 */
export async function syncQueue(
  createSale: (payload: QueuedSale['payload'] & { idempotencyKey: string }) => Promise<unknown>,
): Promise<{ synced: number; failed: number; stillPending: number }> {
  const queue = getQueue().filter((s) => s.status === 'pending' || s.status === 'failed');
  let synced = 0;
  let failed = 0;

  for (const sale of queue) {
    updateQueueItem(sale.id, { status: 'syncing' });
    try {
      await createSale({ ...sale.payload, idempotencyKey: sale.id });
      updateQueueItem(sale.id, { status: 'synced' });
      synced += 1;
    } catch (err: any) {
      const isNetworkError = err instanceof TypeError || err?.message === 'Failed to fetch';
      if (isNetworkError) {
        updateQueueItem(sale.id, { status: 'pending' });
        break; // connectivity dropped again — stop, preserve order for next sync
      }
      updateQueueItem(sale.id, { status: 'failed', errorMessage: err?.message ?? 'Sync failed' });
      failed += 1;
    }
  }

  const stillPending = getQueue().filter((s) => s.status === 'pending').length;
  return { synced, failed, stillPending };
}
