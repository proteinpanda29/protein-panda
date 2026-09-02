'use client';

import { useEffect } from 'react';
import { siteConfig } from '@/lib/siteConfig';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Unhandled frontend error:', error);
    // A real deployment should wire this into an actual error-tracking
    // service (Sentry or similar) — see PRODUCTION.md's monitoring
    // section. Logging to the console here is the honest baseline: it's
    // real and useful in dev, but nobody's watching browser consoles in
    // production, which is exactly why real error tracking matters.
  }, [error]);

  return (
    <section className="mx-auto flex max-w-md flex-col items-center px-4 py-24 text-center">
      <p className="mb-2 text-6xl">😵</p>
      <h1 className="mb-2 text-2xl font-extrabold uppercase tracking-tight text-brand-black">Something Went Wrong</h1>
      <p className="mb-6 text-sm text-brand-body">
        {siteConfig.businessName} hit an unexpected error. This has been logged — please try again, or come back in a
        few minutes.
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="rounded-full bg-brand-primary px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-white hover:bg-brand-accent"
        >
          Try Again
        </button>
        <a
          href="/"
          className="rounded-full border-2 border-brand-black px-6 py-3 text-sm font-bold uppercase tracking-wide text-brand-black hover:border-brand-primary hover:text-brand-primary"
        >
          Go Home
        </a>
      </div>
    </section>
  );
}
