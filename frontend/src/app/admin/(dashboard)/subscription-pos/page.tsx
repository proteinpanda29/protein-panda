'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { SubscriptionStatement, SubscriptionStatementData } from '@/components/SubscriptionStatement';
import { PlanEditor, HistoryEditor, EditingEntry } from '@/components/SubscriptionAdminTools';

interface Customer {
  id: string;
  name: string;
  user: { phone: string | null; email: string | null };
}

interface WalletPackage {
  id: string;
  name: string;
  priceRs: string;
  creditRs: string;
  packageFeeRs: string;
  validityDays: number;
}

interface Subscriber {
  customerId: string;
  customerName: string;
  phone: string | null;
  email: string | null;
  planName: string;
  totalPaidRs: number;
  startedAt: string;
  endsAt: string;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  spentRs: number;
  balanceRs: number;
  status: 'ACTIVE' | 'EXPIRED';
}

const CUSTOM = 'CUSTOM';

export default function SubscriptionCounterPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showWalkInForm, setShowWalkInForm] = useState(false);

  const [packages, setPackages] = useState<WalletPackage[]>([]);
  const [choice, setChoice] = useState('');
  const [planName, setPlanName] = useState('');
  const [priceRs, setPriceRs] = useState('');
  const [packageFeeRs, setPackageFeeRs] = useState('');
  const [creditRs, setCreditRs] = useState('');
  const [validityDays, setValidityDays] = useState('');
  const [startDate, setStartDate] = useState('');
  const [panel, setPanel] = useState<'none' | 'plan' | 'history'>('none');
  const [editingEntry, setEditingEntry] = useState<EditingEntry | null>(null);

  const [statement, setStatement] = useState<SubscriptionStatementData | null>(null);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSubscribers = () => {
    api.posWalletSubscribers().then(setSubscribers).catch(() => undefined);
  };

  useEffect(() => {
    api.posWalletPackages().then(setPackages).catch(() => undefined);
    loadSubscribers();
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.posSearchCustomers(query).then(setResults).catch(() => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!customer) {
      setStatement(null);
      return;
    }
    api.posCustomerSubscription(customer.id).then(setStatement).catch(() => setStatement(null));
  }, [customer]);

  // Picking a catalog plan fills the boxes below — every one of them
  // can still be edited before saving, which is what makes a plan
  // customizable. "Custom plan" simply starts from empty boxes.
  const choosePlan = (value: string) => {
    setChoice(value);
    setStartDate('');
    if (value === CUSTOM || value === '') {
      setPlanName('');
      setPriceRs('');
      setPackageFeeRs('0');
      setCreditRs('');
      setValidityDays('');
      return;
    }
    const pkg = packages.find((p) => p.id === value);
    if (!pkg) return;
    setPlanName(pkg.name);
    setPriceRs(String(pkg.priceRs));
    setPackageFeeRs(String(pkg.packageFeeRs));
    setCreditRs(String(pkg.creditRs));
    setValidityDays(String(pkg.validityDays));
  };

  const registerSubscription = async () => {
    if (!customer) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.posSubscribeCustomer(customer.id, {
        planName,
        priceRs: Number(priceRs),
        packageFeeRs: Number(packageFeeRs || 0),
        creditRs: Number(creditRs),
        validityDays: Number(validityDays),
        startDate: startDate || undefined,
      });
      setStatement(await api.posCustomerSubscription(customer.id));
      loadSubscribers();
      setSuccess('Subscription started. The balance has been credited.');
      choosePlan('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const refreshCustomer = async () => {
    if (customer) setStatement(await api.posCustomerSubscription(customer.id));
    loadSubscribers();
    setPanel('none');
    setEditingEntry(null);
  };

  const removeEntry = async (entryId: string) => {
    if (!confirm('Remove this shop entry? The amount goes back to the customer\'s balance.')) return;
    try {
      await api.posDeleteHistory(entryId);
      await refreshCustomer();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const openSubscriber = (s: Subscriber) => {
    setCustomer({ id: s.customerId, name: s.customerName, user: { phone: s.phone, email: s.email } });
    setSuccess(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const canSave = !!planName.trim() && Number(priceRs) > 0 && Number(creditRs) > 0 && Number(validityDays) >= 1;
  const totalToCollect = Number(priceRs || 0) + Number(packageFeeRs || 0);

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Subscription Counter</h1>
      <p className="mb-6 text-sm text-brand-body">
        Confirm a customer&apos;s package at the shop, collect the payment, and start their plan. Choose a standard plan or change any
        detail to make it custom. Everything they buy afterwards is taken from their balance and shows up below.
      </p>

      <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">1. Customer</h2>

          {!customer ? (
            <div className="rounded-2xl border border-brand-grey bg-brand-white p-4">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, phone, or email…"
                className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
              />
              {results.length > 0 && (
                <div className="mb-3 flex flex-col gap-2">
                  {results.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setCustomer(c)}
                      className="rounded-xl border border-brand-grey bg-brand-bg p-3 text-left hover:border-brand-primary"
                    >
                      <p className="font-semibold text-brand-black">{c.name}</p>
                      <p className="text-xs text-brand-body">{c.user.phone ?? c.user.email}</p>
                    </button>
                  ))}
                </div>
              )}
              <button onClick={() => setShowWalkInForm((v) => !v)} className="text-xs font-semibold text-brand-primary underline">
                {showWalkInForm ? 'Cancel' : '+ New customer (not registered yet)'}
              </button>
              {showWalkInForm && <WalkInForm onCreated={(c) => setCustomer(c)} />}
            </div>
          ) : (
            <div className="rounded-2xl border border-brand-primary bg-brand-bg p-4">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="font-bold text-brand-black">{customer.name}</p>
                  <p className="text-xs text-brand-body">{customer.user.phone ?? customer.user.email}</p>
                </div>
                <button onClick={() => setCustomer(null)} className="text-xs font-semibold text-brand-body underline">
                  Change
                </button>
              </div>

              <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">2. Plan</h2>
              <select
                value={choice}
                onChange={(e) => choosePlan(e.target.value)}
                className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
              >
                <option value="">Choose a plan…</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}: ₹{p.priceRs} + ₹{p.packageFeeRs} ({p.validityDays} days)
                  </option>
                ))}
                <option value={CUSTOM}>Custom plan (type your own)</option>
              </select>

              {choice !== '' && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <label className="col-span-2 text-xs font-bold uppercase text-brand-body">
                    Plan name
                    <input value={planName} onChange={(e) => setPlanName(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal normal-case text-brand-black" />
                  </label>
                  <label className="text-xs font-bold uppercase text-brand-body">
                    Price ₹
                    <input type="number" value={priceRs} onChange={(e) => { setPriceRs(e.target.value); if (choice === CUSTOM) setCreditRs(e.target.value); }} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black" />
                  </label>
                  <label className="text-xs font-bold uppercase text-brand-body">
                    Package + delivery ₹
                    <input type="number" value={packageFeeRs} onChange={(e) => setPackageFeeRs(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black" />
                  </label>
                  <label className="text-xs font-bold uppercase text-brand-body">
                    Food credit ₹
                    <input type="number" value={creditRs} onChange={(e) => setCreditRs(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black" />
                  </label>
                  <label className="text-xs font-bold uppercase text-brand-body">
                    Days
                    <input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black" />
                  </label>
                  <label className="col-span-2 text-xs font-bold uppercase text-brand-body">
                    Started on (leave empty if it starts today)
                    <input type="date" value={startDate} max={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm font-normal text-brand-black" />
                  </label>
                </div>
              )}

              {choice !== '' && (
                <p className="mb-3 rounded-lg bg-brand-white p-3 text-center text-lg font-extrabold text-brand-black">
                  Collect ₹{priceRs || 0} + ₹{packageFeeRs || 0} = ₹{totalToCollect}
                </p>
              )}

              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              {success && <p className="mb-2 text-xs font-semibold text-brand-primary">{success}</p>}

              <button
                onClick={registerSubscription}
                disabled={busy || !canSave}
                className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
              >
                {busy ? 'Starting…' : 'Payment Received: Start Plan'}
              </button>
              <p className="mt-2 text-[11px] text-brand-body">
                To bill this customer, open <a href="/admin/subscription-billing" className="font-bold text-brand-primary underline">Subscriber Billing</a>. The total is taken from their balance automatically and appears in their statement.
              </p>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">
            {customer ? `${customer.name}'s statement` : 'Statement'}
          </h2>
          {customer && statement ? (
            <div className="flex flex-col gap-4">
              {statement.hasSubscription && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => { setEditingEntry(null); setPanel(panel === 'history' ? 'none' : 'history'); }}
                    className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
                  >
                    + Add past purchase
                  </button>
                  <button
                    onClick={() => setPanel(panel === 'plan' ? 'none' : 'plan')}
                    className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
                  >
                    Edit plan details
                  </button>
                  <a href="/admin/subscription-billing" className="rounded-full border-2 border-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-primary hover:bg-brand-primary hover:text-brand-white">
                    Bill this customer
                  </a>
                </div>
              )}
              {panel === 'plan' && statement.hasSubscription && (
                <PlanEditor customerId={customer.id} statement={statement} onDone={refreshCustomer} onCancel={() => setPanel('none')} />
              )}
              {panel === 'history' && statement.hasSubscription && (
                <HistoryEditor
                  key={editingEntry?.entryId ?? 'new'}
                  customerId={customer.id}
                  statement={statement}
                  editing={editingEntry}
                  onDone={refreshCustomer}
                  onCancel={() => { setPanel('none'); setEditingEntry(null); }}
                />
              )}
              <SubscriptionStatement
                data={statement}
                admin={{
                  onEdit: (entry) => { setEditingEntry(entry); setPanel('history'); },
                  onDelete: removeEntry,
                }}
              />
            </div>
          ) : (
            <p className="text-sm text-brand-body">Select a customer, or click a subscriber below, to see their days, purchases and balance.</p>
          )}
        </div>
      </div>

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">All subscribers</h2>
      {subscribers.length === 0 ? (
        <p className="text-sm text-brand-body">No subscribers yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-grey">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-grey bg-brand-bg text-left text-xs uppercase text-brand-body">
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2">Days</th>
                <th className="px-3 py-2 text-right">Spent</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Ends</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {subscribers.map((s) => (
                <tr key={s.customerId} className="border-b border-brand-grey last:border-0">
                  <td className="px-3 py-2 text-brand-black">
                    {s.customerName}
                    <br />
                    <span className="text-xs text-brand-body">{s.phone ?? s.email ?? ''}</span>
                  </td>
                  <td className="px-3 py-2 text-brand-body">{s.planName}</td>
                  <td className="px-3 py-2 text-right">₹{s.totalPaidRs}</td>
                  <td className="px-3 py-2 text-brand-body">
                    {s.daysElapsed}/{s.daysTotal}
                    <span className="block text-xs">{s.daysRemaining} left</span>
                  </td>
                  <td className="px-3 py-2 text-right">₹{s.spentRs}</td>
                  <td className={`px-3 py-2 text-right font-bold ${s.balanceRs < 300 ? 'text-red-600' : 'text-brand-black'}`}>₹{s.balanceRs}</td>
                  <td className="px-3 py-2 text-brand-body">{new Date(s.endsAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                  <td className={`px-3 py-2 text-xs font-bold uppercase ${s.status === 'EXPIRED' ? 'text-red-600' : 'text-brand-primary'}`}>{s.status}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => openSubscriber(s)} className="text-xs font-bold text-brand-primary underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WalkInForm({ onCreated }: { onCreated: (c: Customer) => void }) {
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await api.posCreateWalkIn(name, identifier);
      onCreated({
        id: created.id,
        name: created.name,
        user: { phone: identifier.includes('@') ? null : identifier, email: identifier.includes('@') ? identifier : null },
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-brand-grey bg-brand-bg p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      <input
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        placeholder="Phone or email"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm text-brand-black"
      />
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Creating…' : 'Create & Select'}
      </button>
    </div>
  );
}
