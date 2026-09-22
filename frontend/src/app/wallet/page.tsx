'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';

interface WalletTransaction {
  id: string;
  amountRs: string;
  type: string;
  note: string | null;
  createdAt: string;
}

interface WalletOverview {
  balanceRs: number;
  activePackageName: string | null;
  expiresAt: string | null;
  isLowBalance: boolean;
  lowBalanceThresholdRs: number;
  transactions: WalletTransaction[];
}

interface WalletPackage {
  id: string;
  name: string;
  priceRs: string;
  creditRs: string;
  validityDays: number;
}

export default function WalletPage() {
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [packages, setPackages] = useState<WalletPackage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [paymentLink, setPaymentLink] = useState<{ shortUrl: string } | null>(null);

  const load = () => {
    api.myWalletOverview().then(setOverview).catch((err) => setError(err.message));
    api.listWalletPackages().then(setPackages).catch(() => undefined);
  };
  useEffect(load, []);

  const buyPackage = async (packageId: string) => {
    setBuying(packageId);
    setError(null);
    try {
      const link = await api.purchaseWalletPackage(packageId);
      setPaymentLink(link);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBuying(null);
    }
  };

  const isExpired = overview?.expiresAt && new Date(overview.expiresAt) < new Date();

  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">🐼 Panda Wallet</h1>
      <p className="mb-8 text-sm text-brand-body">Top up once, order anything on the normal menu, and the bill comes straight out of your wallet.</p>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {overview?.isLowBalance && (
        <div className="mb-6 rounded-xl bg-yellow-50 p-4 text-sm text-yellow-800">
          ⚠️ Your wallet balance is under ₹{overview.lowBalanceThresholdRs} — top up below to keep ordering without interruption.
        </div>
      )}

      {overview && (
        <div className="mb-8 rounded-2xl border-2 border-brand-primary bg-brand-bg p-6">
          <p className="text-xs font-bold uppercase tracking-wide text-brand-body">Balance</p>
          <p className={`mb-3 text-4xl font-extrabold ${isExpired ? 'text-red-600' : 'text-brand-black'}`}>
            ₹{overview.balanceRs.toFixed(0)}
          </p>
          {overview.activePackageName && (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-brand-body">
              <span>Package: <span className="font-semibold text-brand-black">{overview.activePackageName}</span></span>
              {overview.expiresAt && (
                <span>
                  {isExpired ? 'Expired' : 'Valid until'}: <span className={`font-semibold ${isExpired ? 'text-red-600' : 'text-brand-black'}`}>
                    {new Date(overview.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </span>
              )}
            </div>
          )}
          {isExpired && (
            <p className="mt-2 text-xs text-red-600">Your package has expired — buy a new one below to keep using your Panda Wallet.</p>
          )}
        </div>
      )}

      <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">Top Up</h2>
      <div className="mb-10 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {packages.map((pkg) => (
          <div key={pkg.id} className="rounded-2xl border border-brand-grey bg-brand-white p-5">
            <p className="mb-1 text-lg font-bold text-brand-black">{pkg.name}</p>
            <p className="mb-3 text-xs text-brand-body">Valid for {pkg.validityDays} days · ~₹{Math.round(Number(pkg.creditRs) / pkg.validityDays)}/day</p>
            <div className="mb-4 flex items-baseline justify-between">
              <span className="text-2xl font-extrabold text-brand-black">₹{pkg.priceRs}</span>
              <span className="text-xs text-brand-body">₹{pkg.creditRs} wallet credit</span>
            </div>
            <button
              onClick={() => buyPackage(pkg.id)}
              disabled={buying === pkg.id}
              className="w-full rounded-full bg-brand-primary py-2.5 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
            >
              {buying === pkg.id ? 'Generating…' : 'Buy This Package'}
            </button>
          </div>
        ))}
        {packages.length === 0 && <p className="text-sm text-brand-body">No packages available right now.</p>}
      </div>

      <h2 className="mb-4 text-lg font-extrabold uppercase tracking-tight text-brand-black">Transaction History</h2>
      {overview && overview.transactions.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-brand-grey">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-grey bg-brand-bg text-left text-xs uppercase text-brand-body">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {overview.transactions.map((t) => (
                <tr key={t.id} className="border-b border-brand-grey last:border-0">
                  <td className="px-4 py-3 text-brand-body">{new Date(t.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                  <td className="px-4 py-3 text-brand-black">{t.note ?? t.type}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${Number(t.amountRs) >= 0 ? 'text-brand-primary' : 'text-brand-black'}`}>
                    {Number(t.amountRs) >= 0 ? '+' : ''}₹{Number(t.amountRs).toFixed(0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-brand-body">No transactions yet.</p>
      )}

      {paymentLink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setPaymentLink(null); load(); }}>
          <div className="w-full max-w-md rounded-2xl bg-brand-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-body">Scan to complete your top-up</p>
            <div className="mb-4 flex justify-center rounded-xl bg-brand-bg p-4">
              <QRCodeSVG value={paymentLink.shortUrl} size={200} />
            </div>
            <a href={paymentLink.shortUrl} target="_blank" rel="noreferrer" className="mb-4 block text-xs font-semibold text-brand-primary underline">
              Open payment link directly
            </a>
            <button
              onClick={() => { setPaymentLink(null); load(); }}
              className="w-full rounded-full bg-brand-primary py-3 text-sm font-bold uppercase text-brand-white hover:bg-brand-accent"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
