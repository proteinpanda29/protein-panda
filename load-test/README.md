# Load Testing — how to find your real breaking point

Two scripts, two very different safety levels. Read which one you're
running before you run it.

## 1. `read-only.js` — safe against production

Only hits `GET /api/products` and `GET /api/shop/status` — nothing here
writes to the database or sends a real notification. This is the one
that actually tells you something useful: it's the same kind of
traffic real visitors generate just browsing the menu.

```
cd load-test
npm install
BASE_URL=https://protein-panda-production.up.railway.app npm run test:read
```

Start small and increase `CONNECTIONS` gradually until you see the
error rate climb — that's your real ceiling, not a guessed number.

```
CONNECTIONS=25 DURATION_SECONDS=30 BASE_URL=... npm run test:read
CONNECTIONS=50 DURATION_SECONDS=30 BASE_URL=... npm run test:read
CONNECTIONS=100 DURATION_SECONDS=30 BASE_URL=... npm run test:read
```

## 2. `write-path.js` — NEVER against production

This creates real orders — which can trigger real WhatsApp/email/SMS
to whatever account you point it at, and pollutes your real order
history. It has three built-in safety checks (won't run without an
explicit opt-in, refuses anything that looks like a real deployment
URL, requires a real auth token) — but the checks are a backstop, not
a substitute for pointing this at a genuine staging environment.

If you don't have a staging deployment yet, the honest answer is: skip
this one for now. `read-only.js` alone already tells you a lot — most
of what actually breaks under load in a small app like this is the
read path (menu browsing), since that's what dominates real traffic.

## Reading the results

- **Requests/sec** — how much load the server actually handled
- **Latency (p99)** — the slowest 1% of requests; this is what a real
  person on a bad connection experiences, not the average
- **Error rate** — the number that actually answers "what's the
  limit": the connection count where this stops being near-zero is
  your real ceiling

## What this can't tell you

This only tests the app itself — not Railway's own plan limits (RAM,
CPU, monthly usage caps), which could be hit before the app-level
ceiling ever shows up. Check your actual Railway plan's limits
alongside these results, not instead of them.
