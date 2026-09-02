'use client';

import { useEffect, useRef, useState } from 'react';
import { getStoredRole, isLoggedIn } from '@/lib/session';
import { api } from '@/lib/api';

const MORE_LINKS = [
  { href: '/favourites', label: 'Favourites' },
  { href: '/membership', label: 'Membership' },
  { href: '/report', label: 'Monthly Report' },
  { href: '/games', label: 'Games' },
  { href: '/rewards', label: 'Rewards' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/support', label: 'Support' },
];

export function CustomerNavLinks() {
  const [showCustomerNav, setShowCustomerNav] = useState(true);
  const [unread, setUnread] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const role = getStoredRole();
    const isCustomer = role !== 'ADMIN' && role !== 'DELIVERY';
    setShowCustomerNav(isCustomer);

    if (isCustomer && isLoggedIn()) {
      api.unreadNotificationCount().then(setUnread).catch(() => undefined);
    }
  }, []);

  // Close the dropdown on an outside click — standard expected
  // behavior, and without it the menu would stay open until another
  // nav link happened to be clicked.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!showCustomerNav) return null;

  return (
    <div className="hidden items-center gap-5 text-xs font-semibold uppercase tracking-wide lg:flex">
      {/* Just the handful of things a customer actually needs at a
          glance — everything else lives in "More" below. The previous
          version put all 10 links in a single row with no grouping. */}
      <a href="/menu" className="hover:text-brand-accent">Order</a>
      <a href="/orders" className="hover:text-brand-accent">My Orders</a>
      <a href="/nutrition" className="hover:text-brand-accent">My Nutrition</a>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMoreOpen((v) => !v)}
          className="flex items-center gap-1 hover:text-brand-accent"
          aria-expanded={moreOpen}
        >
          More {moreOpen ? '▴' : '▾'}
        </button>
        {moreOpen && (
          <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-brand-grey bg-brand-white py-2 normal-case tracking-normal shadow-lg">
            {MORE_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="block px-4 py-2 text-sm font-semibold text-brand-black hover:bg-brand-bg"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>

      <a href="/notifications" className="relative hover:text-brand-accent" title="Notifications">
        🔔
        {unread > 0 && (
          <span className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-accent text-[9px] font-bold text-brand-black">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </a>
      <a href="/account" className="hover:text-brand-accent">Account</a>
    </div>
  );
}
