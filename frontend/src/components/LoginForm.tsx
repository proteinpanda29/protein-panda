'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { GoogleSignInButton } from './GoogleSignInButton';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  portal: 'CUSTOMER' | 'ADMIN' | 'DELIVERY';
  title: string;
  subtitle: string;
  allowSignup: boolean;
  redirectPath: string;
  wrongPortalHint: string;
  referredByCode?: string;
}

export function LoginForm({ portal, title, subtitle, allowSignup, redirectPath, wrongPortalHint, referredByCode }: Props) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [gymName, setGymName] = useState('');
  const [step, setStep] = useState<'identifier' | 'otp'>('identifier');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isEmail = EMAIL_RE.test(identifier);

  const submitIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.requestOtp(identifier);
      setStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken, role, departments, userId } = await api.verifyOtp(identifier, code, name || undefined, gymName || undefined, referredByCode);

      // Each portal only accepts its own role — a customer OTP-ing into
      // /admin/login (or vice versa) is a real account, just the wrong
      // door. Don't store the token or redirect; send them to the right one.
      if (role !== portal) {
        setError(wrongPortalHint);
        setLoading(false);
        return;
      }

      localStorage.setItem('pp_token', accessToken);
      localStorage.setItem('pp_role', role);
      if (userId) localStorage.setItem('pp_user_id', userId);
      // Owner (empty/missing array) removes any stale value from a
      // previous department-scoped login on the same browser — the
      // sidebar's department filter reads this directly. A staff
      // member can now hold more than one department at once, hence
      // storing the full array rather than a single value.
      if (departments && departments.length > 0) localStorage.setItem('pp_departments', JSON.stringify(departments));
      else localStorage.removeItem('pp_departments');
      router.push(redirectPath);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-16">
      <h1 className="mb-1 text-2xl font-extrabold uppercase tracking-tight text-brand-black">{title}</h1>
      <p className="mb-8 text-sm text-brand-body">{subtitle}</p>

      {step === 'identifier' && (
        <>
          {portal === 'CUSTOMER' && (
            <GoogleSignInButton portal={portal} redirectPath={redirectPath} wrongPortalHint={wrongPortalHint} onError={setError} />
          )}
          <form onSubmit={submitIdentifier} className="flex flex-col gap-4">
            <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
              Mobile number or email
              <input
                type="text"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="+91 9xxxxxxxxx or you@example.com"
                className="mt-1 w-full rounded-lg border border-brand-grey bg-brand-white px-4 py-3 text-brand-black outline-none focus:border-brand-primary"
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white transition-colors hover:bg-brand-accent disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Send OTP'}
            </button>
          </form>
        </>
      )}

      {step === 'otp' && (
        <form onSubmit={submitOtp} className="flex flex-col gap-4">
          <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
            Enter the 6-digit code sent to your {isEmail ? 'email' : 'phone'}
            <input
              type="text"
              required
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="••••••"
              className="mt-1 w-full rounded-lg border border-brand-grey bg-brand-white px-4 py-3 tracking-[0.5em] text-brand-black outline-none focus:border-brand-primary"
            />
          </label>

          {allowSignup && (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
                Your name <span className="normal-case text-brand-body/70">(new here? tell us what to call you)</span>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full rounded-lg border border-brand-grey bg-brand-white px-4 py-3 text-brand-black outline-none focus:border-brand-primary"
                />
              </label>

              <label className="text-xs font-semibold uppercase tracking-wide text-brand-body">
                Your gym <span className="normal-case text-brand-body/70">(optional — joins your gym on the Gym Leaderboard)</span>
                <input
                  type="text"
                  value={gymName}
                  onChange={(e) => setGymName(e.target.value)}
                  placeholder="e.g. Gold's Gym Vellore"
                  className="mt-1 w-full rounded-lg border border-brand-grey bg-brand-white px-4 py-3 text-brand-black outline-none focus:border-brand-primary"
                />
              </label>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white transition-colors hover:bg-brand-accent disabled:opacity-60"
          >
            {loading ? 'Verifying…' : 'Verify & Continue'}
          </button>
          <button
            type="button"
            onClick={() => setStep('identifier')}
            className="text-xs font-semibold uppercase tracking-wide text-brand-body underline"
          >
            Use a different number or email
          </button>
        </form>
      )}
    </section>
  );
}
