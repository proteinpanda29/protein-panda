# Launching without errors — the full picture

This ties together everything built across this entire project into
one document: what's genuinely production-ready right now, what needs
you to actually provision something, and the full payment gateway
production setup.

---

## Part 1: What's real and validated, right now

Every item below has been verified — 496 backend unit tests passing,
`tsc --noEmit` clean on both frontend and backend, full production
builds succeeding, and (where the sandbox allowed) real HTTP requests
against a genuinely booted server, not just mocked tests.

- Full ordering flow: menu, cart, checkout, POS, coupon + reward-points
  discounts stacking correctly
- Auth: OTP-based login (no passwords), JWT, role-based access control
  (customer/admin/delivery), verified with real 401/403 checks
- Payments: Razorpay integration with real webhook signature
  verification, idempotent order creation
- Admin panel: orders, inventory (FEFO batch tracking), suppliers,
  costing, cash reconciliation, staff shifts, food safety logs
- Delivery: live GPS tracking, OTP-verified handoff, real failure-state
  tracking, workload-aware rider ranking
- Customer account: data export, account deletion, contact-change
  (OTP-verified), notification preferences
- Notification center + admin broadcast announcements
- Support ticketing with real threaded replies
- PDF invoices, receipts, and reward vouchers
- AI nutrition assistant with layered medical-safety guardrails
  (pregnancy/diabetes/kidney/liver/medication/allergy/child topics)
- Background job queue (BullMQ + Redis) for invoice emails, with a
  genuine fallback if Redis is ever unreachable
- Real HTTP security headers (Helmet on the backend, Next.js headers
  on the frontend)
- A global exception filter converting ~40 previously-uncaught "record
  not found" cases into clean 404s instead of raw 500s
- CI/CD pipeline (type-check + test + build on every push)
- E2E test suite (Playwright, multi-browser) — written and
  type-checked, not yet run against a live deployment
- SEO: robots.txt, sitemap.xml, structured data, OpenGraph tags
- Legal pages matching real app behavior (Privacy, Terms, Refund
  Policy)
- Custom 404/500/maintenance error pages

**What this does NOT include**: proof that this behaves correctly
against a real production database under real concurrent load. This
sandbox cannot reach Prisma's binary CDN or run a full integration
test — that gap gets closed the first time you deploy for real, not
before.

---

## Part 2: What genuinely needs YOU to take action

Nothing below is something I can do for you — each needs a real
account, a real payment method, or a real decision only you can make.

### 2a. Hosting

Pick one and follow its own docs for a Node.js + PostgreSQL app:
Railway, Render, Fly.io, or a VPS (DigitalOcean/Linode) if you want
full control. Replit works too — see `REPLIT.md` in this repo.

### 2b. Domain + SSL

Buy a domain (any registrar). SSL is usually automatic and free
(Let's Encrypt) on Railway/Render/Fly/Replit — you don't need to set
this up by hand unless you're running your own VPS.

### 2c. Environment variables — the exact list

Copy `backend/.env.example` and `frontend/.env.example` and fill in
real values. The two that MUST be correct or the frontend can't reach
the backend at all:

```
# backend
DATABASE_URL=<your real production database URL>
JWT_SECRET=<a long random string — generate one, never reuse the example>
FRONTEND_URL=<your real deployed frontend URL>

# frontend
NEXT_PUBLIC_API_URL=<your real deployed backend URL>/api
NEXT_PUBLIC_SITE_URL=<your real deployed frontend URL>
```

### 2d. Run migrations on the real database

```
cd backend
npx prisma migrate deploy
npx prisma db seed
npx ts-node prisma/provision-staff.ts   # creates your first admin + rider login
```

### 2e. Monitoring & error tracking

Sign up for Sentry (has a free tier) or similar. Once you have a DSN,
tell me and I'll wire the SDK into both frontend and backend — that
part IS code I can write; the account is the part only you can create.

### 2f. Backups

Whatever host you pick almost certainly offers automated database
backups (Railway, Render, and most managed Postgres do, often on the
free tier). Turn it on. If you self-host, `pg_dump` on a daily cron is
the manual equivalent — tell me if you want that script written.

### 2g. Analytics

Google Analytics or Plausible (privacy-friendlier, paid). Once you
have a tracking ID, tell me and I'll wire it in.

---

## Part 3: Full Razorpay production setup

The code side of this is already built and tested. Here's everything
on Razorpay's side:

1. **Complete KYC** in the Razorpay Dashboard — business documents,
   bank account. This is required before you can go live at all, and
   Razorpay will specifically ask for your Privacy Policy and
   Refund/Cancellation Policy URLs during this step — **both now exist
   in this app** (`/privacy-policy`, `/refund-policy`), so make sure
   they're live at your real domain before starting KYC.

2. **Get your live keys** — Dashboard → Settings → API Keys → generate
   live keys (starts with `rzp_live_`, not `rzp_test_`). Set these as
   `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in your production
   environment — never commit these to git, never reuse your test keys
   in production.

3. **Configure the webhook** — Dashboard → Settings → Webhooks → Add
   New Webhook:
   - URL: `https://<your-real-backend-domain>/api/payments/webhook`
   - Active events: at minimum `payment.captured`
   - Copy the webhook secret it gives you into `RAZORPAY_WEBHOOK_SECRET`
   in your production environment

4. **Test with a real small transaction** before announcing you're
   live — this app's webhook signature verification is real and will
   reject anything not genuinely signed by Razorpay, so a live
   end-to-end test is the only way to confirm the whole chain works.

5. **Reconciliation** — Razorpay's own dashboard shows every real
   transaction; this app's `/admin/cash` and `/admin/orders` show your
   side. Check both agree after your first few live orders.

---

## Part 4: The actual order to do this in

1. Pick hosting (2a), get it running with the app deployed
2. Get a domain pointed at it (2b), confirm SSL is live
3. Set every environment variable (2c), redeploy
4. Run migrations + seed (2d)
5. **Publish the legal pages** and confirm they're reachable at your
   real domain — needed for step 6
6. Complete Razorpay KYC and go live (Part 3)
7. Place a real test order end to end, cash AND online payment
8. Turn on backups (2f)
9. Set up Sentry + Analytics once you're ready (2e, 2g) — tell me and
   I'll wire the code in
10. Announce you're open

If anything breaks at any step, the exact error message is more useful
to me than a description of the symptom — paste it and I'll fix it the
same way every other bug in this build got fixed.
