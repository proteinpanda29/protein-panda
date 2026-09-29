'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';
import { SubscriptionStatementData } from '@/components/SubscriptionStatement';

interface Subscriber {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  planName: string;
  daysTotal: number;
  daysElapsed: number;
  balanceRs: number;
  status: 'ACTIVE' | 'EXPIRED';
}

interface Addon {
  id: string;
  group: 'BASE' | 'FLAVOUR' | 'LIQUID' | 'ADDON';
  name: string;
  isRequired: boolean;
  extraPriceRs: string;
}

interface Product {
  id: string;
  name: string;
  basePriceRs: string;
  isCustomisable: boolean;
  addonOptions: Addon[];
  category?: { name: string };
}

interface CartLine {
  key: string;
  productId: string;
  name: string;
  quantity: number;
  unitPriceRs: number;
  addonIds: string[];
  addonNames: string[];
}

interface Receipt {
  customerName: string;
  planName: string;
  planLine: string;
  dayLine: string;
  orderNumber: string;
  items: { name: string; qty: number; amountRs: number }[];
  chargedRs: number;
  balanceRs: number;
}

const GROUP_LABELS: Record<string, string> = { BASE: 'Base', FLAVOUR: 'Flavour', LIQUID: 'Liquid' };

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function printReceipt(r: Receipt) {
  const rows = r.items.map((i, n) => `<div>${n + 1}. ${esc(i.name)}${i.qty > 1 ? ` x${i.qty}` : ''} - Rs ${i.amountRs}</div>`).join('');
  const html = `<div style="text-align:center;font-weight:bold;font-size:15px">${esc(siteConfig.businessName)}</div>
<div style="text-align:center">Subscriber Bill #${esc(r.orderNumber)}</div><hr/>
<div>${esc(r.customerName)}</div><div><b>${esc(r.planName)}</b></div><div>${esc(r.planLine)}</div><div>${esc(r.dayLine)}</div><hr/>${rows}<hr/>
<div>Today's total: <b>Rs ${r.chargedRs}</b></div>
<div style="font-size:15px">Available Balance: <b>Rs ${r.balanceRs}</b></div>`;
  const w = window.open('', '_blank', 'width=380,height=600');
  if (!w) return;
  w.document.write(`<html><head><title>Receipt</title><style>body{font-family:monospace;font-size:12px;width:280px;margin:8px}hr{border:0;border-top:1px dashed #000}</style></head><body>${html}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

function todayDdMmYyyy(): string {
  return new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export default function SubscriberBillingPage() {
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<Subscriber | null>(null);
  const [statement, setStatement] = useState<SubscriptionStatementData | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('');
  const [customizing, setCustomizing] = useState<Product | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  useEffect(() => {
    api.posWalletSubscribers().then(setSubscribers).catch(() => undefined);
    api.listProducts().then(setProducts).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selected) {
      setStatement(null);
      return;
    }
    api.posCustomerSubscription(selected.customerId).then(setStatement).catch(() => setStatement(null));
  }, [selected]);

  const pickSubscriber = (s: Subscriber) => {
    setSelected(s);
    setCart([]);
    setReceipt(null);
    setError(null);
  };

  const addSimple = (p: Product) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.key === p.id);
      if (existing) return prev.map((l) => (l.key === p.id ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { key: p.id, productId: p.id, name: p.name, quantity: 1, unitPriceRs: Number(p.basePriceRs), addonIds: [], addonNames: [] }];
    });
  };

  const updateQty = (key: string, qty: number) => {
    setCart((prev) => (qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l))));
  };

  const total = cart.reduce((sum, l) => sum + l.unitPriceRs * l.quantity, 0);
  const balance = statement?.balanceRs ?? selected?.balanceRs ?? 0;
  const isExpired = statement?.subscription?.status === 'EXPIRED';
  const shortBy = total - balance;
  const canBill = !!selected && cart.length > 0 && !busy && !isExpired && shortBy <= 0;

  const bill = async () => {
    if (!selected || !canBill) return;
    setBusy(true);
    setError(null);
    const items = cart.map((l) => ({ productId: l.productId, quantity: l.quantity, addonIds: l.addonIds }));
    const balanceBefore = balance;
    try {
      const order = await api.posCreateSale({ customerId: selected.customerId, paymentMethod: 'WALLET', fulfillmentType: 'DINE_IN', items });
      const fresh: SubscriptionStatementData = await api.posCustomerSubscription(selected.customerId);
      setStatement(fresh);
      const sub = fresh.subscription;
      setReceipt({
        customerName: selected.customerName,
        planName: sub?.planName ?? selected.planName,
        planLine: sub ? `Rs ${sub.priceRs} + Rs ${sub.packageFeeRs} = Rs ${sub.totalPaidRs}` : '',
        dayLine: `${todayDdMmYyyy()} - Day ${fresh.daysElapsed ?? ''} of ${fresh.daysTotal ?? ''}`,
        orderNumber: order.orderNumber,
        items: cart.map((l) => ({ name: l.name, qty: l.quantity, amountRs: l.unitPriceRs * l.quantity })),
        chargedRs: Math.round((balanceBefore - fresh.balanceRs) * 100) / 100,
        balanceRs: fresh.balanceRs,
      });
      setCart([]);
      api.posWalletSubscribers().then(setSubscribers).catch(() => undefined);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const activeSubs = subscribers.filter((s) => s.status === 'ACTIVE');
  const visibleSubs = activeSubs.filter((s) => {
    const q = filter.trim().toLowerCase();
    return !q || s.customerName.toLowerCase().includes(q) || (s.phone ?? '').includes(q) || (s.email ?? '').toLowerCase().includes(q);
  });

  const categoryNames = Array.from(new Set(products.map((p) => p.category?.name).filter((n): n is string => !!n))).sort();
  const visibleProducts = products.filter((p) => {
    const matchesCategory = !activeCategory || p.category?.name === activeCategory;
    const q = search.trim().toLowerCase();
    return matchesCategory && (!q || p.name.toLowerCase().includes(q));
  });

  return (
    <div>
      <h1 className="mb-1 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Subscriber Billing</h1>
      <p className="mb-6 text-sm text-brand-body">
        Pick a subscriber, tap the items, and bill. The total comes off their balance automatically and appears in their day-by-day statement.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">1. Subscriber</h2>

          {!selected ? (
            <div className="rounded-2xl border border-brand-grey bg-brand-white p-3">
              <input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search name, phone or email…"
                className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
              />
              <div className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                {visibleSubs.map((s) => (
                  <button key={s.customerId} onClick={() => pickSubscriber(s)} className="rounded-xl border border-brand-grey bg-brand-bg p-3 text-left hover:border-brand-primary">
                    <p className="font-semibold text-brand-black">{s.customerName}</p>
                    <p className="text-xs text-brand-body">
                      {s.planName} · Day {s.daysElapsed}/{s.daysTotal} · Balance ₹{s.balanceRs}
                    </p>
                  </button>
                ))}
                {visibleSubs.length === 0 && (
                  <p className="p-2 text-sm text-brand-body">
                    No active subscribers found. Start a plan first at <a href="/admin/subscription-pos" className="font-bold text-brand-primary underline">Subscription Counter</a>.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border-2 border-brand-primary bg-brand-white p-4">
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <p className="font-bold text-brand-black">{selected.customerName}</p>
                  <p className="text-xs text-brand-body">
                    {selected.planName} · Day {statement?.daysElapsed ?? selected.daysElapsed} of {statement?.daysTotal ?? selected.daysTotal}
                  </p>
                </div>
                <button onClick={() => { setSelected(null); setCart([]); setReceipt(null); }} className="text-xs font-semibold text-brand-body underline">
                  Change
                </button>
              </div>
              <div className={`rounded-xl p-4 text-center ${balance < 300 ? 'bg-yellow-100' : 'bg-brand-primary'}`}>
                <p className={`text-[11px] font-bold uppercase tracking-widest ${balance < 300 ? 'text-yellow-800' : 'text-brand-white/80'}`}>Available Balance</p>
                <p className={`text-4xl font-extrabold ${balance < 300 ? 'text-yellow-900' : 'text-brand-white'}`}>₹{balance}</p>
              </div>
              {isExpired && <p className="mt-2 text-xs font-semibold text-red-600">This plan has ended. Renew it at the Subscription Counter.</p>}
            </div>
          )}

          <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-brand-black">3. Bill</h2>
          <div className="rounded-2xl border border-brand-grey bg-brand-white p-4">
            {cart.length === 0 ? (
              <p className="text-sm text-brand-body">No items yet. Tap items on the right.</p>
            ) : (
              <div className="mb-3 flex flex-col gap-2">
                {cart.map((l) => (
                  <div key={l.key} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-semibold text-brand-black">{l.name}</p>
                      {l.addonNames.length > 0 && <p className="text-[11px] text-brand-body">{l.addonNames.join(', ')}</p>}
                      <p className="text-xs text-brand-body">₹{l.unitPriceRs} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => updateQty(l.key, l.quantity - 1)} className="rounded-full border border-brand-grey px-2">-</button>
                      <span>{l.quantity}</span>
                      <button onClick={() => updateQty(l.key, l.quantity + 1)} className="rounded-full border border-brand-grey px-2">+</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="mb-3 flex items-center justify-between rounded-xl bg-brand-black p-3 text-brand-white">
              <span className="text-xs uppercase tracking-wide text-brand-grey">Bill total</span>
              <span className="text-xl font-extrabold">₹{total}</span>
            </div>
            {selected && cart.length > 0 && (
              <p className={`mb-3 text-sm font-bold ${shortBy > 0 ? 'text-red-600' : 'text-brand-black'}`}>
                {shortBy > 0 ? `Not enough balance: ₹${shortBy} short` : `Balance after this bill: ₹${balance - total}`}
              </p>
            )}
            {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
            <button
              onClick={bill}
              disabled={!canBill}
              className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
            >
              {busy ? 'Billing…' : 'Bill from Wallet'}
            </button>
            <p className="mt-2 text-[11px] text-brand-body">Needs an internet connection. Wallet bills cannot be saved for later.</p>
          </div>

          {receipt && (
            <div className="mt-6 rounded-2xl border-2 border-brand-primary bg-brand-white p-4">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-brand-primary">Billed · #{receipt.orderNumber}</p>
              <p className="text-lg font-extrabold text-brand-black">{receipt.planName}</p>
              <p className="text-sm text-brand-black">{receipt.planLine}</p>
              <p className="mb-2 text-xs text-brand-body">{receipt.dayLine}</p>
              <ol className="mb-2 list-decimal pl-5 text-sm text-brand-black">
                {receipt.items.map((i, idx) => (
                  <li key={idx}>
                    {i.name}
                    {i.qty > 1 ? ` × ${i.qty}` : ''} (₹{i.amountRs})
                  </li>
                ))}
              </ol>
              <p className="text-sm font-bold text-brand-black">Charged: ₹{receipt.chargedRs}</p>
              <p className="mb-3 text-2xl font-extrabold text-brand-primary">Available Balance: ₹{receipt.balanceRs}</p>
              <button onClick={() => printReceipt(receipt)} className="w-full rounded-full border-2 border-brand-black py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary">
                🖨️ Print receipt
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-3">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">2. Items</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search the menu…"
            className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
          />
          {categoryNames.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2">
              <button onClick={() => setActiveCategory('')} className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${activeCategory === '' ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'}`}>
                All
              </button>
              {categoryNames.map((name) => (
                <button key={name} onClick={() => setActiveCategory(name)} className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${activeCategory === name ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'}`}>
                  {name}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {visibleProducts.map((p) => (
              <button
                key={p.id}
                onClick={() => (p.isCustomisable ? setCustomizing(p) : addSimple(p))}
                disabled={!selected}
                className="rounded-xl border border-brand-grey bg-brand-white p-3 text-left hover:border-brand-primary disabled:opacity-50"
              >
                <p className="text-sm font-semibold text-brand-black">{p.name}</p>
                <p className="text-xs text-brand-body">
                  ₹{p.basePriceRs}
                  {p.isCustomisable ? ' · Customise' : ''}
                </p>
              </button>
            ))}
          </div>
          {!selected && <p className="mt-3 text-xs text-brand-body">Pick a subscriber first to start adding items.</p>}
        </div>
      </div>

      {customizing && <CustomizeModal product={customizing} onClose={() => setCustomizing(null)} onAdd={(line) => { setCart((prev) => [...prev, line]); setCustomizing(null); }} />}
    </div>
  );
}

function CustomizeModal({ product, onClose, onAdd }: { product: Product; onClose: () => void; onAdd: (line: CartLine) => void }) {
  const grouped: Record<string, Addon[]> = { BASE: [], FLAVOUR: [], LIQUID: [], ADDON: [] };
  product.addonOptions.forEach((a) => grouped[a.group]?.push(a));

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    (['BASE', 'FLAVOUR', 'LIQUID'] as const).forEach((g) => {
      if (grouped[g][0]) initial[g] = grouped[g][0].id;
    });
    return initial;
  });
  const [addonIds, setAddonIds] = useState<Set<string>>(new Set());

  const chosen = [
    ...Object.values(selected).map((id) => product.addonOptions.find((a) => a.id === id)).filter((a): a is Addon => !!a),
    ...product.addonOptions.filter((a) => addonIds.has(a.id)),
  ];
  const unitPrice = Number(product.basePriceRs) + chosen.reduce((s, a) => s + Number(a.extraPriceRs), 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-brand-white p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-bold text-brand-black">{product.name}</h3>
          <button onClick={onClose}>✕</button>
        </div>

        {(['BASE', 'FLAVOUR', 'LIQUID'] as const).map(
          (g) =>
            grouped[g].length > 0 && (
              <div key={g} className="mb-3">
                <p className="mb-2 text-xs font-bold uppercase text-brand-body">{GROUP_LABELS[g]}</p>
                <div className="flex flex-wrap gap-2">
                  {grouped[g].map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelected((s) => ({ ...s, [g]: opt.id }))}
                      className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${selected[g] === opt.id ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'}`}
                    >
                      {opt.name}
                    </button>
                  ))}
                </div>
              </div>
            ),
        )}

        {grouped.ADDON.length > 0 && (
          <div className="mb-4">
            <p className="mb-2 text-xs font-bold uppercase text-brand-body">Add-ons</p>
            <div className="flex flex-wrap gap-2">
              {grouped.ADDON.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() =>
                    setAddonIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(opt.id)) next.delete(opt.id);
                      else next.add(opt.id);
                      return next;
                    })
                  }
                  className={`rounded-full border-2 px-3 py-1 text-xs font-semibold ${addonIds.has(opt.id) ? 'border-brand-accent bg-brand-accent text-brand-black' : 'border-brand-grey text-brand-black'}`}
                >
                  {opt.name} +₹{opt.extraPriceRs}
                </button>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() =>
            onAdd({
              key: `${product.id}-${Date.now()}`,
              productId: product.id,
              name: product.name,
              quantity: 1,
              unitPriceRs: unitPrice,
              addonIds: chosen.map((a) => a.id),
              addonNames: chosen.map((a) => a.name),
            })
          }
          className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase text-brand-white hover:bg-brand-accent"
        >
          Add to Bill · ₹{unitPrice}
        </button>
      </div>
    </div>
  );
}
