'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { siteConfig } from '@/lib/siteConfig';

interface ShopStatus {
  isOpen: boolean;
  opensAt: string;
  closesAt: string;
  closureMessage: string | null;
}

export function ShopStatusBar() {
  const [status, setStatus] = useState<ShopStatus | null>(null);

  useEffect(() => {
    api.getShopStatus().then(setStatus).catch(() => undefined);
  }, []);

  if (!status) return null;

  return (
    <div className={`w-full py-1.5 text-center text-xs font-semibold ${status.isOpen ? 'bg-brand-primary text-brand-white' : 'bg-brand-charcoal text-brand-grey'}`}>
      {status.isOpen ? (
        <span>🟢 {siteConfig.businessName} is open · closes at {status.closesAt}</span>
      ) : (
        <span>🔴 Closed · {status.closureMessage ?? `opens at ${status.opensAt}`}</span>
      )}
    </div>
  );
}
