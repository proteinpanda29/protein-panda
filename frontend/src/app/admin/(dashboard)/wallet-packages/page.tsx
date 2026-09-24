'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface WalletPackage {
  id: string;
  name: string;
  priceRs: string;
  creditRs: string;
  packageFeeRs: string;
  validityDays: number;
  isActive: boolean;
}

interface Subscription {
  customerId: string;
  customerName: string;
  packageName: string;
  balanceRs: string;
  expiresAt: string | null;
  isExpired: boolean;
}

interface DailyBillingRow {
  id: string;
  customer: { name: string };
  billDate: string;
  orderCount: number;
  todaysTotalRs: string;
  openingBalanceRs: string;
  closingBalanceRs: string;
  emailSent: boolean;
}

interface Alert {
  customerId: string;
  customerName: string;
  packageName: string;
  balanceRs: string;
  expiresAt: string | null;
  alertType: 'LOW_BALANCE' | 'EXPIRING_SOON' | 'EXPIRED';
}

const TABS = ['Packages', 'Subscriptions', 'Daily Billing', 'Alerts'] as const;
type Tab = (typeof TABS)[number];

export default function AdminWalletPackagesPage() {
  const [tab, setTab] = useState<Tab>('Packages');

  return (
    <div>
      <h1 className="mb-4 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Panda Wallet</h1>

      <div className="mb-6 flex gap-2 border-b border-brand-grey">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-4 py-2 text-sm font-bold uppercase tracking-wide ${
              tab === t ? 'border-brand-primary text-brand-primary' : 'border-transparent text-brand-body'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Packages' && <PackagesTab />}
      {tab === 'Subscriptions' && <SubscriptionsTab />}
      {tab === 'Daily Billing' && <DailyBillingTab />}
      {tab === 'Alerts' && <AlertsTab />}
    </div>
  );
}

function PackagesTab() {
  const [packages, setPackages] = useState<WalletPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => {
    api.adminWalletPackages().then(setPackages).catch((err) => setError(err.message));
  };
  useEffect(load, []);

  const toggleActive = async (pkg: WalletPackage) => {
    try {
      await api.adminUpdateWalletPackage(pkg.id, { isActive: !pkg.isActive });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const deletePackage = async (pkg: WalletPackage) => {
    if (!confirm(`Delete "${pkg.name}"?`)) return;
    try {
      await api.adminDeleteWalletPackage(pkg.id);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Add Package'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <PackageForm
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="flex flex-col gap-3">
        {packages.map((pkg) => (
          <div key={pkg.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="font-bold text-brand-black">
                {pkg.name} {!pkg.isActive && <span className="text-xs font-normal text-brand-body">(disabled)</span>}
              </p>
              <p className="text-xs text-brand-body">
                ₹{pkg.priceRs} → ₹{pkg.creditRs} wallet credit + ₹{pkg.packageFeeRs} package/delivery fee · valid {pkg.validityDays} days
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => toggleActive(pkg)}
                className={`rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                  pkg.isActive ? 'bg-brand-grey/50 text-brand-black' : 'bg-brand-primary text-brand-white'
                }`}
              >
                {pkg.isActive ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => deletePackage(pkg)}
                className="rounded-full border-2 border-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide text-red-600 hover:bg-red-600 hover:text-white"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {packages.length === 0 && !showForm && <p className="text-sm text-brand-body">No packages yet — click "+ Add Package" to create one.</p>}
      </div>
    </div>
  );
}

function PackageForm({ onSaved }: { onSaved: () => void }) {
  const [name, setName] = useState('');
  const [priceRs, setPriceRs] = useState('');
  const [creditRs, setCreditRs] = useState('');
  const [packageFeeRs, setPackageFeeRs] = useState('0');
  const [validityDays, setValidityDays] = useState('7');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !priceRs || !creditRs || !validityDays) {
      setError('All fields are required');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateWalletPackage({
        name: name.trim(),
        priceRs: Number(priceRs),
        creditRs: Number(creditRs),
        packageFeeRs: Number(packageFeeRs) || 0,
        validityDays: Number(validityDays),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">New Package</h2>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name (e.g. Monthly ₹9,000)"
        className="mb-2 w-full rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <div className="mb-3 grid grid-cols-2 gap-2">
        <input
          type="number"
          value={priceRs}
          onChange={(e) => setPriceRs(e.target.value)}
          placeholder="Price ₹"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={creditRs}
          onChange={(e) => setCreditRs(e.target.value)}
          placeholder="Wallet credit ₹"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={packageFeeRs}
          onChange={(e) => setPackageFeeRs(e.target.value)}
          placeholder="Package/delivery fee ₹ (subscriber's discounted rate)"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
        <input
          type="number"
          value={validityDays}
          onChange={(e) => setValidityDays(e.target.value)}
          placeholder="Validity (days)"
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
        />
      </div>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <button
        onClick={submit}
        disabled={saving}
        className="w-full rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save Package'}
      </button>
    </div>
  );
}

function SubscriptionsTab() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminWalletSubscriptions().then(setSubs).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {subs.length === 0 ? (
        <p className="text-sm text-brand-body">No active subscribers yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-grey">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-grey bg-brand-bg text-left text-xs uppercase text-brand-body">
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Expires</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.customerId} className="border-b border-brand-grey last:border-0">
                  <td className="px-4 py-3 text-brand-black">{s.customerName}</td>
                  <td className="px-4 py-3 text-brand-body">{s.packageName}</td>
                  <td className="px-4 py-3 text-right font-semibold text-brand-black">₹{s.balanceRs}</td>
                  <td className={`px-4 py-3 ${s.isExpired ? 'text-red-600' : 'text-brand-body'}`}>
                    {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString('en-IN') : '—'} {s.isExpired && '(expired)'}
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

function DailyBillingTab() {
  const [rows, setRows] = useState<DailyBillingRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminWalletDailyBilling(30).then(setRows).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-brand-body">No billing records yet — these appear once the nightly job has run.</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-brand-grey">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-grey bg-brand-bg text-left text-xs uppercase text-brand-body">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3 text-right">Orders</th>
                <th className="px-4 py-3 text-right">Today's Total</th>
                <th className="px-4 py-3 text-right">Opening</th>
                <th className="px-4 py-3 text-right">Closing</th>
                <th className="px-4 py-3">Email</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-brand-grey last:border-0">
                  <td className="px-4 py-3 text-brand-body">{new Date(r.billDate).toLocaleDateString('en-IN')}</td>
                  <td className="px-4 py-3 text-brand-black">{r.customer.name}</td>
                  <td className="px-4 py-3 text-right">{r.orderCount}</td>
                  <td className="px-4 py-3 text-right font-semibold">₹{r.todaysTotalRs}</td>
                  <td className="px-4 py-3 text-right text-brand-body">₹{r.openingBalanceRs}</td>
                  <td className="px-4 py-3 text-right text-brand-body">₹{r.closingBalanceRs}</td>
                  <td className="px-4 py-3">{r.emailSent ? '✅' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const ALERT_LABELS: Record<Alert['alertType'], { label: string; color: string }> = {
  LOW_BALANCE: { label: 'Low Balance', color: 'bg-yellow-50 text-yellow-800' },
  EXPIRING_SOON: { label: 'Expiring Soon', color: 'bg-orange-50 text-orange-800' },
  EXPIRED: { label: 'Expired', color: 'bg-red-50 text-red-700' },
};

function AlertsTab() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminWalletAlerts().then(setAlerts).catch((err) => setError(err.message));
  }, []);

  return (
    <div>
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {alerts.length === 0 ? (
        <p className="text-sm text-brand-body">No alerts right now.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {alerts.map((a) => (
            <div key={a.customerId} className={`flex items-center justify-between rounded-xl p-4 ${ALERT_LABELS[a.alertType].color}`}>
              <div>
                <p className="font-bold">{a.customerName}</p>
                <p className="text-xs">{a.packageName} · ₹{a.balanceRs} balance{a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleDateString('en-IN')}` : ''}</p>
              </div>
              <span className="rounded-full bg-white/60 px-3 py-1 text-xs font-bold uppercase">{ALERT_LABELS[a.alertType].label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
