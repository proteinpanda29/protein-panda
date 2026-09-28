'use client';

export interface StatementOrder {
  orderNumber: string;
  time: string;
  amountRs: number;
  items: { name: string; quantity: number; amountRs: number }[];
  /** True for a purchase the shop typed in by hand rather than a real order. */
  manual?: boolean;
  entryId?: string;
  note?: string | null;
}

/** Passed only on the admin screen: lets staff fix or remove a shop-entered purchase. */
export interface StatementAdminActions {
  onEdit: (entry: { entryId: string; date: string; items: { name: string; quantity: number; amountRs: number }[]; note: string }) => void;
  onDelete: (entryId: string) => void;
}

export interface StatementDay {
  date: string;
  dayNumber: number;
  weekday: string;
  totalRs: number;
  orders: StatementOrder[];
}

export interface SubscriptionStatementData {
  hasSubscription: boolean;
  balanceRs: number;
  subscription?: {
    planName: string;
    priceRs: number;
    packageFeeRs: number;
    totalPaidRs: number;
    creditRs: number;
    validityDays: number;
    startedAt: string;
    endsAt: string;
    source: string;
    status: 'ACTIVE' | 'EXPIRED';
  };
  daysTotal?: number;
  daysElapsed?: number;
  daysRemaining?: number;
  daysWithOrders?: number;
  spentRs?: number;
  chart?: { dayNumber: number; date: string; spentRs: number; isFuture: boolean }[];
  dayLog?: StatementDay[];
}

/** "2026-08-28" -> "28/08/2026" */
function fmtKey(key: string): string {
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

function inr(n: number): string {
  return `₹${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

/**
 * The customer's subscription statement — shown to the customer on
 * their own page and to staff on the admin screen, so both always see
 * exactly the same numbers: what was paid, which day of the plan it is,
 * what was bought each day, and what balance is left.
 */
export function SubscriptionStatement({ data, admin }: { data: SubscriptionStatementData; admin?: StatementAdminActions }) {
  if (!data.hasSubscription || !data.subscription) {
    return (
      <div className="rounded-2xl border border-brand-grey bg-brand-white p-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-body">Available Balance</p>
        <p className="text-4xl font-extrabold text-brand-black">{inr(data.balanceRs)}</p>
        <p className="mt-2 text-sm text-brand-body">No subscription plan has been started yet.</p>
      </div>
    );
  }

  const sub = data.subscription;
  const daysTotal = data.daysTotal ?? sub.validityDays;
  const daysElapsed = data.daysElapsed ?? 0;
  const spentRs = data.spentRs ?? 0;
  const chart = data.chart ?? [];
  const dayLog = data.dayLog ?? [];
  const maxSpend = Math.max(1, ...chart.map((c) => c.spentRs));
  const progressPct = Math.min(100, Math.round((daysElapsed / daysTotal) * 100));
  const isExpired = sub.status === 'EXPIRED';
  const lowBalance = data.balanceRs < 300;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-2xl border-2 border-brand-primary bg-brand-white p-5">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-extrabold uppercase tracking-tight text-brand-black">{sub.planName}</h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              isExpired ? 'bg-red-100 text-red-700' : 'bg-brand-primary text-brand-white'
            }`}
          >
            {isExpired ? 'Expired' : 'Active'}
          </span>
        </div>
        <p className="text-lg font-bold text-brand-black">
          ₹{sub.priceRs} + ₹{sub.packageFeeRs} = ₹{sub.totalPaidRs}
        </p>
        <p className="text-xs text-brand-body">
          {fmtDate(sub.startedAt)} to {fmtDate(sub.endsAt)} · {sub.source === 'COUNTER' ? 'Confirmed at the shop' : 'Bought online'}
        </p>
      </div>

      <div className={`rounded-2xl p-6 text-center ${lowBalance ? 'bg-yellow-100' : 'bg-brand-primary'}`}>
        <p className={`text-xs font-bold uppercase tracking-widest ${lowBalance ? 'text-yellow-800' : 'text-brand-white/80'}`}>
          Available Balance
        </p>
        <p className={`text-5xl font-extrabold ${lowBalance ? 'text-yellow-900' : 'text-brand-white'}`}>{inr(data.balanceRs)}</p>
        {lowBalance && <p className="mt-1 text-xs font-semibold text-yellow-800">Running low: please top up soon</p>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-brand-grey bg-brand-white p-3 text-center">
          <p className="text-[10px] font-bold uppercase text-brand-body">Days Completed</p>
          <p className="text-xl font-extrabold text-brand-black">
            {daysElapsed} / {daysTotal}
          </p>
        </div>
        <div className="rounded-xl border border-brand-grey bg-brand-white p-3 text-center">
          <p className="text-[10px] font-bold uppercase text-brand-body">Days Left</p>
          <p className="text-xl font-extrabold text-brand-black">{data.daysRemaining ?? 0}</p>
        </div>
        <div className="rounded-xl border border-brand-grey bg-brand-white p-3 text-center">
          <p className="text-[10px] font-bold uppercase text-brand-body">Wallet Credit</p>
          <p className="text-xl font-extrabold text-brand-black">{inr(sub.creditRs)}</p>
        </div>
        <div className="rounded-xl border border-brand-grey bg-brand-white p-3 text-center">
          <p className="text-[10px] font-bold uppercase text-brand-body">Spent So Far</p>
          <p className="text-xl font-extrabold text-brand-black">{inr(spentRs)}</p>
        </div>
      </div>

      <div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-brand-grey/50">
          <div className="h-full rounded-full bg-brand-primary" style={{ width: `${progressPct}%` }} />
        </div>
        <p className="mt-1 text-xs text-brand-body">
          Day {daysElapsed} of {daysTotal} · you ordered on {data.daysWithOrders ?? 0} of those days
        </p>
      </div>

      <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Spending by day</h3>
        <div className="flex h-40 items-end gap-1">
          {chart.map((c) => (
            <div key={c.dayNumber} className="flex h-full flex-1 flex-col items-center justify-end" title={`Day ${c.dayNumber} · ${fmtKey(c.date)} · ${inr(c.spentRs)}`}>
              {c.spentRs > 0 && <span className="mb-0.5 text-[9px] font-bold text-brand-black">{Math.round(c.spentRs)}</span>}
              <div
                className={`w-full rounded-t ${c.spentRs > 0 ? 'bg-brand-primary' : c.isFuture ? 'bg-brand-grey/30' : 'bg-brand-grey'}`}
                style={{ height: c.spentRs > 0 ? `${Math.max(6, (c.spentRs / maxSpend) * 100)}%` : '4px' }}
              />
              <span className="mt-1 text-[9px] text-brand-body">{c.dayNumber}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-brand-body">Numbers under the bars are plan days. Days with no order show no bar and are not charged.</p>
      </div>

      <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Day-wise purchases</h3>
        {dayLog.length === 0 ? (
          <p className="text-sm text-brand-body">No purchases yet on this plan.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {dayLog.map((d) => (
              <div key={d.date} className="border-b border-brand-grey pb-3 last:border-0">
                <p className="font-bold text-brand-black">
                  {fmtKey(d.date)} <span className="font-normal text-brand-body">· {d.weekday} · Day {d.dayNumber}</span>
                </p>
                <ol className="mt-1 list-decimal pl-5 text-sm text-brand-black">
                  {d.orders.flatMap((o) =>
                    o.items.map((i, idx) => (
                      <li key={`${o.entryId ?? o.orderNumber}-${idx}`}>
                        {i.quantity > 1 ? `${i.quantity} × ` : ''}
                        {i.name} <span className="text-brand-body">({inr(i.amountRs)})</span>
                        {o.manual && <span className="ml-1 text-[10px] font-semibold uppercase text-brand-body">added by shop</span>}
                      </li>
                    )),
                  )}
                </ol>
                {admin &&
                  d.orders
                    .filter((o) => o.manual && o.entryId)
                    .map((o) => (
                      <p key={o.entryId} className="mt-1 text-xs text-brand-body">
                        Shop entry {inr(o.amountRs)}
                        {o.note ? ` · ${o.note}` : ''} ·{' '}
                        <button
                          onClick={() => admin.onEdit({ entryId: o.entryId as string, date: d.date, items: o.items, note: o.note ?? '' })}
                          className="font-bold text-brand-primary underline"
                        >
                          Edit
                        </button>{' '}
                        ·{' '}
                        <button onClick={() => admin.onDelete(o.entryId as string)} className="font-bold text-red-600 underline">
                          Remove
                        </button>
                      </p>
                    ))}
                <p className="mt-1 text-sm font-bold text-brand-black">Day total: {inr(d.totalRs)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Order history details</h3>
        {dayLog.length === 0 ? (
          <p className="text-sm text-brand-body">Nothing to show yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-grey text-left text-xs uppercase text-brand-body">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Day</th>
                  <th className="px-2 py-2">Order</th>
                  <th className="px-2 py-2">Items bought</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {dayLog.flatMap((d) =>
                  d.orders.map((o) => (
                    <tr key={o.entryId ?? o.orderNumber} className="border-b border-brand-grey last:border-0">
                      <td className="px-2 py-2 text-brand-body">
                        {fmtKey(d.date)}
                        {o.time && <br />}
                        <span className="text-xs">{o.time}</span>
                      </td>
                      <td className="px-2 py-2 text-brand-body">
                        {d.dayNumber}/{daysTotal}
                      </td>
                      <td className="px-2 py-2 text-brand-black">{o.manual ? 'Added by shop' : `#${o.orderNumber}`}</td>
                      <td className="px-2 py-2 text-brand-black">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td>
                      <td className="px-2 py-2 text-right font-semibold text-brand-black">{inr(o.amountRs)}</td>
                    </tr>
                  )),
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-right text-xs font-bold uppercase text-brand-body">
                    Total spent
                  </td>
                  <td className="px-2 py-2 text-right font-extrabold text-brand-black">{inr(spentRs)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-2 py-1 text-right text-xs font-bold uppercase text-brand-body">
                    Available balance
                  </td>
                  <td className="px-2 py-1 text-right font-extrabold text-brand-primary">{inr(data.balanceRs)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
