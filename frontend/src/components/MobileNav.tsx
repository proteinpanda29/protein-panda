'use client';

import { useEffect, useState } from 'react';
import { getStoredRole } from '@/lib/session';

const GROUPS = [
  { title: 'Order', links: [{ href: '/menu', label: 'Menu' }, { href: '/orders', label: 'My Orders' }, { href: '/favourites', label: 'Favourites' }, { href: '/membership', label: 'Membership' }] },
  { title: 'Me', links: [{ href: '/nutrition', label: 'My Nutrition' }, { href: '/report', label: 'Monthly Report' }, { href: '/account', label: 'Account' }, { href: '/notifications', label: 'Notifications' }] },
  { title: 'Play & Earn', links: [{ href: '/games', label: 'Games' }, { href: '/rewards', label: 'Rewards' }, { href: '/leaderboard', label: 'Leaderboard' }] },
  { title: 'Help', links: [{ href: '/support', label: 'Support' }] },
];

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const [showCustomerNav, setShowCustomerNav] = useState(true);

  useEffect(() => {
    const role = getStoredRole();
    setShowCustomerNav(role !== 'ADMIN' && role !== 'DELIVERY');
  }, []);

  if (!showCustomerNav) return null;

  return (
    <div className="lg:hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Menu"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-brand-white/20 text-brand-white"
      >
        {open ? '✕' : '☰'}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-40 border-t border-brand-white/10 bg-brand-black px-4 py-4">
          {GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-brand-accent">{group.title}</p>
              <div className="flex flex-col gap-2">
                {group.links.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="text-sm font-semibold text-brand-white hover:text-brand-accent"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
