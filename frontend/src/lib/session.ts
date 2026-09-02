export type StoredRole = 'CUSTOMER' | 'ADMIN' | 'DELIVERY';

export function getStoredRole(): StoredRole | null {
  if (typeof window === 'undefined') return null;
  return (localStorage.getItem('pp_role') as StoredRole) || null;
}

export function isLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem('pp_token');
}

const LOGIN_PATH_BY_ROLE: Record<StoredRole, string> = {
  CUSTOMER: '/login',
  ADMIN: '/admin/login',
  DELIVERY: '/delivery/login',
};

/** Clears the session and sends the person to the login page for whichever portal they were using. */
export function logout() {
  if (typeof window === 'undefined') return;
  const role = getStoredRole();
  localStorage.removeItem('pp_token');
  localStorage.removeItem('pp_role');
  // Defensive cleanup, not strictly required today — the navigation below
  // is a hard reload that already tears down any open socket — but this
  // keeps the socket module's own state consistent in case that ever
  // changes (e.g. a future SPA-style "switch account" flow).
  import('./socket').then(({ disconnectSocket }) => disconnectSocket()).catch(() => undefined);
  window.location.href = role ? LOGIN_PATH_BY_ROLE[role] : '/login';
}
