# 🐼 Protein Panda — Platform Scaffold

Nutrition + loyalty + fitness engagement platform, connected to the physical shop.
This repo is the foundation: **schema → backend → frontend**, in that order, so the
data model doesn't get retrofitted around the UI later.

**Ready to launch? See [PRODUCTION.md](./PRODUCTION.md)** — the single document
tying together everything built in this project: what's validated and real right
now, what genuinely needs you to provision something (hosting, domain, Sentry), and
the full Razorpay production setup, in the actual order to do it in.

## Structure

```
protein-panda/
├── docker-compose.yml       # local Postgres + Redis
├── backend/                 # NestJS + TypeScript + Prisma
│   ├── prisma/schema.prisma # full data model (see below)
│   ├── prisma/seed.ts       # sample categories/products/games
│   └── src/
│       ├── auth/            # mobile or email + OTP login/signup, JWT issuance
│       ├── common/          # PrismaService, RedisService, RolesGuard
│       ├── customers/       # "My Nutrition" dashboard
│       ├── orders/          # order creation transaction (core logic)
│       ├── products/        # public catalog
│       ├── games/           # attempts + Redis leaderboard
│       ├── points/          # central points ledger
│       ├── streaks/         # daily streak logic
│       ├── rewards/         # redemption
│       ├── admin/           # admin-only dashboard endpoints
│       └── delivery/        # delivery-person-scoped endpoints
└── frontend/                 # Next.js + TypeScript + Tailwind (PWA-ready)
    └── src/app/
        ├── page.tsx          # home page (brand hero)
        ├── login/            # mobile or email + OTP login/signup
        ├── menu/             # ordering + customization (Base→Flavour→Liquid→Add-ons)
        ├── checkout/         # cart review + order placement
        ├── delivery/         # rider dashboard (assigned orders only)
        ├── admin/            # overview, orders, products, customers
        └── nutrition/        # nutrition dashboard
```

## Why this order

1. **Schema first** (`backend/prisma/schema.prisma`) — orders, nutrition logs,
   streaks, points, games, and rewards are all relationally linked to the
   customer. Getting this right up front avoids painful migrations later.
2. **Backend second** — the order-creation flow (`orders/orders.service.ts`)
   is the heart of the system: one transaction that validates allergens,
   computes pricing/nutrition, logs the nutrition entry, awards points,
   updates the streak, and progresses any active protein-goal challenge.
   Keeping this atomic is what keeps nutrition/points/streak consistent
   with the order itself.
3. **Frontend last** — built against real API contracts instead of guesses.

## Three-role auth model

One login system, one JWT, role embedded in the token (`CUSTOMER` / `ADMIN` /
`DELIVERY`). Every protected route is wrapped in `JwtAuthGuard` +
`RolesGuard` + `@Roles(...)` — **the frontend hiding a page is never treated
as security**; the backend re-checks the role on every request. Delivery
accounts only ever see their own assigned orders (see
`delivery/delivery.service.ts`) — no customer nutrition data, no other
riders' orders, no business analytics.

**Login is mobile number OR email, both OTP-only — there is no password
anywhere in this app.** `AuthService.requestOtp`/`verifyOtp` accept either
identifier shape (detected via regex) and store the OTP keyed to the raw
identifier before any account necessarily exists. A brand-new identifier
self-signs-up as a `CUSTOMER` the moment its OTP is verified — no separate
registration step. `ADMIN` and `DELIVERY` accounts are never created
through this self-service flow; they're provisioned directly (e.g. via
Prisma Studio or a seed script) by the business.

## Rate limiting tiers

Global default is 100 req/min/IP (`ThrottlerModule` in `app.module.ts`).
OTP request/verify routes override this with much stricter limits
(`@Throttle` in `auth/auth.controller.ts`) since those are the highest-risk
endpoints (SMS-bombing, brute-force).

## Brand theme (frontend)

Tailwind config (`frontend/tailwind.config.ts`) hardcodes the exact palette:
`#080808` black, `#6F8615` green, `#82A51B` lime accent, `#F3F0E7` warm
white. Your uploaded logo and poster are already copied into
`frontend/public/brand/`.

## Live order status (WebSockets)

`backend/src/common/orders.gateway.ts` runs a socket.io gateway alongside
the REST API. Sockets authenticate with the same JWT used for HTTP calls
(sent as `auth: { token }` on connect) and are placed into role-scoped
rooms — `customer:<id>`, `admin`, or `delivery:<id>` — mirroring the same
server-derived-identity rule as every REST endpoint. Nobody can join a
room they don't belong to by forging a client-side id.

Both `OrdersService.updateStatus` (admin/kitchen) and
`DeliveryService.updateDeliveryStatus` (rider) emit an `order:update`
event after changing status, so the customer, the admin orders board, and
the assigned rider all update in real time without polling.

On the frontend, `lib/socket.ts` holds a single shared connection and
`lib/useOrderUpdates.ts` is a small hook any page can use to subscribe.
It's wired into: the checkout success screen (live step tracker), the
admin orders page (rows update in place), and the delivery dashboard
(auto-refreshes on relevant events).



```bash
# 1. Start Postgres + Redis
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npx prisma db seed
npm run start:dev        # http://localhost:4000/api

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev               # http://localhost:3000
```

## Payments (Razorpay)

`backend/src/payments/` wraps the Razorpay Orders API. The flow:

1. Customer places an order (`POST /orders`) with a `paymentMethod` of
   `CASH`, `UPI`, or `CARD`. A `Payment` row is created as `PENDING`
   alongside the order in the same transaction.
2. **CASH** — purchase points, streak, and protein-goal progress are
   granted immediately (an in-shop/COD order is real regardless of when
   cash changes hands). The payment itself is marked `PAID` later, either
   by the delivery rider on marking `DELIVERED`
   (`DeliveryService.updateDeliveryStatus`) or by staff at the counter
   (`PATCH /admin/orders/:id/collect-cash`).
3. **UPI / CARD** — the frontend calls
   `POST /payments/orders/:orderId/razorpay` to get a Razorpay order, opens
   Razorpay Checkout, and on success calls `POST /payments/verify`. That
   endpoint verifies the HMAC-SHA256 signature server-side (never trusts
   the client-side callback alone) before marking the payment `PAID` —
   **only then** are points/streak/goal-progress granted
   (`OrdersService.grantOrderRewards`), so an abandoned or failed online
   payment never earns rewards for an order that was never actually paid.

Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in `backend/.env` (use test
keys from the Razorpay dashboard for development — no real charges occur
in test mode). Payment endpoints carry their own strict rate limit
(10/min), separate from the general API limit.

## Tests

`backend/src/**/*.spec.ts` — unit tests for the highest-risk business logic:

- **`orders/orders.service.spec.ts`** — the order-creation transaction:
  allergen conflicts, required-customisation-group validation (Base/
  Flavour/Liquid), pricing/nutrition totals with add-ons, and that
  rewards are granted for CASH but deferred for online payment methods
- **`payments/razorpay.service.spec.ts`** — HMAC signature verification
  (valid, tampered, wrong-secret, missing-config cases)
- **`payments/payments.service.spec.ts`** — payment ownership checks,
  idempotent double-confirmation, and that rewards are only granted after
  a verified confirmation
- **`streaks/streaks.service.spec.ts`** — same-day idempotency, streak
  continuation, and streak breaks (using fixed system time)
- **`points/points.service.spec.ts`** — ledger writes, balance upserts,
  and that a Redis failure never rolls back an already-committed award
- **`common/roles.guard.spec.ts`** — the RBAC guarantee that a customer
  can never pass an admin-only route
- **`auth/auth.service.spec.ts`** — mobile-vs-email identifier routing,
  self-signup for new identifiers (always as `CUSTOMER`), that an
  existing identifier logs in rather than creating a duplicate account,
  OTP expiry/replay rejection, and non-enumerable responses (same message
  whether or not the identifier is registered)

Run with `npm test` (or `npm run test:cov` for coverage) from `backend/`.
Tests use mocked Prisma transaction objects rather than a live database,
so they run fast and need no setup beyond `npm install`.

## AI Nutrition Assistant

`backend/src/ai/` — `POST /ai/chat` accepts a conversation array (`{role, content}[]`)
and calls the Anthropic API, grounded in that specific customer's real
data: goal, allergies, today's protein/calories remaining, and the live
product catalog (with nutrition + allergen tags pulled fresh from the DB
on every request — never hallucinated). The system prompt explicitly
forbids recommending anything matching a recorded allergy, and instructs
the model to redirect medical questions to a real doctor/dietitian rather
than diagnosing. Requires `ANTHROPIC_API_KEY` in `backend/.env` (get one
at console.anthropic.com) — without it, the endpoint returns a clear
"not configured" error rather than failing silently. Frontend: `/assistant`.

## Shop open/close status

`backend/src/shop/` — a singleton `ShopSettings` row. `GET /shop/status`
is public (shown as a banner across the whole site via `ShopStatusBar`);
`PATCH /shop/status` is admin-only (`/admin/settings` in the UI) and
controls open/closed, hours, and an optional closure message.

## Delivery on/off duty + live GPS tracking

Riders toggle duty status from `/delivery` (`PATCH /delivery/duty`) —
admin sees everyone's status and active order at `/admin/delivery`.
While on duty with an active `OUT_FOR_DELIVERY` order, the delivery page
uses the browser's Geolocation API (`watchPosition`) to ping
`PATCH /delivery/:id/location` periodically; the backend rejects pings
for any order that isn't actually out for delivery, persists the last
position (so a customer opening the tracker mid-delivery isn't stuck with
a blank map), and broadcasts it live over the existing WebSocket gateway
to that customer only. The customer-facing `OrderStatusTracker` renders
this via `LiveDeliveryMap` — free OpenStreetMap/Leaflet tiles, no Google
Maps API key required.

## OTP delivery (real email + SMS)

`backend/src/notifications/otp-dispatch.service.ts` — real delivery for
login/signup codes:
- **Email** via Gmail SMTP (Nodemailer) — needs `GMAIL_USER` +
  `GMAIL_APP_PASSWORD` (a Google **App Password**, not your normal Gmail
  password — requires 2-Step Verification enabled on the account first).
- **SMS** via MSG91 — needs `MSG91_AUTH_KEY` + `MSG91_DLT_TEMPLATE_ID`.
  **Important**: sending transactional SMS to Indian numbers legally
  requires **DLT registration** first (a government-mandated sender-ID +
  template approval process, done outside this codebase, typically takes
  a few days). Until that's done, SMS OTPs simply won't deliver even with
  a correct API call — this is a regulatory requirement, not a bug.

If neither is configured (or a send fails), the code is logged to the
backend terminal as `[DEV FALLBACK] OTP for ...: 123456` so local
development is never blocked waiting on real providers.

## Membership / subscriptions

`backend/src/memberships/` — weekly (7-day) or monthly (30-day) recurring
meal plans. `MembershipCronService` runs every minute
(`@nestjs/schedule`) and checks for `ACTIVE` memberships whose
`scheduledTime` matches right now; when one's due, it calls the exact
same `OrdersService.create()` every other order goes through — so
allergen checks, pricing, points, and streak all behave identically to a
manually placed order, with `channel: MEMBERSHIP` for reporting. A
membership can be paused/resumed, skip just its next occurrence
(`skipNextDate`), or get its daily time changed — all customer-owned and
ownership-checked. Auto-completes once `daysCompleted` reaches
`totalDays`. Frontend: `/membership`.

## Achievements

`backend/src/achievements/` — a data-driven `AchievementDefinition` table
(seeded: first order, 7/30-day streak, 100g protein day, 1000g lifetime
protein, first/10 game wins, 10/50/100 orders) checked from three call
sites — `OrdersService.grantOrderRewards`, `GamesService.logAttempt` — so
unlocks happen automatically as a side effect of normal usage, not a
separate cron. Unlocking is idempotent (safe to re-check every time) and
awards bonus points once, on first unlock only. Shown on `/nutrition`.

## Reviews & delivery ratings

Two separate rating systems, matching the spec's distinction between food
quality and delivery experience: `POST /products/:id/reviews` (only
allowed for a product you've actually ordered — checked server-side) and
`POST /orders/:id/delivery-rating` (star rating + quick tags like
"Fast"/"Polite", only after the order shows `DELIVERED`). Frontend:
`/orders` — order history with inline review/rating forms per item.

## XP / Levels, Monthly Report, Gym Leaderboard, Shareable Achievements

- **XP/Levels** (`backend/src/customers/levels.ts`) — Rookie → Starter →
  Beast → Panda Pro → Panda Legend. XP is the customer's **lifetime
  earned** points (every positive ledger entry, ever), deliberately
  separate from their spendable points balance — redeeming a reward for
  a discount never causes a level to regress. Shown on `/nutrition`.
- **Monthly Panda Report** (`CustomersService.getMonthlyReport`) —
  orders, protein consumed, streak, games played, XP earned, favourite
  product, and money saved via redeemed rewards, computed on demand for
  any month (not stored, so it's always accurate). `/report`, swipeable
  month-to-month, downloadable as an image via `html2canvas`.
- **Gym vs Gym leaderboard** — entirely opt-in: a customer only joins a
  gym's ranking if they typed a gym name at signup (optional field on the
  login/signup form); nothing is inferred or defaulted. Aggregated from
  each opted-in customer's current points balance. `/leaderboard` has a
  tab to switch between individual and gym rankings.
- **Shareable achievement cards** — tapping an unlocked achievement on
  `/nutrition` opens a branded card rendered to a PNG via `html2canvas`,
  with native Web Share API support (falls back to direct download on
  browsers without file-sharing support).

## POS ecosystem — e-bills + analytics

Part of the "one central system, not a separate POS" idea from your
concept doc:

- **E-bills** (`backend/src/billing/`) — every order automatically emails
  an itemized invoice once it's genuinely paid: immediately for CASH
  orders (settled at counter/delivery), or only after a verified online
  payment confirmation for UPI/Card — same payment-gating rule as
  points/streak. If the customer signed up with phone-only (no email on
  file), the email step is skipped, not retried or errored. Customers can
  view any past bill and resend it from `/orders`, or share it as a
  pre-filled WhatsApp message.
- **Expanded POS analytics** (`/admin/analytics`) — payment method
  breakdown (cash/UPI/card), average order value, hourly sales
  distribution (today only), best-selling and slow-moving products, and
  total discounts given, with Today/Week/Month range toggles. Computed
  live from existing order/payment/item data.

## Inventory deduction on sale

`backend/src/inventory/` — every order now actually deducts ingredient
stock, closing a gap that existed for a while (the tables existed, but
nothing drew down stock). Runs inside the same transaction as order
creation, for every channel (website, membership, future POS), regardless
of payment method — stock leaves the shelf the moment the order is
placed, not when it's paid for. Deliberately **never blocks a sale** on
missing or insufficient stock — a forgotten inventory update shouldn't
break checkout for a small shop; stock is allowed to go negative and the
low-stock signal comes separately from `/admin/inventory`. Every
deduction also writes a `StockMovement` audit row, visible on that same
page. Add-ons aren't deducted yet — `ProductAddon` isn't linked to
`Ingredient` in the schema, only a product's base recipe
(`ProductIngredient`) is.

## POS "New Sale" counter screen

`/admin/pos` — closes out the last item from the original POS concept.
Staff search for a returning customer (name/phone/email), or register a
new walk-in on the spot (no OTP needed — the person is physically
present, so identity verification happens in person instead). Products
work exactly like the customer menu, including full shake customisation
(Base/Flavour/Liquid/Add-ons). "Complete Sale" always settles the payment
immediately regardless of method — cash, UPI, or card all clear instantly
at a physical counter, unlike an online checkout that can be abandoned —
so points/streak/e-bill/inventory-deduction all fire the same way CASH
orders already do. Every POS order records which admin/staff account
processed it (`Order.processedByUserId`), laying the groundwork for a
future "staff sales" breakdown in analytics.

## Three separate login portals + delivery gap fixes

- **`/login`** (customer, self-signup allowed), **`/admin/login`**,
  **`/delivery/login`** — each checks that the OTP-verified account's
  actual role matches the portal it was accessed from; a mismatch shows
  a clear message pointing to the right portal instead of logging in.
  Admin dashboard routes moved into an `(admin)/(dashboard)` route group
  so `/admin/login` doesn't inherit the admin sidebar before you're
  authenticated.
- **Real gap fixed: delivery orders never actually got a `DeliveryOrder`
  record.** Checkout now collects a delivery address + contact phone
  (required for delivery orders), `OrdersService.create()` creates the
  `DeliveryOrder` and saves the address onto the customer's profile as
  their last-known location. Without this, riders could never be
  assigned and live tracking had nothing to attach to.
- **Delivery assignment** — Admin Orders page now has an "Assign Rider"
  control (only on-duty riders selectable) that appears once a delivery
  order needs one; assigning advances the order to `ASSIGNED` and
  broadcasts it live.
- **Admin customer detail** (`/admin/customers/[id]`) — full profile:
  contact, address, goal, streak, points, allergies, complete order/food
  history. Customer search now also matches phone/email.
- **Dine-in vs online split** added to `/admin/analytics`.
- **Manual stock management** (`/admin/inventory`) — add a brand-new
  ingredient with starting stock, or restock/adjust an existing one, each
  logged as an auditable `StockMovement`.

## Staff account management (resale-ready)

`/admin/staff` — the first step toward making this handoff-ready to a
new business owner without needing developer access to the database.
Admin can now create both `ADMIN` and `DELIVERY` accounts directly from
the UI (no OTP — the admin is vouching for the person in person, same
trust model as the POS walk-in flow), and **deactivate/reactivate any
staff account**.

Two real gaps got fixed alongside this:
- **Deactivation wasn't actually enforced anywhere.** `User.isActive`
  existed in the schema but nothing checked it. Now: (1) `AuthService`
  blocks login at OTP-verify time for a deactivated account, and (2)
  `JwtStrategy` re-checks `isActive` on **every single request**, not
  just at login — so revoking someone's access takes effect immediately,
  even if they still have an unexpired token from an active session.
- `prisma/provision-staff.ts` is no longer the only way to create the
  first admin account for a fresh deployment — see the updated setup
  steps below (you still need it once, to create the very first admin,
  since the UI to create staff requires already being logged in as one).

Still to do for full resale-readiness (not built in this batch): editable
categories, a full product editor (nutrition/addons/allergens), rewards
and coupon management, and games/levels management — all currently
seed-only, same as before this change.

## Categories + full product editor

`/admin/products/[id]` — the second resale-readiness piece. Admin can now
manage everything about a product from the UI, closing the gap where
only name/price/veg/active were editable:

- **Categories** — create new ones inline from the Products list, no
  seed script needed
- **Nutrition** — edit calories/protein/carbs/fat/fibre per unit
- **Allergens** — toggle which of the shop's allergens apply, or add a
  brand-new allergen on the fly
- **Customisation options** — add/remove Base, Flavour, Liquid, and
  Add-on choices per product, matching the exact same required-group
  validation the order flow already enforces
- **Recipe** — link ingredients (with a quantity-per-unit) so a product
  the owner adds themselves correctly deducts stock on sale, using the
  same `ProductIngredient` mechanism the seed data already relied on

A shop owner can now fully build out their menu — categories, products,
nutrition, customisation, allergens, and stock recipes — without ever
touching the database directly.

## Rewards + Coupons management, and a real coupon-validation fix

`/admin/rewards` and `/admin/coupons` — admin can create/edit both
without touching the database, closing two more items from the
resale-readiness list.

While building coupon management, found and fixed a real bug: coupon
validation was previously a stub — the code comment literally said "kept
simple; real logic would validate dates/usage limits." **It never
checked expiry dates, never checked usage limits, and never even
incremented the usage counter**, so a "10 uses max" coupon could be used
unlimited times and an expired coupon would still silently apply. Now:
- An invalid/expired/exhausted coupon **fails loudly** with a clear
  reason (the customer typed a code, they should know it didn't work) —
  it never silently falls back to full price
- Usage count actually increments on every successful use
- Checkout now has a coupon code field (there wasn't one before —
  the backend supported coupons but nothing in the UI could apply one)

## Out-of-stock toggle, prep time, FSSAI number, and a visibility fix

- **Out-of-stock toggle** — this already existed (the isActive enable/disable
  switch), just relabeled to "Mark Out of Stock" / "Mark In Stock" so it
  reads clearly for a food business rather than generic "Disable/Enable."
- **Prep/delivery time** — new optional field per product, set at
  creation or in the full editor, shown to customers on the menu as
  "⏱ Ready in ~15 min."
- **FSSAI license number** — added at the **shop level**
  (`ShopSettings`), not per-product. This was a deliberate call: FSSAI
  licenses are legally one per food business in India, not per dish, so
  putting it on every product would be both incorrect and tedious to
  fill in repeatedly. Set once in Admin Settings, displays site-wide in
  the footer.
- **Real gap fixed**: the public menu API never included allergen data
  at all — meaning allergy warnings were invisible to customers browsing
  the menu even though they were already enforced server-side at
  checkout. Now every menu card shows allergen warning badges.
- Quick-add product now redirects straight into the full editor after
  creation, so ingredients/allergens/customisation can be added in one
  continuous flow instead of a separate click back to the list.

## Bug hunt: a real regression found and fixed

Requested a general audit for bugs/gaps. Found one serious regression I'd
introduced myself a few batches ago, plus a smaller UX gap:

- **Delivery memberships were silently completely broken.** When
  delivery orders were made to require an address + contact phone
  (closing the "riders can never be assigned" gap), the membership cron
  job was never updated to match — so every DELIVERY-fulfillment
  membership's daily auto-order generation started throwing a validation
  error and getting silently swallowed by the per-membership error
  handler, every single day, forever. No delivery membership could ever
  actually deliver. Fixed at the root: `Membership` now stores its own
  delivery address/phone (captured once at plan creation, same as a
  regular checkout), and the cron passes them through. Added a
  regression test specifically covering this.
- **Checkout never showed the discounted total.** A customer applying a
  coupon had no way to see it worked — not before paying, not on the
  confirmation screen. The order confirmation now shows the actual
  charged total and the coupon discount if one applied.

## Payments audit: added the missing Razorpay webhook

Requested an audit of the payments flow specifically. Found a genuine,
significant gap: **payment confirmation relied entirely on the
customer's browser calling back after paying** — there was no
server-to-server webhook. In practice this means: if a customer's phone
loses signal, they close the tab, or the app crashes in the split second
after Razorpay successfully charges their card, the order stays stuck in
`PENDING` forever. The customer is charged, but the kitchen never sees
the order, no points/streak are granted, no e-bill goes out, and nothing
in the system knows anything went wrong. This is a common real-world
failure mode for any payment integration that skips webhooks — not a
rare edge case.

Fixed:
- **`POST /api/payments/webhook`** — a new, deliberately unauthenticated
  endpoint (Razorpay isn't a logged-in user) that Razorpay calls
  directly when a payment is captured, verified via a separate HMAC
  webhook signature over the raw request bytes (`RAZORPAY_WEBHOOK_SECRET`,
  configured in the Razorpay Dashboard — see `.env.example` for setup
  steps)
- Enabled raw-body capture in `main.ts` (`rawBody: true`) since Fastify
  doesn't expose this by default and signature verification needs the
  exact original bytes, not a re-serialized copy
- The webhook and the existing browser-callback path now share one
  settlement method, so confirming a payment behaves identically either
  way and is fully idempotent — a duplicate delivery (webhooks can retry)
  never double-grants rewards or double-sends an e-bill
- **8 new tests** covering the webhook path specifically: ownership-free
  server-to-server confirmation, idempotency, and signature tampering

## Realtime/WebSocket audit: same isActive gap, different layer

Requested an audit of the live-update layer. Found the same class of bug
already fixed once for the REST API, but never applied to the WebSocket
gateway: `OrdersGateway.handleConnection` verified the JWT's signature
and expiry, but never checked whether the account was still active.
Deactivating a staff/rider/customer account correctly cut off their REST
access instantly (fixed earlier), but they could still open a live
socket connection and keep receiving order/location updates
indefinitely — the same account, revoked on paper, still watching
everything happen live. Fixed: the gateway now checks `isActive` at
connection time too, and socket.io's own automatic reconnection attempts
mean this self-heals — a deactivated account's socket gets rejected the
next time it tries to reconnect, without needing anything extra.

Everything else checked out clean: room isolation (customer/admin/rider)
is correctly scoped so nobody receives another person's private updates,
and the frontend socket client survives account switching correctly —
logout uses a hard page navigation, which already tears down any open
connection before the next login happens (no stale-session leak there,
despite this being exactly the kind of multi-portal switching used
throughout this whole build/test session). Added a defensive
`disconnectSocket()` call to logout anyway, as cheap insurance against
that changing in the future.

7 new tests cover the gateway specifically: token rejection,
deactivated-account rejection, missing-user rejection, and room
assignment per role.

## Delivery rider app audit — found a significant double-reward bug

Requested an audit of the rider app. In the process of tracing the
cash-collection flow (`DeliveryService.updateDeliveryStatus('DELIVERED')`),
found a **real, systemic bug affecting every self-checkout CASH order**,
not just delivery ones:

`OrdersService.create()` granted points/streak/protein-goal-progress
immediately for *any* order paid by `CASH` — but a plain self-checkout
CASH order's `Payment` is created with status `PENDING` (only a POS
counter sale, via `markPaidImmediately`, is created already `PAID`). So
every self-checkout CASH order got rewards **at the moment it was
placed** — before any money changed hands — and then got them **again**
when the cash was actually collected, via either
`AdminService.collectCashPayment()` (pickup) or
`DeliveryService.updateDeliveryStatus('DELIVERED')` (delivery). Every
customer who ever placed a self-checkout cash order was earning double
points, double streak credit, and potentially a duplicate 500-point goal
completion bonus. Fixed at the root: the immediate-grant condition in
`OrdersService.create()` now only fires for genuine in-person
`markPaidImmediately` sales; a plain CASH order defers rewards to actual
collection, exactly like UPI/CARD defer to `PaymentsService.confirmPayment()`.

Also found and fixed, specific to the rider app itself: there was no
endpoint to fetch a rider's own profile, so the on/off-duty toggle
**always displayed "Off Duty" on every page load or refresh**, even for
a rider who was genuinely still on duty in the database (their real
status was unaffected, but the UI lied about it until they next touched
the toggle). Added `GET /delivery/me` and wired the frontend to fetch
real duty status on mount.

Everything else in the rider app checked out: ownership checks on every
action (a rider can't touch another rider's orders), the
`PICKED_UP`/`OUT_FOR_DELIVERY`/`DELIVERED` state machine only advances
forward, live location pings are correctly rejected outside the
`OUT_FOR_DELIVERY` window, and location broadcasts are scoped to only
the customer who placed that specific order plus the admin ops view —
never to other customers or other riders.

**14 new tests** added covering `DeliveryService`, `collectCashPayment`,
and the profile endpoint — including a regression test that explicitly
proves the double-grant can't happen again.

## Games & Levels admin management — resale-readiness list complete

`/admin/games` — the last item from the resale-readiness checklist.
Admin can create games, add up to 4 levels each (matching the
Beginner/Intermediate/Advanced/Pro structure the seed data uses),
edit level targets/point awards, remove levels, and enable/disable
whole games — no database access needed.

Backend validation was tightened while building this (not just wired
up, made correct): duplicate game names are rejected before hitting the
database, a level's `targetMetric` must be positive and `pointsAward`
can't be negative, a level can't be added to a game that doesn't exist,
and duplicate level numbers for the same game are caught with a clear
message instead of a raw database constraint error. 18 new tests cover
every one of these paths.

**With this, every item from the original resale-readiness audit is
done**: staff accounts, categories, full product editor, rewards,
coupons, and now games/levels — a new shop owner can configure their
entire operation from the admin panel without ever touching the
database directly.

## Refund & cancellation engine

The first of the post-launch "business-critical infrastructure" items
from your operational review. A real `Refund` model with a full audit
trail — amount, reason, method, status, who initiated it, the Razorpay
refund ID if applicable — not just a status flag on the order.

- **Customer self-cancellation** (`/orders`) — only allowed before the
  kitchen starts preparing (RECEIVED/ACCEPTED). Once cooking has started,
  the customer is told to contact the shop instead — ingredients are
  already committed at that point.
- **Admin cancellation** (`/admin/orders`) — works at any stage except
  `DELIVERED` (a delivered order needs a refund, not a cancellation).
- **Atomic reversal on cancellation**: inventory is always restocked
  (stock was deducted at order creation regardless of payment status, so
  it's always reversed), and points/goal-bonus are reversed **only** if
  they were actually granted (i.e. payment was confirmed) — reusing the
  exact same payment-gating rule the rewards system already follows.
  Deliberately does **not** reverse streak credit (another order might
  have qualified that same day) or achievements (treated as permanent
  milestones) — both documented as conscious decisions, not oversights.
- **Financial-only refunds** (`/admin/orders` → Refund, and
  `/admin/refunds` for history) — for post-delivery complaints or partial
  goodwill refunds. Doesn't touch order status, inventory, or points
  (ambiguous for a partial amount), tracks a running `refundedRs` so you
  can't over-refund an order across multiple partial refunds.
- **Real Razorpay refund integration** — calls their actual refund API
  for UPI/Card payments; the DB transaction and the external API call are
  kept separate (never hold a transaction open across a network call),
  same pattern as the payment webhook.
- **Cash refunds** stay `PENDING` until an admin explicitly confirms the
  cash was physically handed back (`/admin/refunds`).

27 new backend tests cover every eligibility rule, the exact reversal
math, gateway-failure handling (a failed Razorpay refund is marked
`FAILED` and surfaces a clear error — never silently "succeeds"), and
idempotency.

## Batch/expiry inventory tracking (FEFO)

Second item off the operational-review "must have" list. Closes a real
gap: inventory previously only tracked a single running total per
ingredient with no concept of *which delivery* it came from or *when it
expires* — impossible to do proper food-safety expiry management with
that alone.

- **`IngredientBatch`** — a new model tracking each delivery/lot
  separately: batch number, supplier name, quantity received/remaining,
  expiry date. `InventoryItem.quantityOnHand` is kept as the
  authoritative fast-lookup running total (unchanged for anything that
  already reads it), with `IngredientBatch` as the detailed ledger behind
  it.
- **FEFO consumption** — `InventoryService.deductForOrder` now pulls from
  whichever batch expires soonest first, spanning multiple batches if
  needed, and only falls back to an unattributed aggregate deduction if
  no batch is on record (never blocks a sale either way).
- **Expiry warnings** (`/admin/inventory`) — a dedicated "⚠️ Expiring
  Soon" section showing batches within 3 days of expiry, with exact
  day-count messaging ("Expires tomorrow", "Expired").
- **Wastage logging** — traceable to a specific batch (unlike a generic
  stock correction), so "which delivery actually spoiled" is answerable
  from the audit log, not just "stock went down by some amount."
- **Restocking now creates a batch** — both adding a brand-new ingredient
  and restocking an existing one can optionally capture batch
  number/expiry/supplier; a negative correction stays aggregate-only
  (not attributed to a batch, since a miscount isn't a specific
  delivery's fault).
- Supplier tracking here is a plain text field on the batch, not yet a
  full Supplier entity with its own purchase-order history — that's the
  next item on the operational list ("Supplier & purchase management"),
  not built in this batch.

**16 new backend tests** cover FEFO batch-spanning, the null-expiry
sort-last ordering, wastage validation, and expiry-threshold queries.

## Supplier & purchase management + product costing

Third item off the operational-review list — and the one that finally
answers "sales ≠ profit."

- **`Supplier`** — name, phone, address, GST number, payment terms.
- **`Purchase` / `PurchaseLine`** (`/admin/suppliers`) — recording a
  delivery is the *real* source of truth for stock now: each line item
  creates a proper `IngredientBatch` (ties directly into last batch's
  FEFO/expiry system, replacing ad-hoc manual restocks with actual
  purchase records), bumps inventory, and — the key part — updates
  `Ingredient.costPerUnitRs` to the price just paid.
- **Real product costing** (`/admin/costing` + a Costing card on each
  product's editor) — food cost is computed from the recipe
  (`ProductIngredient`) × each ingredient's actual last-purchased price,
  not a guess. Add an optional packaging cost (cup, lid, straw) on top
  for the full picture, and see gross margin — in ₹ and %, sorted
  worst-first — directly answering your "coupons/rewards can accidentally
  destroy margins" concern with a table that surfaces exactly which
  products are at risk.

**Honest scope note**: this computes *food cost*, not full P&L — payment
gateway fees, delivery cost, and platform commission aren't factored in
yet. Bolting those on without real data behind them would just be
guessing dressed up as a number, so it's left out rather than faked.
Supplier is also currently a name string per batch, not yet a full
relational link on every table that could use it.

**19 new backend tests** cover purchase recording end-to-end (inventory
bump, batch creation, cost-estimate propagation) and the margin math,
including the "no purchase price on record yet" case (treated as ₹0
cost and flagged, never silently guessed).

## Food safety checklist module

Fourth item off the operational-review list — internal only, never
shown to customers, kept as your audit trail if a health inspector ever
asks for one.

- **Fully admin-editable checklist** (`/admin/food-safety`), not
  hardcoded — seeded with the standard daily items from the operational
  review (opening, fridge/freezer temperature, ingredient/egg/milk
  storage checks, cleaning, sanitization, staff hygiene, closing), but
  you can add, reorder, or retire items freely.
- **Temperature items are real numbers, not checkboxes** — fridge and
  freezer checks require an actual reading, validated against a min/max
  safe range set per item. A reading outside that range is automatically
  flagged and computed once at submission time (not re-evaluated later),
  so historical compliance stays accurate even if you later adjust the
  acceptable range.
- **Every submission is attributed and timestamped** — who submitted it,
  which shift (Opening/Midday/Closing), and every individual item's
  result, building a real compliance history rather than a single
  "today's status" toggle.

14 new backend tests cover the temperature-requirement validation,
range-flagging in both directions, and submission attribution.

## Offline-resilient POS

Fifth item off the operational-review list — "what happens if your
internet drops at 8 PM with 10 customers waiting?"

- **Local queue, not a blocked counter** (`frontend/src/lib/offlineQueue.ts`)
  — the POS page detects connectivity loss via the browser's native
  online/offline events and, once offline, saves each sale to
  `localStorage` instead of calling the API. Using `localStorage` (not
  just React state) matters: it survives the tab closing or the device
  restarting mid-outage, not just a network blip.
- **Real duplicate protection, not just client-side hope** —
  `Order.idempotencyKey` (unique, backend-enforced) means the exact same
  queued sale can be safely retried without ever creating two orders,
  even under a genuine race (two sync attempts firing near-simultaneously
  right as connectivity returns). `OrdersService.create()` checks for an
  existing order with the key first, and — the part that actually matters
  — catches the database's own unique-constraint violation if two
  attempts still race past that check, returning the order that won
  instead of erroring or duplicating the sale.
- **Auto-sync on reconnect** — the moment the browser fires its `online`
  event, queued sales replay automatically, in the order they were taken.
  A genuine network failure mid-sync stops the batch (preserving order
  for the next attempt) without hammering the server; a business-logic
  failure (e.g. the shop was marked closed) marks just that one sale
  `failed` with the reason shown, and moves on rather than blocking
  every other queued sale behind it.
- The counter always sees what's pending — a status panel lists every
  queued/failed sale with a manual "Sync Now" fallback.

9 new backend tests specifically cover the idempotency logic, including
one that simulates the race condition directly (a database
unique-constraint error mid-creation) to prove the recovery path works,
not just the happy path.

## Cash reconciliation

Sixth item off the operational-review list — "POS sales ≠ cash in
drawer." The backend for this (`CashModule`) was already fully built and
tested; this batch added the missing admin UI (`/admin/cash`) and
finished validating the whole thing end to end.

- **One open shift at a time** — open with a counted starting float,
  close by counting the actual cash. Only one shift can be open,
  preventing two counters from silently double-tracking the same drawer.
- **Real expected-cash math, not a guess** — opening float + actual CASH
  sales − actual CASH refunds − logged expenses, all scoped to the
  shift's exact time window, computed from the real `Payment` and
  `Refund` tables rather than any separately-tracked running total that
  could drift out of sync.
- **The difference is the number that actually matters** — logged at
  close time and never recomputed afterward, so a reconciliation report
  stays accurate even if something related happens later (e.g. a refund
  against an order from that shift gets processed after close).
- **Cash expenses require a note** — every payout from the drawer during
  a shift (an emergency ingredient run, etc.) is logged with a reason, so
  it's accounted for in the expected-cash math instead of silently
  becoming an unexplained "difference."

18 backend tests already covered this module: shift-open validation
(rejecting a negative float or a second concurrent shift), the exact
expected-cash formula, and the close-time snapshot behavior.

## Privacy & data management

Seventh item off the operational-review list, and the last one for now —
`/account` for customers, covering everything the review flagged.

- **Delete account** — a real "right to erasure" flow, not a fake button.
  Clears name, photo, address, gym, goals, and (entirely, not just
  anonymized) allergy/health data, cancels any active membership so the
  daily cron never tries to bill a deleted account, clears phone/email,
  and revokes access the same way staff deactivation already does. A
  deliberate choice, stated plainly: Order/Payment/Refund records are
  **kept**, not deleted — most jurisdictions require retaining financial
  records regardless of an account-deletion request, and once the
  Customer profile is scrubbed those records no longer carry any
  identifying information anyway.
- **Export my data** — one JSON download covering orders, nutrition
  logs, points, allergies, achievements, reviews, memberships, and more.
- **Change phone/email** — real OTP verification against the *new*
  number/email before the change takes effect, reusing the same OtpCode
  infrastructure as login but under a distinct purpose so a login code
  can never be replayed here.
- **Marketing/notification preferences** — a customer can opt out of
  marketing at any time without affecting transactional messages (OTPs,
  order confirmations), which are never gated by this flag.
- **Delivery GPS retention was checked, not just assumed** — traced the
  actual code path and confirmed live rider location already only
  stores the *latest* ping (overwritten each time), never an
  append-only historical trail. Nothing needed fixing there.

**Caught and fixed a real bug in this same batch**: the first version of
the `/account` page read a response shape that didn't match what the
API actually returns (`dashboard.customer.name` vs. the dashboard's real
flat structure) — caught during validation, before shipping, by tracing
the actual backend return type rather than assuming.

8 new backend tests cover the account-deletion data-scrubbing scope, the
OTP contact-change flow (including rejecting an identifier already
claimed by another account), and the corrected dashboard shape.

## AI medical-safety guardrails

The final item from the original "must have before launch" list. The AI
assistant already had one general line about medical questions — this
batch made it a real, layered safety system instead of a single sentence
of hope.

- **Explicit red-line categories in the system prompt** — pregnancy/
  breastfeeding, diabetes, kidney disease, liver disease, medication
  interactions, severe/anaphylactic allergies, and a child's diet each
  get called out by name, with a hard rule: no specific numeric
  nutrition target, dosage, or medical recommendation for any of them —
  general information only, plus a clear referral to a doctor,
  registered dietitian, or pediatrician.
- **Defense in depth, not just one prompt** — a lightweight keyword
  detector scans the customer's latest message for these same
  categories. When one matches, a second, more forceful reminder is
  injected into that turn's system prompt specifically, on top of the
  baseline rule — so even if a long conversation has diluted the
  original instructions, the reinforcement is fresh right when it's
  needed most.
- **Real oversight, not blind trust** — every match is logged (customer,
  matched categories, a truncated excerpt — not a full transcript) and
  visible to the shop owner at `/admin/ai-safety`, so there's an actual
  answer to "how often does this come up" instead of just hoping the
  prompt holds.
- **Never blocks the chat** — if the safety-flag write itself fails
  (database hiccup), the customer still gets their answer; logging
  failure is swallowed and warned, never surfaced as a broken chat.
- Tightened the existing "menu is the only source of truth" rule too —
  the AI was already grounded in the real product catalog, but the
  instruction now explicitly forbids inventing a product, price, or
  nutrition figure, closing a wording gap rather than a behavioral one.

**This was also a real gap closed, not just an enhancement**: the AI
module had zero test coverage before this batch. 20 new tests now cover
every category's keyword detection, multi-category messages, checking
only the *latest* message (not earlier history), excerpt truncation,
and confirming a logging failure never blocks the actual response.

## Kitchen Display System

First item off the "should have" tier. A genuinely separate,
distraction-free screen (`/admin/kitchen`) — not the full admin
dashboard with a filter applied.

- **Kanban columns**: New → Accepted → Preparing → Ready, each order
  advancing with one tap. Reuses the existing order-status endpoint, so
  no new state machine was introduced — the kitchen screen is just a
  different lens on the same statuses the rest of the app already uses.
- **Live elapsed-time timer per order** (`MM:SS`, ticking every second
  from when the order was placed) — exactly the "PREPARING — 04:32"
  format from the spec, so kitchen staff can see at a glance which
  orders have been sitting longest.
- **A real allergy warning**, not just the item's own declared
  allergens: if the customer has *any* recorded allergy at all, the card
  shows it prominently — a genuine cross-contamination caution for
  whoever's plating the order, regardless of whether this specific
  item's ingredients happen to overlap.
- **Item + add-on breakdown** per line ("Chocolate Whey — Banana,
  Dates"), pulled from the real order data, not summarized.
- **Live updates via the existing WebSocket gateway** — if a rider or
  the register changes an order's status elsewhere, the kitchen screen
  reflects it instantly without a manual refresh.

**Scope decision, stated plainly**: this is a focused UI, not a new
access-control layer. Kitchen staff still log in through the same ADMIN
role and JWT as the rest of the admin panel — there's no separate
"Kitchen" role or login portal restricting them from seeing costing,
suppliers, or cash reconciliation. Building genuine role separation
would mean a fourth login portal end-to-end (new role, new JWT branch,
new guards, new provisioning flow) — a much bigger lift than this batch,
and not what was asked for. What's built is the actual kitchen-facing
screen the spec described; if real access restriction becomes
important, that's a distinct follow-up.

3 new backend tests cover the kitchen queue query — the status filter,
ordering, and the allergy/add-on data it fetches.

## Better rider assignment

Second "should have" item — and one where I want to be very upfront
about a real constraint I hit, rather than fake a number to look
complete.

**What the doc asked for**: rank riders by on-duty + available +
distance + workload + ETA, using the worked example of a nearer-but-busy
rider losing out to a farther-but-free one.

**What's actually measurable in this system, and what isn't**: there is
no coordinate data anywhere for an idle rider (a rider only ever reports
`lastLat/lastLng` once they're already mid-delivery — see
`DeliveryOrder`), and delivery addresses are plain text with no
geocoding. So true distance/ETA ranking isn't something this system can
honestly compute yet — building it would mean adding a geocoding
dependency and continuous idle-location tracking, neither of which
exists. Rather than fabricate a distance number from data that doesn't
exist, I built the ranking from what's real:

- **`GET /admin/delivery-personnel/available`** now ranks on-duty riders
  by current active-delivery count (fewest first — directly the doc's
  own point: a busy-but-close rider shouldn't jump the queue ahead of a
  free one), tie-broken by longest idle time since their last delivery,
  so work rotates fairly instead of always landing on the same rider.
- **`PATCH /admin/orders/:id/assign-best-rider`** — one-click "⚡ Best"
  button on `/admin/orders` that assigns the top of that ranking
  directly, alongside the existing manual dropdown (which now shows each
  rider's current workload inline, so a manual choice is an informed one
  either way).

8 new backend tests cover the ranking (workload ordering, idle-time
tie-breaking, a never-delivered rider correctly sorting as maximally
idle) and the auto-assign flow, including rejecting cleanly when no
rider is on duty.

## Delivery failure handling & delivery OTP

Third "should have" item — the full flow from the spec:
Assigned → Picked up → Out for delivery → Arrived → Delivered, plus real
failure states and a handoff code that actually reduces disputes rather
than just adding a step.

- **`ARRIVED` checkpoint** — a genuine state between "out for delivery"
  and "delivered," both in `OrderStatus` and on the rider's own app.
- **Delivery OTP, verified server-side** — a 4-digit code generated for
  every delivery order at creation, shown to the customer on their
  tracking page. The rider cannot mark an order `DELIVERED` without
  entering the matching code — this is the actual dispute-reduction
  mechanism the spec asked for, not just a UI field that doesn't do
  anything.
- **A real bug I caught myself while building this**: the rider's own
  "my assigned orders" endpoint had no explicit field selection, which
  meant the raw OTP value would have been sent straight to the rider by
  default — completely defeating the point of the handoff check (a
  rider who can already see the code doesn't need the customer to give
  it to them). Found by tracing the actual query shape rather than
  assuming, and fixed before it shipped: the OTP is now explicitly
  stripped from what the rider's app receives.
- **Real failure states**, matching the spec's exact list — customer
  unavailable, wrong address, customer cancelled, rider issue, vehicle
  issue, restaurant delay, other — reportable by the rider mid-delivery,
  distinct from a cancellation (`OrderStatus.FAILED`, not `CANCELLED`):
  a failure means a delivery was genuinely attempted and couldn't be
  completed, which matters for the shop owner's own operational
  reporting even though both still flow through the same refund logic
  for whatever was paid.
- Customer tracking page shows the live step (including Arrived), the
  handoff code once relevant, and a clear message if a delivery failed.

11 new backend tests cover the OTP requirement (including the "no code
on record" defensive case), the ARRIVED transition, the failure-report
validation (wrong rider, ineligible order status, missing reason), and
— importantly — a dedicated test proving the OTP never reaches the
rider's own order list.

## Notification center

Fourth "should have" item — a real in-app inbox, not just ephemeral
toasts or emails the customer might have missed.

- **`/notifications`** — a persistent, readable history of order
  updates, achievement unlocks, and shop announcements, with an unread
  badge on the 🔔 in the nav.
- **Integrated at the source, not bolted on separately**: order-update
  notifications are created *inside* the existing
  `OrdersGateway.emitOrderStatusUpdate` — every place that already calls
  it (orders, delivery, refunds, admin rider assignment) gets in-app
  notifications automatically, with zero changes needed at any of those
  call sites. Achievement notifications are created inside the existing
  unlock transaction, so a failure there correctly rolls back the whole
  unlock instead of silently losing the notification.
- **`/admin/announcements`** — broadcast a message to every active
  customer (e.g. "closed tomorrow for maintenance"), with a send
  history separate from the fan-out itself.

**A genuinely serious bug found and fixed along the way, unrelated to
this feature**: while adding a routine reverse relation to the `User`
model, discovered the Prisma schema was already broken —
`cashSessionsOpened`/`cashSessionsClosed` referenced a
`CashDrawerSession` model that was never actually created (the real
cash-reconciliation module uses `CashShift`). This meant `prisma
generate`/`migrate` would have failed outright the next time either ran
— a latent bug from earlier in this project that had gone unnoticed
until now. Traced the real model's actual relation names, fixed the
dangling references, then ran a systematic check (every named
`@relation` should appear exactly twice) across the *entire* schema to
confirm nothing else was similarly broken.

Also caught a real syntax bug of my own mid-build: an early version of
the gateway edit landed a `const` declaration between the `@Injectable()`
and `@WebSocketGateway()` decorators — invalid TypeScript. Caught by
`tsc`, not shipped.

19 new backend tests cover the fan-out broadcast, ownership checks on
marking a notification read, the idempotent achievement-notification
behavior, and the gateway's fire-and-forget failure handling.

## Staff shift management

Fifth "should have" item. Your operational review actually described two
different things under this one heading — cash opening/closing balance
and discrepancy (already fully built by the earlier Cash Reconciliation
batch, via `CashShift`) and clock in/clock out attendance tracking
(genuinely missing until now). This batch adds the missing half.

- **`StaffShift`** — a real, deliberately separate model from
  `CashShift`: a staff member's worked hours and a till's cash session
  aren't the same thing. Kitchen staff clock in without ever touching a
  drawer; several staff can share one cash shift across a day while each
  clocks their own hours independently.
- **One open shift per person at a time** — clocking in while already
  clocked in is rejected, same for clocking out with nothing open.
- **A `ClockWidget`** in both the admin sidebar and the delivery rider
  app — same component, same backend, since counter/kitchen staff
  (`ADMIN` role) and riders (`DELIVERY` role) both track their own hours
  through the identical self-service flow. Shows a live running timer
  while clocked in.
- **`/admin/staff-shifts`** — every shift across every staff member and
  rider, with computed duration and a clear "still clocked in" flag for
  open shifts — the oversight view for payroll/attendance.

Also re-ran the full named-relation integrity check across the schema
after this addition (the same one that caught the `CashShift` bug last
batch) — confirmed clean.

11 new backend tests cover the one-open-shift enforcement in both
directions, the admin-wide (unscoped) query, and date-range filtering.

## Support ticketing

Sixth "should have" item, and the last from the original operational
review's list — a real threaded conversation per issue, not just an
email address.

- **`/support`** (customer) and **`/admin/support-tickets`** (admin) —
  create a ticket, thread of messages back and forth, status badges
  (Open/In Progress/Resolved/Closed).
- **Status transitions are automatic where it makes sense, explicit
  where it doesn't**: an admin's first reply advances Open →
  In Progress automatically (they're clearly working on it now); a
  customer replying to a Resolved or Closed ticket automatically
  reopens it (a reply after "resolved" means it wasn't actually
  resolved). Marking something Resolved or Closed, by contrast, is
  always an explicit admin action — never inferred.
- **Real integration with the notification center**, not a silo: an
  admin reply calls the `notifyCustomer()` method added to
  `NotificationCenterService` specifically for reuse by other modules,
  so the customer gets an in-app notification the moment support
  responds — exercising the reusability that was the actual point of
  building that method last batch, not just adding a fourth
  `prisma.notification.create` call site to maintain separately.
- Ownership is checked on every customer-facing read/write — a customer
  can only ever see or reply to their own tickets.

Re-ran the schema-wide named-relation integrity check one more time
after this addition — still clean.

23 new backend tests cover the automatic status transitions in both
directions, ownership enforcement, and — importantly — a direct
assertion that an admin reply actually calls the notification service
with the right arguments, not just that it doesn't throw.

## Running it without your own computer (Replit)

See **[REPLIT.md](./REPLIT.md)** for the full guide — lets you view and
use the app from a URL on any device, without your own machine needing
to stay on. Two real bugs surfaced and got fixed while setting this up,
worth knowing about regardless of whether you use Replit:

- **`backend/package.json`'s `start:prod` script pointed at the wrong
  file** (`dist/main` instead of the real compiled output at
  `dist/src/main.js`) — confirmed by actually running a real build, not
  assumed. This would have silently failed on *any* real production
  deployment, not just Replit; `tsc --noEmit` and Jest both structurally
  can't catch it, since neither one runs the production start script.
  Fixed.
- Added a root-level `package.json` (with a `concurrently`-based `dev`
  script) so both servers can be started together with one command —
  useful for Replit specifically, but also just a nicer way to run this
  locally if you'd rather not open two terminals.

## Running it on your phone

Both servers already bind correctly for this — the backend listens on
`0.0.0.0` (not just `localhost`), and there's a real PWA manifest, so
this installs as an actual app icon on your home screen, not just a
bookmark. Three things need pointing at your PC's real network address
instead of `localhost`, since your phone and PC are different devices
even on the same WiFi.

1. **Find your PC's local IP address.**
   Windows: open Command Prompt, run `ipconfig`, look for "IPv4
   Address" under your WiFi adapter (something like `192.168.1.42`).

2. **Tell the backend to accept requests from that address**
   (`backend/.env`):
   ```
   FRONTEND_URL="http://192.168.1.42:3000"
   ```
   Without this, the backend's CORS check rejects every request from
   your phone — it only trusts `http://localhost:3000` by default.

3. **Tell the frontend where the backend actually is**
   (`frontend/.env.local`):
   ```
   NEXT_PUBLIC_API_URL="http://192.168.1.42:4000/api"
   ```
   Without this, your phone would try to reach `localhost:4000` —
   which on a phone means "the phone itself," not your PC.

4. **Start both servers as usual** (`npm run start:dev` in backend,
   `npm run dev -- -H 0.0.0.0` in frontend — the `-H 0.0.0.0` makes
   sure the dev server listens on your network, not just the PC itself).

5. **Windows Firewall** will likely prompt the first time either server
   starts — allow access on **Private networks**. If your phone still
   can't connect after setting everything above, this is the usual
   culprit.

6. **On your phone** (same WiFi as the PC), open
   `http://192.168.1.42:3000` in the browser. From there, use the
   browser's "Add to Home Screen" — the manifest is already set up for
   a real standalone app experience, not just a browser tab.

Your PC's IP can change between reboots on some routers — if it stops
connecting later, re-run `ipconfig` and update both `.env` files if the
address changed.

## Rebrandable template

Requested making this reusable as a template for a different
protein/nutrition-shake business, just by "updating the details" — see
**[REBRANDING.md](./REBRANDING.md)** for the full guide. Summary of what
changed:

- **Colors**: every Tailwind class was still named `pp-*` (literally
  "Protein Panda"'s initials) despite the underlying hex values already
  being centralized — renamed all 54 files' worth of classes to generic
  `brand-*` names.
- **A real gap found**: `ShopSettings` already had `businessName`,
  `tagline`, `logoUrl`, and color fields in the database — with a schema
  comment explicitly stating this was "the whole point of this being a
  template" — but the admin Settings page never actually exposed any of
  them in the UI, and the colors were never wired up to affect anything
  even when set. Added the missing form fields and built
  `BrandThemeInjector`, which applies admin-configured colors as CSS
  custom properties at runtime — changing colors in Settings now
  re-themes the whole site immediately, no rebuild, completing what the
  schema had already promised but never delivered.
- **New `frontend/src/lib/siteConfig.ts`** — the single source of truth
  for business name/tagline/mascot/currency in the handful of places
  that render before any API call resolves (page title, login screens),
  env-var overridable.
- Threaded this through all 14 frontend files that had hardcoded
  "Protein Panda" text — nav, footer, checkout, AI assistant widget,
  achievement sharing, delivery map, and more. Zero hardcoded mentions
  remain in `frontend/src`.
- **A genuinely broken pre-existing test found while validating**:
  `auth.service.spec.ts` still asserted a default signup name of
  `'Protein Panda Member'`, but the real code already just says
  `'Member'` — a stale test from earlier work, unrelated to this batch.
  Fixed to match reality.
- Confirmed the backend's remaining "Protein Panda" mentions are
  legitimate — safety-net fallback values used only if `/admin/settings`
  is never configured, already correctly wired to defer to the live
  database value first.

## PDF invoices, reward vouchers, and POS receipts

Asked for downloadable PDF invoices after order/reward purchases, plus
POS-style billing. The backend for this — `PdfModule`, using `pdfkit`
— was already fully built (80mm thermal-receipt-width PDFs, real order
invoice generation, real reward-voucher generation, ownership checks on
every customer-facing route) from earlier in this session. What was
missing was the same pattern found repeatedly throughout this build:
**zero frontend integration** — not one page linked to any of it.

- **`/orders`** — "📄 Download PDF" next to each order's bill
- **`/admin/orders`** — "📄 Receipt" per order row (reprint any order,
  any time)
- **`/admin/pos`** — "📄 Print / Download Receipt" right on the
  sale-complete screen — this is the actual POS billing request: a
  real, thermal-receipt-formatted PDF the moment a counter sale
  finishes, itemized with subtotal/discount/total/payment method
- **`/rewards`** — "📄 Voucher" on each redemption, a verification-code
  voucher a customer shows at the counter to claim their reward

**A real bug caught while wiring this up**: the POS page only stored
`orderNumber` after a sale (a display string), not the actual order
`id` the PDF route needs. Fixed by storing both, not just patching the
symptom.

Every PDF route was already ownership-checked server-side before I
started — a customer can't download another customer's invoice or
voucher by guessing an ID; verified this by reading the actual
controller code, not assumed.

## POS billing: coupon discounts and reward-points redemption

Asked whether admin can apply a discount or points redemption while
billing at the counter. Honest answer at the time: the coupon-discount
logic already existed on the backend but had zero UI; points/reward
redemption didn't connect to billing at all — a customer could redeem
points for a reward, but nothing tied that redemption to an actual
order or POS sale. Both are now real:

- **`RewardRedemption.orderId`** — a redemption now records which order
  it was actually applied to. This is the real enforcement against
  reusing the same redemption twice, not just a UI nicety.
- **`OrdersService.create()`** accepts a `redemptionId` alongside the
  existing `couponCode` — validates it belongs to the customer, hasn't
  been used, and is a `DISCOUNT`-type reward (deliberately scoped:
  `FREE_ITEM`/`FREE_ADDON` rewards aren't a flat rupee amount, so
  applying them automatically here risked getting the math wrong —
  those stay handled manually via the voucher PDF, a real limitation
  stated plainly rather than papered over). Coupon and reward discounts
  **stack**.
- **`/admin/pos`** now has a coupon-code input and, once a customer is
  selected, a dropdown of their unused discount vouchers (fetched live
  via a new `GET /admin/pos/customers/:id/redemptions` route) — both
  flow straight into the sale.

8 new backend tests cover ownership checks, the already-used rejection,
the non-DISCOUNT-type rejection, discount stacking, and — the one that
actually matters — that the redemption gets marked used and linked to
the resulting order.

## Deep test — a real boot, not just type-checks

Everything validated all session was `tsc --noEmit` + Jest unit tests
with a mocked Prisma client — real, but it never proves the app
actually **boots**. Went further this time: installed a real
PostgreSQL 16 server, then attempted true end-to-end integration
testing.

**What blocked full integration testing, honestly**: Prisma needs to
download a compiled query-engine binary from `binaries.prisma.sh`, and
this sandbox's network is locked to npm/PyPI/GitHub/Ubuntu's own
package archives — that domain isn't reachable here. This is a sandbox
limitation, not a bug in the app; your own machine has full internet
access and this exact `npm install && npx prisma migrate dev` flow
will work there without any of this.

**What was still achievable, and genuinely new**: booted the real
NestJS application — every one of the ~34 modules built across this
entire session wired together through Nest's actual dependency
injection (never exercised by Jest, which constructs services directly
and bypasses DI entirely), every route across every controller mapped
successfully, the server started, and a real HTTP request through the
live pipeline returned `200 OK`. Zero DI wiring errors — a genuinely
meaningful result for an app this size built incrementally.

**One real bug found and fixed as a direct result**:
`RedisService` extended `ioredis.Redis` with no `error` event handler
at all — a Redis connection blip (a restart, a brief network hiccup)
would fire an unhandled `error` event on that EventEmitter, which can
escalate to crashing the whole API process over what should be a
recoverable outage. This surfaced immediately as repeated
"Unhandled error event" log spam the moment the real app booted without
Redis available — a class of bug a mocked unit test structurally cannot
catch, since it depends on real EventEmitter behavior. Fixed with a
proper logged error handler, and made the games leaderboard read
degrade to an empty result instead of throwing if Redis is ever
unreachable (matching the safety pattern the points-service write already
used). 2 new tests cover this resilience specifically.

## Postman-style deep bug sweep

Booted the real app again and hit it with real HTTP requests across
public routes, protected routes (with and without a valid JWT),
malformed bodies, and nonexistent-resource lookups — the same thing
Postman would do, just scripted. Two real, concrete findings, both
fixed:

- **`GET /products/:slug` for a slug that doesn't exist returned
  `200 OK` with a `null` body**, instead of a proper `404`. Confirmed
  with a real request, fixed by explicitly checking for `null` and
  throwing `NotFoundException` (not just switching to
  `findUniqueOrThrow`, which would've traded this bug for a generic
  `500` instead of a clean `404`). Then swept the **entire backend** for
  every other plain `findUnique` call (not `findUniqueOrThrow`) to check
  whether this was a one-off or systemic — it was a genuine one-off;
  every other instance already null-checks or falls back correctly.
  Re-verified the fix with a live request afterward, not just the test
  suite: `curl` now returns `404` with a clear message.
- **Confirmed the Redis fix from the previous session works correctly
  under a real boot** — clean, labeled warnings instead of raw
  "Unhandled error event" spam. Also added a bounded retry backoff
  (`retryStrategy` capped at 10s, `maxRetriesPerRequest: 3`) so a
  genuinely dead Redis — not just a blip — settles into calm periodic
  retries instead of hammering the connection indefinitely.

Also confirmed clean: every protected route correctly returns `401`
without a token (checked customer, admin, and delivery routes), the
validation pipe correctly rejects malformed input with `400` and a
clear message, and a forged-but-validly-signed JWT for a nonexistent
user is correctly rejected rather than let through. The server stayed
up through the entire sweep, including the malformed-input and
nonexistent-resource cases — no other crashes found.

2 new tests lock in the 404 fix specifically — one confirming the
`NotFoundException`, one confirming a real match still returns normally.

## Deep sweep round 2 — POS/cash/delivery flows, and a systemic fix

Continued the bug hunt into stateful multi-step flows (open a cash
shift → log an expense → close it; assign a rider → deliver with OTP),
which needed a genuinely stateful test double (an in-memory store), not
just fixed canned responses — the previous stub couldn't remember
anything between calls, which is fine for single-request checks but not
for testing a real sequence.

**Cash shift flow — fully verified correct, no bugs:** open (₹2000) →
duplicate-open correctly rejected → log a ₹150 expense → zero-amount
and empty-note expenses both correctly rejected → close with ₹1900
actual → correctly computed `expected: ₹1850, difference: +₹50`. Real
math, exercised end-to-end, all correct.

**Delivery flow — found something much bigger than one bug.** Hitting
`PATCH /delivery/:id/status` with a nonexistent delivery-order id
returned a raw `500`, not a clean `404`. Traced it to the same root
cause as the `products.getBySlug` bug from the last round — but this
time, instead of just patching this one call site, searched the entire
backend for the same pattern and found **~40 places** using
`findUniqueOrThrow`/`findFirstOrThrow` uncaught. Patching each
individually would be slow and easy to get inconsistent or miss one, so
this got a proper systemic fix instead: a global
**`PrismaExceptionFilter`** that catches Prisma's "record not found"
error class anywhere in the app and converts it to a clean `404`,
automatically — for all ~40 existing call sites and any future one,
with zero risk of a missed spot. Verified live: the exact three delivery
routes that previously 500'd now correctly return 404, and a
double-check confirmed normal `400` validation errors are completely
unaffected by the new filter.

3 new tests cover the filter directly — the 404 conversion, that the
raw internal Prisma message is never leaked to the client, and that a
*different* Prisma error code correctly still falls through to a 500
(not every Prisma error means "not found").

## Preparing for higher concurrent login volume

Asked to push toward ~1000 concurrent logins/sec. Being direct about
what code can and can't do here: **no code change makes this number
actually happen** — that depends entirely on the real server hardware
this runs on (CPU cores for bcrypt, database capacity, likely multiple
instances behind a load balancer), which is outside anything in this
repository. What code *can* do is remove the one genuine architectural
blocker that would silently cap throughput regardless of how much
hardware you throw at it:

- **Rate limiter is now Redis-backed** (`@nest-lab/throttler-storage-redis`),
  not the library's in-memory default. This matters specifically once
  this app runs as more than one server process — with in-memory
  storage, every instance tracks its own separate counters, so a
  "5 requests/minute" limit silently becomes "5 × however many
  instances," since each instance thinks it's the only one that's seen
  a given request. Redis makes the limit a single, correct, shared one
  across every instance, however many you run.
- **Falls back cleanly to in-memory storage if `REDIS_URL` isn't set**
  — this doesn't force a Redis dependency onto a single-instance
  deployment that doesn't need it; verified via a real boot test that
  the app starts correctly either way.
- Also lowered the OTP bcrypt cost (10 → 8, see the earlier "How many
  logins per sec" discussion) — a real, meaningful per-operation
  speedup that compounds with horizontal scaling rather than competing
  with it.

**What this doesn't include, said plainly**: multiple running server
instances, a load balancer, and a properly provisioned (not
hobby-tier) database are real infrastructure decisions outside what a
codebase can configure for you. This makes the code *ready* to scale
correctly if you provision that infrastructure — it doesn't provision
it for you.

## Production-readiness checklist — round 2

Continuing the list from the previous round.

**🟠 #7 E2E testing + #8 Cross-browser testing** — real Playwright
suite in `/e2e`, covering the full customer journey (login → menu →
cart → checkout → order confirmation) plus fast smoke tests, running
against Chrome, Firefox, Safari, and mobile viewports in one
configuration. Needed a real design decision to make OTP login
E2E-testable at all: OTP codes are bcrypt-hashed before storage and are
never retrievable in plaintext afterward (a real security property, not
a gap) — so a fixed bypass code (`000000`) is now accepted **only**
when `E2E_TEST_MODE=true` is explicitly set, which must never happen in
a real deployment. 3 new backend tests lock in that this bypass is
properly gated and cannot silently activate.

**Stated plainly**: these E2E tests are real, valid, type-checked
Playwright specs — but they have not been run successfully against a
live deployment, because none exists yet in this environment. "Written
correctly" and "verified passing in production" are different claims.

**🟠 #12 Security hardening (continued)** — Fastify's `@fastify/helmet`
now sets real security headers on the backend (HSTS, X-Frame-Options,
etc.); Next.js's own header config does the same for the frontend,
since it's the one actually serving HTML.

**🟡 #16 Error/maintenance UX** — found this was a real, concrete gap
while writing the E2E 404 test (no custom `not-found.tsx` existed).
Built three real Next.js error boundaries: a branded 404 page, a
recoverable runtime-error page (`error.tsx`, with a working "Try
Again"), and a dependency-free fallback for the rare case where the
root layout itself crashes (`global-error.tsx`, required separately by
Next.js — `error.tsx` alone can't catch that case).

**🔴 #6 CI/CD** — GitHub Actions pipeline: type-checks, tests, and
builds both backend and frontend on every push, against a real
ephemeral Postgres, plus a dependency vulnerability scan. The E2E job
is wired in but deliberately gated to manual trigger only, since it
needs a real deployed URL to test against that doesn't exist yet —
flip it on once you have a staging environment.

## Background job queue (BullMQ + Redis)

Following up on the architecture recommendations doc — added the one
item from it that was genuinely missing and high-value: async
background jobs, so a slow email send can't hold anything up or get
silently lost.

- **Real BullMQ queue** (`backend/src/queue/`) for invoice/e-bill
  emails — 3 retry attempts with exponential backoff, and durable
  (survives a server restart mid-send), replacing what used to be a
  synchronous fire-and-forget call with no retry at all.
- **Genuine resilience, not just wired blindly**: if Redis is
  unreachable at the moment of enqueueing, it falls back to the exact
  old direct-call behavior rather than losing the email — the same
  "infrastructure failure never breaks a core user action" principle
  used everywhere else Redis appears in this app.
- **A deliberate distinction, not an oversight**: order-creation and
  payment-confirmation emails (background, nobody's watching) now go
  through the queue. The "resend my bill" button a customer explicitly
  clicks still calls the email service directly — someone actively
  waiting for confirmation their click worked is exactly the wrong case
  to queue.
- The same process that runs the API also runs the queue worker — no
  separate deployment needed at this app's scale.

**On the rest of that document's recommendations** (message queue was
the one clear gap; the doc itself correctly says not to add Kafka/
RabbitMQ/Elasticsearch/etc. "just to look advanced" — full caching,
CDN, and load balancing remain real hosting-infrastructure decisions,
not code that ships in a zip file).

6 new tests cover the queue-with-fallback logic directly, including the
case where both the queue *and* the fallback fail — proving the outer
call never throws either way.

## SEO (checklist item #10)

Fully code-buildable, no external accounts needed — done.

- **Real `robots.txt`** — allows the genuinely public pages, blocks
  admin/delivery/account/orders/support from being crawled at all. This
  isn't just cosmetic SEO hygiene: an admin login page showing up in
  Google is a real information-leak risk.
- **Real dynamic `sitemap.xml`** — deliberately short (home + menu
  only). Everything else in the app is either login-gated or
  constantly-changing transactional content (checkout, rewards, the
  leaderboard) — padding a sitemap with those doesn't improve SEO, it
  just wastes Google's crawl budget on pages with nothing to rank for.
- **Proper page titles** — a title template so every page reads "Menu |
  Protein Panda" instead of every single page saying just the business
  name, a common and easy-to-miss real mistake.
- **OpenGraph + Twitter card metadata** — what actually controls how a
  shared link looks in WhatsApp/Twitter/Slack previews, not just how it
  looks in a browser tab.
- **Structured data (JSON-LD)** on the homepage — `FoodEstablishment`
  schema, the thing that can get a business a real rich result in
  search. Deliberately kept to static values, not fetched from live
  `ShopSettings` — the homepage should never fail to render because a
  backend API call hiccuped; fill in the real address/hours once you
  have them, or wire it to a live fetch if you're comfortable with that
  tradeoff.
- **New `frontend/.env.example`** — didn't exist before this; every
  `NEXT_PUBLIC_*` variable actually referenced anywhere in the frontend
  codebase, consolidated in one place for the first time.

Verified the actual generated output, not just that the build
succeeded — `robots.txt` and `sitemap.xml` both produce real, correct
content.

## Legal pages (checklist item #15)

Real content, not placeholder Lorem Ipsum — written by actually tracing
the real backend behavior for each claim, not generic boilerplate:

- **`/privacy-policy`** — the data-collection list matches what the
  schema actually stores (allergies, nutrition logs, rider location
  only while a delivery is active), the third-party sharing section
  names the real integrations (Razorpay, Anthropic for the AI
  assistant), and the "your rights" section links to genuinely working
  buttons (Download My Data, Delete My Account) rather than promising
  something that isn't real yet.
- **`/terms`** — the cancellation window described (self-cancel while
  `RECEIVED`/`ACCEPTED`, contact support after) matches
  `SELF_CANCEL_ALLOWED_STATUSES` in the real refunds service, not a
  guess.
- **`/refund-policy`** — matches the real refund logic exactly: a
  refund's method always mirrors the original payment method
  (Razorpay for online, cash at the counter for cash), and points are
  automatically reversed on cancellation. **This one matters
  operationally, not just legally** — Razorpay requires a live
  Refund/Cancellation Policy page as part of business/KYC verification,
  so this is now a real blocker removed, not just a nice-to-have.

All three carry a clear, prominent disclaimer that this is a template
reflecting real app behavior, not a substitute for actual legal review
— I'm not a lawyer, and jurisdiction-specific requirements vary too
much to claim otherwise.

**Found and fixed a real leftover bug while in this file**: the
footer's brand name and tagline were still hardcoded ("PROTEIN PANDA",
"Eat Clean. Stay Strong. Be Better.") instead of reading from
`siteConfig` — a rebranding gap that had survived the earlier
de-hardcoding pass, caught only because I happened to be editing the
same file for an unrelated reason.

## What's stubbed vs. real

- **Real**: schema, auth (OTP+JWT), RBAC guards, order transaction
  (allergen check → pricing → nutrition log → points → streak → goal
  progress), points ledger, streak logic, games/leaderboard, rewards
  redemption, admin overview, delivery-scoped views, brand-themed pages,
  live order status (WebSockets), shake customization, Razorpay payments,
  AI nutrition assistant, shop open/close status, delivery on/off duty +
  live GPS tracking, membership/subscriptions (real cron-driven recurring
  orders), achievements, reviews + delivery ratings, real OTP dispatch
  (Gmail + MSG91), XP/levels, monthly reports, gym-vs-gym leaderboard,
  shareable achievement cards, e-bill invoices, expanded POS analytics,
  unit tests for the core business logic (496 tests).
- **Stubbed / TODO for you or a developer to fill in**:
  - React Native/Expo mobile app (PWA works today via "Add to Home Screen")
  - Full admin CRUD UI for inventory/staff (products CRUD exists)
  - Swiggy/Zomato order ingestion (depends on what APIs they expose)
  - Frontend tests (backend has unit test coverage; frontend does not yet)
  - Delivery assignment matching (admin currently assigns riders manually
    via Prisma Studio — no "nearest available rider" auto-assign UI yet)
  - Membership items don't support shake customisation (Base/Flavour/
    Liquid/Add-ons) yet — plans use simple product+quantity only
  - No refund flow, no coupon management UI

## Next steps

Everything from the original build order is in place, plus two large
follow-up batches: (1) AI nutrition assistant, shop open/close, delivery
on/off duty, live GPS tracking; (2) memberships/subscriptions,
achievements, reviews + delivery ratings. From here it's mostly the
stubbed items above — e.g. frontend tests, full admin CRUD for
inventory/staff, delivery auto-assignment, or the native mobile app.
