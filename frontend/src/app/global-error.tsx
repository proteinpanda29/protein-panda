'use client';

import { useEffect } from 'react';

// Next.js requires this to render its own <html>/<body> — it replaces
// the ENTIRE root layout when that layout itself is what crashed, so it
// can't rely on anything the normal layout would have provided (no
// siteConfig-driven branding here on purpose; if the root layout is
// broken, keeping this dependency-free is what keeps this page itself
// from also failing to render).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Fatal error in root layout:', error);
  }, [error]);

  return (
    <html>
      <body style={{ fontFamily: 'sans-serif', textAlign: 'center', padding: '4rem 1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '0.5rem' }}>Something Went Wrong</h1>
        <p style={{ marginBottom: '1.5rem', color: '#555' }}>
          The site hit an unexpected error. Please try again.
        </p>
        <button
          onClick={reset}
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '999px',
            background: '#080808',
            color: '#fff',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
          }}
        >
          Try Again
        </button>
      </body>
    </html>
  );
}
