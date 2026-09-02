'use client';

import { useEffect, useState } from 'react';
import { useCart } from '@/lib/cart-context';
import { getStoredRole } from '@/lib/session';

export function NavCartLink() {
  const { totalCount } = useCart();
  const [show, setShow] = useState(true);

  useEffect(() => {
    const role = getStoredRole();
    setShow(role !== 'ADMIN' && role !== 'DELIVERY');
  }, []);

  if (!show) return null;

  return (
    <a href="/checkout" className="relative rounded-full border border-brand-grey/40 p-2 hover:border-brand-accent">
      🛒
      {totalCount > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-accent px-1 text-[10px] font-bold text-brand-black">
          {totalCount}
        </span>
      )}
    </a>
  );
}
