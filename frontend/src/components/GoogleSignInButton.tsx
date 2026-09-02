'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

let scriptLoadingPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if ((window as any).google?.accounts?.id) return Promise.resolve();

  if (!scriptLoadingPromise) {
    scriptLoadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
      document.body.appendChild(script);
    });
  }
  return scriptLoadingPromise;
}

export function GoogleSignInButton({
  portal,
  redirectPath,
  wrongPortalHint,
  onError,
}: {
  portal: 'CUSTOMER' | 'ADMIN' | 'DELIVERY';
  redirectPath: string;
  wrongPortalHint: string;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const buttonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    // Silently renders nothing if unconfigured — the regular OTP form
    // is still the primary login path either way, so a missing client
    // ID just means one fewer button, not a broken page.
    if (!clientId) return;

    loadGoogleScript().then(() => {
      const google = (window as any).google;
      if (!google?.accounts?.id || !buttonRef.current) return;

      google.accounts.id.initialize({
        client_id: clientId,
        callback: async (response: { credential: string }) => {
          try {
            const { accessToken, role } = await api.verifyGoogleToken(response.credential);

            // Same wrong-portal rule as OTP login — a real account, just
            // not the right door for this specific login page.
            if (role !== portal) {
              onError(wrongPortalHint);
              return;
            }

            localStorage.setItem('pp_token', accessToken);
            localStorage.setItem('pp_role', role);
            router.push(redirectPath);
          } catch (err: any) {
            onError(err.message ?? 'Google sign-in failed');
          }
        },
      });

      google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
    });
  }, [portal, redirectPath, wrongPortalHint, onError, router]);

  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) return null;

  return (
    <div className="mb-4 flex flex-col items-center gap-3">
      <div ref={buttonRef} />
      <div className="flex w-full items-center gap-3 text-xs font-semibold uppercase tracking-wide text-brand-body">
        <div className="h-px flex-1 bg-brand-grey" />
        or
        <div className="h-px flex-1 bg-brand-grey" />
      </div>
    </div>
  );
}
