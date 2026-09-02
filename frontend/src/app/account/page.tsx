'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { logout } from '@/lib/session';
import { PushNotificationToggle } from '@/components/PushNotificationToggle';

interface Dashboard {
  name: string;
  goal: string | null;
  dietaryPreference: string | null;
  dailyProteinGoalG: string | null;
  dailyCalorieGoal: number | null;
  gymName: string | null;
  address: string | null;
  referralCode: string | null;
  walletBalanceRs: number;
  marketingOptIn: boolean;
  orderUpdatesOptIn: boolean;
}

export default function AccountPage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [dietaryPreference, setDietaryPreference] = useState('');
  const [dailyProteinGoalG, setDailyProteinGoalG] = useState('');
  const [dailyCalorieGoal, setDailyCalorieGoal] = useState('');
  const [gymName, setGymName] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [orderUpdatesOptIn, setOrderUpdatesOptIn] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);

  const [newIdentifier, setNewIdentifier] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [contactBusy, setContactBusy] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api
      .getDashboard()
      .then((d) => {
        setDashboard(d);
        setName(d.name ?? '');
        setGoal(d.goal ?? '');
        setDietaryPreference(d.dietaryPreference ?? '');
        setDailyProteinGoalG(d.dailyProteinGoalG ?? '');
        setDailyCalorieGoal(d.dailyCalorieGoal ? String(d.dailyCalorieGoal) : '');
        setGymName(d.gymName ?? '');
        setMarketingOptIn(d.marketingOptIn ?? false);
        setOrderUpdatesOptIn(d.orderUpdatesOptIn ?? true);
      })
      .catch((err) => setError(err.message));
  }, []);

  const saveProfile = async () => {
    setSavingProfile(true);
    setError(null);
    setMessage(null);
    try {
      await api.updateMyProfile({
        name,
        goal: goal || undefined,
        dietaryPreference: dietaryPreference || undefined,
        dailyProteinGoalG: dailyProteinGoalG ? Number(dailyProteinGoalG) : undefined,
        dailyCalorieGoal: dailyCalorieGoal ? Number(dailyCalorieGoal) : undefined,
        gymName: gymName || undefined,
        marketingOptIn,
        orderUpdatesOptIn,
      });
      setMessage('Saved.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingProfile(false);
    }
  };

  const requestContactChange = async () => {
    setContactBusy(true);
    setError(null);
    try {
      await api.requestContactChange(newIdentifier);
      setOtpSent(true);
      setMessage('OTP sent — check your new phone/email.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setContactBusy(false);
    }
  };

  const confirmContactChange = async () => {
    setContactBusy(true);
    setError(null);
    try {
      await api.confirmContactChange(newIdentifier, otpCode);
      setMessage('Contact details updated.');
      setOtpSent(false);
      setNewIdentifier('');
      setOtpCode('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setContactBusy(false);
    }
  };

  const downloadMyData = async () => {
    setExporting(true);
    setError(null);
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'protein-panda-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  };

  const deleteAccount = async () => {
    if (deleteConfirm !== 'DELETE') return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteMyAccount();
      logout();
    } catch (err: any) {
      setError(err.message);
      setDeleting(false);
    }
  };

  if (!dashboard) {
    return <section className="mx-auto max-w-md px-4 py-16 text-center text-sm text-brand-body">Loading…</section>;
  }

  return (
    <section className="mx-auto max-w-md px-4 py-8">
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Account Settings</h1>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {message && <p className="mb-4 text-sm text-brand-primary">{message}</p>}

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Profile</h2>
        <div className="flex flex-col gap-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
            <option value="">Goal — not set</option>
            <option value="WEIGHT_LOSS">Weight loss</option>
            <option value="MUSCLE_STRENGTH">Muscle & strength</option>
            <option value="GENERAL_FITNESS">General fitness</option>
          </select>
          <select value={dietaryPreference} onChange={(e) => setDietaryPreference(e.target.value)} className="rounded-lg border border-brand-grey px-3 py-2 text-sm">
            <option value="">Dietary preference — not set</option>
            <option value="VEG">Vegetarian</option>
            <option value="NON_VEG">Non-vegetarian</option>
            <option value="VEGAN">Vegan</option>
          </select>
          <input type="number" value={dailyProteinGoalG} onChange={(e) => setDailyProteinGoalG(e.target.value)} placeholder="Daily protein goal (g)" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <input type="number" value={dailyCalorieGoal} onChange={(e) => setDailyCalorieGoal(e.target.value)} placeholder="Daily calorie goal" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <input value={gymName} onChange={(e) => setGymName(e.target.value)} placeholder="Gym (optional — for gym leaderboard)" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
        </div>

        <h2 className="mb-2 mt-5 text-sm font-bold uppercase tracking-wide text-brand-black">Notification Preferences</h2>
        <label className="mb-2 flex items-center gap-2 text-sm text-brand-body">
          <input type="checkbox" checked={orderUpdatesOptIn} onChange={(e) => setOrderUpdatesOptIn(e.target.checked)} />
          Order status updates
        </label>
        <label className="mb-4 flex items-center gap-2 text-sm text-brand-body">
          <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
          Marketing emails/offers
        </label>

        <button
          onClick={saveProfile}
          disabled={savingProfile}
          className="w-full rounded-full bg-brand-primary py-3 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent disabled:opacity-60"
        >
          {savingProfile ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      <AddressesCard />

      <ReferralCard referralCode={dashboard?.referralCode ?? null} />

      <WalletCard balanceRs={dashboard?.walletBalanceRs ?? 0} />

      <PushNotificationToggle />

      <SessionsCard />

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Change Phone or Email</h2>
        {!otpSent ? (
          <div className="flex flex-col gap-2">
            <input
              value={newIdentifier}
              onChange={(e) => setNewIdentifier(e.target.value)}
              placeholder="New phone number or email"
              className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={requestContactChange}
              disabled={contactBusy || !newIdentifier}
              className="rounded-full border-2 border-brand-black py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
            >
              {contactBusy ? 'Sending…' : 'Send OTP'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-brand-body">Enter the code sent to {newIdentifier}</p>
            <input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="6-digit code"
              maxLength={6}
              className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
            />
            <button
              onClick={confirmContactChange}
              disabled={contactBusy || otpCode.length !== 6}
              className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60"
            >
              {contactBusy ? 'Confirming…' : 'Confirm'}
            </button>
          </div>
        )}
      </div>

      <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">Your Data</h2>
        <p className="mb-3 text-xs text-brand-body">Download everything tied to your account — orders, nutrition logs, points, achievements, and more.</p>
        <button
          onClick={downloadMyData}
          disabled={exporting}
          className="w-full rounded-full border-2 border-brand-black py-3 text-xs font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary disabled:opacity-60"
        >
          {exporting ? 'Preparing…' : 'Download My Data'}
        </button>
      </div>

      <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-5">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-red-700">Delete Account</h2>
        <p className="mb-3 text-xs text-red-700">
          Clears your profile, allergy/health data, and contact details, and cancels any active membership. Your order
          history is kept for financial records but is no longer tied to identifying information. This cannot be undone.
        </p>
        <input
          value={deleteConfirm}
          onChange={(e) => setDeleteConfirm(e.target.value)}
          placeholder='Type "DELETE" to confirm'
          className="mb-2 w-full rounded-lg border border-red-300 px-3 py-2 text-sm"
        />
        <button
          onClick={deleteAccount}
          disabled={deleting || deleteConfirm !== 'DELETE'}
          className="w-full rounded-full bg-red-600 py-3 text-xs font-bold uppercase tracking-wide text-white hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete My Account'}
        </button>
      </div>
    </section>
  );
}

interface Address {
  id: string;
  label: 'HOME' | 'WORK' | 'OTHER';
  nickname: string | null;
  addressLine: string;
  phone: string;
  instructions: string | null;
  isDefault: boolean;
  pincode: string | null;
}

const LABEL_ICON: Record<Address['label'], string> = { HOME: '🏠', WORK: '💼', OTHER: '📍' };

function AddressesCard() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState<Address['label']>('HOME');
  const [nickname, setNickname] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [phone, setPhone] = useState('');
  const [instructions, setInstructions] = useState('');
  const [pincode, setPincode] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.myAddresses().then(setAddresses).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setAdding(false);
    setLabel('HOME');
    setNickname('');
    setAddressLine('');
    setPhone('');
    setInstructions('');
    setPincode('');
    setError(null);
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await api.createAddress({ label, nickname: nickname || undefined, addressLine, phone, instructions: instructions || undefined, pincode: pincode || undefined });
      resetForm();
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const makeDefault = async (id: string) => {
    await api.updateAddress(id, { isDefault: true });
    load();
  };

  const remove = async (id: string) => {
    await api.deleteAddress(id);
    load();
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">Saved Addresses</h2>

      {addresses.length === 0 && !adding && (
        <p className="mb-3 text-sm text-brand-body">No saved addresses yet — add one to check out faster next time.</p>
      )}

      <div className="mb-3 flex flex-col gap-2">
        {addresses.map((a) => (
          <div key={a.id} className="rounded-lg border border-brand-grey p-3 text-sm">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-bold text-brand-black">
                {LABEL_ICON[a.label]} {a.label === 'OTHER' && a.nickname ? a.nickname : a.label}
              </span>
              {a.isDefault ? (
                <span className="text-[10px] font-bold uppercase text-brand-primary">Default</span>
              ) : (
                <button onClick={() => makeDefault(a.id)} className="text-[10px] font-bold uppercase text-brand-body hover:text-brand-primary">
                  Set Default
                </button>
              )}
            </div>
            <p className="text-brand-body">{a.addressLine}</p>
            <p className="text-brand-body">{a.phone}</p>
            {a.instructions && <p className="text-xs text-brand-body">Note: {a.instructions}</p>}
            <button onClick={() => remove(a.id)} className="mt-2 text-xs text-red-600">Remove</button>
          </div>
        ))}
      </div>

      {!adding ? (
        <button
          onClick={() => setAdding(true)}
          className="rounded-full border-2 border-brand-black px-4 py-2 text-xs font-bold uppercase text-brand-black hover:border-brand-primary hover:text-brand-primary"
        >
          + Add Address
        </button>
      ) : (
        <div className="flex flex-col gap-2 border-t border-brand-grey pt-3">
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            {(['HOME', 'WORK', 'OTHER'] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLabel(l)}
                className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
                  label === l ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                }`}
              >
                {LABEL_ICON[l]} {l}
              </button>
            ))}
          </div>
          {label === 'OTHER' && (
            <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Mom's place" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          )}
          <textarea value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="Full address" rows={2} className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Contact phone for this address" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <input
            value={pincode}
            onChange={(e) => setPincode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Pincode (optional)"
            inputMode="numeric"
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
          />
          <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Delivery instructions (optional)" className="rounded-lg border border-brand-grey px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || !addressLine || !phone} className="flex-1 rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Address'}
            </button>
            <button onClick={resetForm} className="rounded-full border-2 border-brand-grey px-4 py-2 text-xs font-bold uppercase text-brand-body">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReferralCard({ referralCode }: { referralCode: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!referralCode) return null;

  const link = typeof window !== 'undefined' ? `${window.location.origin}/login?ref=${referralCode}` : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail on some browsers/contexts (e.g. non-HTTPS,
      // permission denied) — the link is still visible and selectable
      // by hand, so this isn't a hard failure, just a missed shortcut.
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">🎁 Refer a Friend</h2>
      <p className="mb-3 text-sm text-brand-body">
        Share your link — when a friend signs up and places their first order, you both get a points bonus.
      </p>
      <div className="flex items-center gap-2">
        <input readOnly value={link} className="flex-1 rounded-lg border border-brand-grey bg-brand-bg px-3 py-2 text-xs text-brand-body" />
        <button
          onClick={copy}
          className="shrink-0 rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

interface WalletTransaction {
  id: string;
  amountRs: string;
  type: 'REFUND' | 'ORDER_PAYMENT' | 'ADMIN_ADJUSTMENT';
  note: string | null;
  createdAt: string;
}

function WalletCard({ balanceRs }: { balanceRs: number }) {
  const [transactions, setTransactions] = useState<WalletTransaction[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = () => {
    if (transactions) {
      setShowHistory((v) => !v);
      return;
    }
    api.myWalletTransactions().then((tx) => {
      setTransactions(tx);
      setShowHistory(true);
    }).catch(() => undefined);
  };

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-brand-black">💳 Wallet</h2>
      <p className="mb-3 text-2xl font-extrabold text-brand-black">₹{balanceRs.toFixed(2)}</p>
      <p className="mb-3 text-xs text-brand-body">
        Store credit — usable at checkout, or added automatically for some refunds.
      </p>
      <button onClick={loadHistory} className="text-xs font-bold text-brand-primary underline">
        {showHistory ? 'Hide history' : 'View transaction history'}
      </button>

      {showHistory && transactions && (
        <div className="mt-3 flex flex-col gap-2 border-t border-brand-grey pt-3">
          {transactions.length === 0 && <p className="text-xs text-brand-body">No wallet activity yet.</p>}
          {transactions.map((t) => (
            <div key={t.id} className="flex items-center justify-between text-xs">
              <div>
                <p className="text-brand-black">{t.note ?? t.type.replace(/_/g, ' ')}</p>
                <p className="text-brand-body">{new Date(t.createdAt).toLocaleString()}</p>
              </div>
              <span className={`font-bold ${Number(t.amountRs) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Number(t.amountRs) >= 0 ? '+' : ''}₹{t.amountRs}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface Session {
  id: string;
  deviceInfo: string | null;
  createdAt: string;
  isCurrent: boolean;
}

function SessionsCard() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.mySessions().then(setSessions).catch(() => undefined);
  useEffect(() => { load(); }, []);

  const revoke = async (session: Session) => {
    setError(null);
    setRevoking(session.id);
    try {
      await api.revokeSession(session.id);
      // Revoking the device making THIS request means the token in
      // this very browser is now rejected on the next call — logging
      // out immediately here is the correct behavior, not an edge case
      // to work around. Revoking a DIFFERENT device just removes it
      // from the list; nothing changes about the current session.
      if (session.isCurrent) {
        logout();
        return;
      }
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRevoking(null);
    }
  };

  if (sessions.length === 0) return null;

  return (
    <div className="mb-6 rounded-2xl border border-brand-grey bg-brand-white p-5">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-brand-black">📱 Active Devices</h2>
      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
      <div className="flex flex-col gap-2">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-brand-grey p-3 text-sm">
            <div>
              <p className="font-bold text-brand-black">
                {s.deviceInfo ?? 'Unknown device'}
                {s.isCurrent && <span className="ml-2 text-[10px] font-bold uppercase text-brand-primary">This device</span>}
              </p>
              <p className="text-xs text-brand-body">Signed in {new Date(s.createdAt).toLocaleString()}</p>
            </div>
            <button
              onClick={() => revoke(s)}
              disabled={revoking === s.id}
              className="rounded-full border-2 border-red-600 px-3 py-1.5 text-xs font-bold uppercase text-red-600 hover:bg-red-50 disabled:opacity-60"
            >
              {revoking === s.id ? '…' : s.isCurrent ? 'Log Out' : 'Log Out This Device'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
