'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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

interface WalletOverview {
  balanceRs: number;
  activePackageName: string | null;
  expiresAt: string | null;
}

interface Subscription {
  customerId: string;
  customerName: string;
  packageName: string;
  balanceRs: string;
  expiresAt: string | null;
  isExpired: boolean;
}

export default function SubscriptionPosPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showWalkInForm, setShowWalkInForm] = useState(false);

  const [packages, setPackages] = useState<WalletPackage[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [customerWallet, setCustomerWallet] = useState<WalletOverview | null>(null);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const loadSubscriptions = () => {
    api.adminWalletSubscriptions().then(setSubscriptions).catch(() => undefined);
  };

  useEffect(() => {
    api.posWalletPackages().then(setPackages).catch(() => undefined);
    loadSubscriptions();
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
      setCustomerWallet(null);
      return;
    }
    api.posCustomerWallet(customer.id).then(setCustomerWallet).catch(() => setCustomerWallet(null));
  }, [customer]);

  const registerSubscription = async () => {
    if (!customer || !selectedPackageId) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await api.posSubscribeCustomer(customer.id, selectedPackageId);
      const overview = await api.posCustomerWallet(customer.id);
      setCustomerWallet(overview);
      loadSubscriptions();
      setSuccess('Subscription registered — wallet credited.');
      setSelectedPackageId('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Subscription Counter</h1>
      <p className="mb-6 text-sm text-brand-body">
        Register a weekly, 15-day, or monthly Panda Wallet subscription for a customer paying in cash or card at the counter — credited immediately, no online payment needed.
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Customer</h2>

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
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-bold text-brand-black">{customer.name}</p>
                  <p className="text-xs text-brand-body">{customer.user.phone ?? customer.user.email}</p>
                </div>
                <button onClick={() => setCustomer(null)} className="text-xs font-semibold text-brand-body underline">
                  Change
                </button>
              </div>

              {customerWallet && (
                <div className="mb-4 rounded-xl bg-brand-white p-3 text-sm">
                  <p className="text-xs font-bold uppercase text-brand-body">Current Wallet</p>
                  <p className="text-xl font-extrabold text-brand-black">₹{customerWallet.balanceRs.toFixed(0)}</p>
                  {customerWallet.activePackageName && (
                    <p className="text-xs text-brand-body">
                      {customerWallet.activePackageName}
                      {customerWallet.expiresAt ? ` · valid until ${new Date(customerWallet.expiresAt).toLocaleDateString('en-IN')}` : ''}
                    </p>
                  )}
                </div>
              )}

              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-brand-body">Select Plan</label>
              <select
                value={selectedPackageId}
                onChange={(e) => setSelectedPackageId(e.target.value)}
                className="mb-3 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
              >
                <option value="">Choose a plan…</option>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — ₹{p.priceRs} + ₹{p.packageFeeRs} delivery ({p.validityDays} days)
                  </option>
                ))}
              </select>

              {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
              {success && <p className="mb-2 text-xs text-brand-primary">{success}</p>}

              <button
                onClick={registerSubscription}
                disabled={busy || !selectedPackageId}
                className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-50"
              >
                {busy ? 'Registering…' : 'Register Subscription'}
              </button>
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Active Subscribers</h2>
          {subscriptions.length === 0 ? (
            <p className="text-sm text-brand-body">No active subscribers yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-brand-grey">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-grey bg-brand-bg text-left text-xs uppercase text-brand-body">
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2 text-right">Balance</th>
                    <th className="px-3 py-2">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s) => (
                    <tr key={s.customerId} className="border-b border-brand-grey last:border-0">
                      <td className="px-3 py-2 text-brand-black">{s.customerName}</td>
                      <td className="px-3 py-2 text-brand-body">{s.packageName}</td>
                      <td className="px-3 py-2 text-right font-semibold">₹{s.balanceRs}</td>
                      <td className={`px-3 py-2 ${s.isExpired ? 'text-red-600' : 'text-brand-body'}`}>
                        {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('en-IN') : '—'} {s.isExpired && '(expired)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
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
