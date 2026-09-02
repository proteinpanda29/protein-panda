'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Shift {
  id: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  note: string | null;
  user: {
    role: 'ADMIN' | 'DELIVERY';
    staff: { name: string } | null;
    deliveryPerson: { name: string } | null;
  };
}

function formatDuration(clockedInAt: string, clockedOutAt: string | null) {
  const start = new Date(clockedInAt).getTime();
  const end = clockedOutAt ? new Date(clockedOutAt).getTime() : Date.now();
  const totalMinutes = Math.round((end - start) / 60000);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${hh}h ${mm}m`;
}

export default function AdminStaffShiftsPage() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.adminStaffShifts().then(setShifts).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load shifts. ({error})</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Staff Shifts</h1>

      <div className="overflow-hidden rounded-2xl border border-brand-grey bg-brand-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-brand-black text-brand-white">
            <tr>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Staff</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Role</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Clocked In</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Clocked Out</th>
              <th className="px-4 py-3 font-semibold uppercase tracking-wide">Duration</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => {
              const name = s.user.staff?.name ?? s.user.deliveryPerson?.name ?? '—';
              const isOpen = !s.clockedOutAt;
              return (
                <tr key={s.id} className="border-t border-brand-grey">
                  <td className="px-4 py-3 font-semibold text-brand-black">{name}</td>
                  <td className="px-4 py-3 text-brand-body">{s.user.role === 'DELIVERY' ? 'Rider' : 'Staff'}</td>
                  <td className="px-4 py-3 text-brand-body">{new Date(s.clockedInAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-brand-body">
                    {s.clockedOutAt ? new Date(s.clockedOutAt).toLocaleString() : <span className="font-bold text-brand-primary">Still clocked in</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={isOpen ? 'font-bold text-brand-primary' : 'text-brand-body'}>
                      {formatDuration(s.clockedInAt, s.clockedOutAt)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shifts.length === 0 && <p className="p-4 text-sm text-brand-body">No shifts recorded yet.</p>}
      </div>
    </div>
  );
}
