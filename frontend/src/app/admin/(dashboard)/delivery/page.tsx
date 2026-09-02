'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Rider {
  id: string;
  name: string;
  vehicleInfo: string | null;
  isOnDuty: boolean;
  _count: { deliveryOrders: number };
  deliveryOrders: { orderId: string; order: { orderNumber: string } }[];
}

export default function AdminDeliveryPage() {
  const [riders, setRiders] = useState<Rider[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminDeliveryPersonnel()
      .then(setRiders)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-brand-body">Couldn&apos;t load delivery personnel. ({error})</p>;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Delivery Riders</h1>

      {riders.length === 0 && <p className="text-sm text-brand-body">No delivery riders provisioned yet.</p>}

      <div className="flex flex-col gap-3">
        {riders.map((r) => (
          <div key={r.id} className="flex items-center justify-between rounded-2xl border border-brand-grey bg-brand-white p-4">
            <div>
              <p className="font-bold text-brand-black">{r.name}</p>
              <p className="text-xs text-brand-body">
                {r.vehicleInfo ?? 'No vehicle info'} · {r._count.deliveryOrders} total deliveries
              </p>
              {r.deliveryOrders.length > 0 && (
                <p className="mt-1 text-xs font-semibold text-brand-primary">
                  Currently out: #{r.deliveryOrders.map((d) => d.order.orderNumber).join(', #')}
                </p>
              )}
            </div>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
                r.isOnDuty ? 'bg-brand-primary text-brand-white' : 'bg-brand-grey/50 text-brand-black'
              }`}
            >
              {r.isOnDuty ? '🟢 On Duty' : '🔴 Off Duty'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
