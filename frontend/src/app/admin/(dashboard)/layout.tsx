'use client';

import { useEffect, useState } from 'react';
import { logout } from '@/lib/session';
import { ClockWidget } from '@/components/ClockWidget';

// Each item's owning department(s), matching the business-department
// structure you laid out. `null` means Owner-only — a route the
// backend also restricts to department=null specifically (staff
// management, shop settings, audit log, AI safety), not just "every
// admin can see this." Items with no `departments` key at all (like
// Overview) are visible to every admin regardless of department —
// the shared home base, not something any one department owns.
const navItems: { label: string; href: string; departments?: (string | null)[] }[] = [
  { label: 'Overview', href: '/admin' },
  { label: 'New Sale (POS)', href: '/admin/pos', departments: ['SALES'] },
  { label: 'Orders', href: '/admin/orders', departments: ['SALES'] },
  { label: 'Coupons', href: '/admin/coupons', departments: ['SALES'] },
  { label: 'Customers', href: '/admin/customers', departments: ['SALES'] },
  { label: 'Support Tickets', href: '/admin/support-tickets', departments: ['SALES'] },
  { label: 'Products', href: '/admin/products', departments: ['SALES'] },
  { label: '🐼 Kitchen', href: '/admin/kitchen', departments: ['OPERATIONS'] },
  { label: 'Food Safety', href: '/admin/food-safety', departments: ['OPERATIONS'] },
  { label: 'Store Operations', href: '/admin/store-operations', departments: ['OPERATIONS'] },
  { label: 'Staff Shifts', href: '/admin/staff-shifts', departments: ['OPERATIONS'] },
  { label: 'Inventory', href: '/admin/inventory', departments: ['SUPPLY_CHAIN'] },
  { label: 'Suppliers', href: '/admin/suppliers', departments: ['SUPPLY_CHAIN'] },
  { label: 'Purchase Requests', href: '/admin/purchase-requests', departments: ['SUPPLY_CHAIN'] },
  { label: 'Costing', href: '/admin/costing', departments: ['SUPPLY_CHAIN'] },
  { label: 'Rewards', href: '/admin/rewards', departments: ['LOYALTY'] },
  { label: 'Games', href: '/admin/games', departments: ['LOYALTY'] },
  { label: 'Delivery Riders', href: '/admin/delivery', departments: ['DELIVERY_LOGISTICS'] },
  { label: 'Delivery Zones', href: '/admin/delivery-zones', departments: ['DELIVERY_LOGISTICS'] },
  { label: 'Cash', href: '/admin/cash', departments: ['FINANCE_MARKETING'] },
  { label: 'Expenses', href: '/admin/expenses', departments: ['FINANCE_MARKETING'] },
  { label: 'Reconciliation', href: '/admin/reconciliation', departments: ['FINANCE_MARKETING'] },
  { label: 'Segments', href: '/admin/segments', departments: ['FINANCE_MARKETING'] },
  { label: 'Analytics', href: '/admin/analytics', departments: ['FINANCE_MARKETING'] },
  { label: 'Announcements', href: '/admin/announcements', departments: ['FINANCE_MARKETING'] },
  { label: 'AI Safety', href: '/admin/ai-safety', departments: [null] },
  { label: 'Staff Accounts', href: '/admin/staff', departments: [null] },
  { label: 'Shop Settings', href: '/admin/settings', departments: [null] },
  { label: 'Audit Log', href: '/admin/audit-log', departments: [null] },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Empty array = Owner (sees everything) — the same convention used
  // server-side. A staff member can now hold more than one department
  // at once, so access to a page is a union: visible if ANY of their
  // departments matches ANY department the page allows. Read once on
  // mount; a department change made to this exact staff member while
  // they're still logged in won't update the sidebar until their next
  // login (the backend re-verifies live on every request regardless,
  // so this is a display-only staleness, not a security gap — a stale
  // link would still be correctly rejected if clicked).
  const [departments, setDepartments] = useState<string[]>([]);
  const [isOwner, setIsOwner] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('pp_departments');
    const parsed: string[] = stored ? JSON.parse(stored) : [];
    setDepartments(parsed);
    setIsOwner(parsed.length === 0);
  }, []);

  const visibleItems = navItems.filter((item) => {
    if (!item.departments) return true; // shared items like Overview
    if (isOwner) return true; // Owner sees everything, no filtering at all
    return item.departments.some((d) => departments.includes(d as string));
  });

  return (
    <div className="mx-auto flex max-w-6xl gap-8 px-4 py-10">
      <aside className="w-48 shrink-0">
        <p className="mb-1 text-xs font-bold uppercase tracking-widest text-brand-primary">Admin</p>
        {!isOwner && (
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-brand-body">
            {departments.map((d) => d.replace(/_/g, ' ')).join(' + ')}
          </p>
        )}
        <div className="mb-4">
          <ClockWidget />
        </div>
        <nav className="flex flex-col gap-1">
          {visibleItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-brand-black hover:bg-brand-grey/40"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <button
          onClick={logout}
          className="mt-6 w-full rounded-lg border border-red-200 px-3 py-2 text-left text-sm font-semibold text-red-600 hover:bg-red-50"
        >
          🚪 Logout
        </button>
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
