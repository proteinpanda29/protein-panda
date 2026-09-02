'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface StaffRow {
  id: string;
  role: 'ADMIN' | 'DELIVERY';
  phone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  staff: { name: string; position: string | null; departments: string[] } | null;
  deliveryPerson: { name: string; vehicleInfo: string | null } | null;
}

export default function AdminStaffPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    api.adminListStaff().then(setStaff).catch((err) => setError(err.message));
  };

  useEffect(load, []);

  const toggleActive = async (row: StaffRow) => {
    setBusy(row.id);
    try {
      await api.adminSetStaffActive(row.id, !row.isActive);
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-extrabold uppercase tracking-tight text-brand-black">Staff Accounts</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          {showForm ? 'Cancel' : '+ Add Staff / Rider'}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {showForm && (
        <AddStaffForm
          onDone={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Name</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Role</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Contact</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Details</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Department</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Status</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide"></th>
            </tr>
          </thead>
          <tbody>
            {staff.map((row) => (
              <tr key={row.id} className="border-t border-brand-grey">
                <td className="px-4 py-3 font-semibold text-brand-black">
                  {row.staff?.name ?? row.deliveryPerson?.name ?? '—'}
                </td>
                <td className="px-4 py-3 text-brand-body">{row.role === 'ADMIN' ? '👨‍💼 Admin' : '🛵 Delivery'}</td>
                <td className="px-4 py-3 text-brand-body">{row.phone ?? row.email}</td>
                <td className="px-4 py-3 text-brand-body">{row.staff?.position ?? row.deliveryPerson?.vehicleInfo ?? '—'}</td>
                <td className="px-4 py-3">
                  {row.role === 'ADMIN' ? (
                    <DepartmentCell row={row} onChanged={load} />
                  ) : (
                    <span className="text-brand-body">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${
                      row.isActive ? 'bg-brand-primary/10 text-brand-primary' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {row.isActive ? 'Active' : 'Deactivated'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => toggleActive(row)}
                    disabled={busy === row.id}
                    className="text-xs font-bold uppercase text-brand-body underline disabled:opacity-50"
                  >
                    {row.isActive ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {staff.length === 0 && <p className="p-4 text-sm text-brand-body">No staff accounts yet.</p>}
      </div>
    </div>
  );
}

const REAL_DEPARTMENTS = [
  { value: 'SALES', label: '💰 Sales & Customer' },
  { value: 'OPERATIONS', label: '👨‍🍳 Operations & Store' },
  { value: 'SUPPLY_CHAIN', label: '📦 Supply Chain & Inventory' },
  { value: 'LOYALTY', label: '🏋️ Loyalty, Fitness & Membership' },
  { value: 'DELIVERY_LOGISTICS', label: '🚚 Delivery & Logistics' },
  { value: 'FINANCE_MARKETING', label: '📊 Finance, Marketing & BI' },
] as const;

function AddStaffForm({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState<'ADMIN' | 'DELIVERY'>('ADMIN');
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [position, setPosition] = useState('');
  const [vehicleInfo, setVehicleInfo] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleDept = (value: string) => {
    setDepartments((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]));
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.adminCreateStaff({
        role,
        name,
        identifier,
        position: role === 'ADMIN' ? position || undefined : undefined,
        vehicleInfo: role === 'DELIVERY' ? vehicleInfo || undefined : undefined,
        departments: role === 'ADMIN' ? departments : undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-6 grid grid-cols-1 gap-3 rounded-2xl border border-brand-grey bg-brand-white p-5 sm:grid-cols-2">
      <div className="flex gap-2 sm:col-span-2">
        {(['ADMIN', 'DELIVERY'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`flex-1 rounded-full border-2 py-2 text-xs font-bold uppercase ${
              role === r ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
            }`}
          >
            {r === 'ADMIN' ? '👨‍💼 Admin / Staff' : '🛵 Delivery Rider'}
          </button>
        ))}
      </div>

      <input
        placeholder="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />
      <input
        placeholder="Phone or email"
        value={identifier}
        onChange={(e) => setIdentifier(e.target.value)}
        className="rounded-lg border border-brand-grey px-3 py-2 text-sm"
      />

      {role === 'ADMIN' ? (
        <>
          <input
            placeholder="Position (e.g. Manager, Kitchen Staff) — optional"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
          />
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-body sm:col-span-2">
            Departments <span className="normal-case text-brand-body/70">(check none for Owner — full access)</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {REAL_DEPARTMENTS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDept(d.value)}
                  className={`rounded-full border-2 px-3 py-1.5 text-xs font-bold normal-case ${
                    departments.includes(d.value) ? 'border-brand-primary bg-brand-primary text-brand-white' : 'border-brand-grey text-brand-black'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-[11px] normal-case text-brand-body/70">
              Owner sees and controls everything. Checking one or more departments gives access to just those areas — a cashier can&apos;t see supplier costs, for example. A staff member can now hold more than one department at once.
            </span>
          </div>
        </>
      ) : (
        <input
          placeholder="Vehicle info (e.g. Bike KA01AB1234) — optional"
          value={vehicleInfo}
          onChange={(e) => setVehicleInfo(e.target.value)}
          className="rounded-lg border border-brand-grey px-3 py-2 text-sm sm:col-span-2"
        />
      )}

      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}

      <p className="text-xs text-brand-body sm:col-span-2">
        No password or OTP needed to create this account — they&apos;ll log in with the phone/email above at{' '}
        {role === 'ADMIN' ? <code>/admin/login</code> : <code>/delivery/login</code>} the same way you did.
      </p>

      <button
        onClick={submit}
        disabled={saving || !name || !identifier}
        className="rounded-full bg-brand-primary py-2 text-xs font-bold uppercase text-brand-white hover:bg-brand-accent disabled:opacity-50 sm:col-span-2"
      >
        {saving ? 'Creating…' : 'Create Account'}
      </button>
    </div>
  );
}

function DepartmentCell({ row, onChanged }: { row: StaffRow; onChanged: () => void }) {
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const current = row.staff?.departments ?? [];

  const toggle = async (value: string) => {
    const next = current.includes(value) ? current.filter((d) => d !== value) : [...current, value];
    setSaving(true);
    try {
      await api.adminUpdateStaff(row.id, { departments: next });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const summary = current.length === 0 ? '👑 Owner' : current.map((d) => d.replace(/_/g, ' ')).join(' + ');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={saving}
        className="rounded-lg border border-brand-grey px-2 py-1 text-xs text-brand-black disabled:opacity-50"
      >
        {saving ? '…' : summary}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 flex w-56 flex-col gap-1 rounded-lg border border-brand-grey bg-brand-white p-2 shadow-lg">
          {REAL_DEPARTMENTS.map((d) => (
            <label key={d.value} className="flex items-center gap-2 text-xs text-brand-black">
              <input type="checkbox" checked={current.includes(d.value)} onChange={() => toggle(d.value)} />
              {d.label}
            </label>
          ))}
          <button onClick={() => setOpen(false)} className="mt-1 text-[10px] font-bold uppercase text-brand-body hover:underline">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
