'use client';

import { useEffect, useState } from 'react';
import { isLoggedIn, logout } from '@/lib/session';

export function NavAuthButton() {
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  if (loggedIn) {
    return (
      <button
        onClick={logout}
        className="rounded-full border border-brand-white/30 px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white transition-colors hover:border-brand-accent hover:text-brand-accent"
      >
        Logout
      </button>
    );
  }

  return (
    <a
      href="/login"
      className="rounded-full bg-brand-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-brand-white transition-colors hover:bg-brand-accent"
    >
      Login
    </a>
  );
}
