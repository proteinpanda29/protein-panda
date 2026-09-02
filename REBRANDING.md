# Rebranding this template for your own business

This app started as "Protein Panda" but was built to be reused for any
protein/nutrition-shake business — swap the details below and relaunch
under your own name, with no other code changes required.

## What you can change without touching any code

Everything in this section is admin-editable at **`/admin/settings`**
once the app is running, and takes effect **immediately, with no
rebuild**:

- Business name
- Tagline
- Logo URL
- Primary color, accent color, background color
- Contact phone/email, address, WhatsApp number, social links
- FSSAI license number
- Opening hours

Log in as admin, go to Settings, fill these in, done. This is the
recommended path for 95% of a rebrand.

## What you should set before first launch (optional, but nicer)

The site ships with sensible defaults so it works immediately even if
you skip this — but for a cleaner first impression, set these
environment variables before your first deploy. They only affect
static/server-rendered text that can't wait for a client-side fetch
(the page `<title>`, the login screens, the nav bar on first paint) —
everything else already reads live from `/admin/settings` above.

**`frontend/.env.local`:**
```
NEXT_PUBLIC_BUSINESS_NAME="Iron Fuel"
NEXT_PUBLIC_TAGLINE="Strength starts here."
NEXT_PUBLIC_MASCOT_EMOJI="💪"
NEXT_PUBLIC_CURRENCY_SYMBOL="₹"
NEXT_PUBLIC_ASSISTANT_NAME="Iron Fuel Assistant"
NEXT_PUBLIC_PRIMARY_COLOR_HEX="#D62828"
```
All defined in `frontend/src/lib/siteConfig.ts` — that file is the
single source of truth if you'd rather hardcode values than use env
vars.

Once you log in and set the same values in `/admin/settings`, the
database values take over as the live source of truth; the env vars
above only matter for the handful of places rendered before that first
fetch resolves.

## What you should change directly in code (one-time, per deployment)

- **`frontend/tailwind.config.ts`** — the fallback hex values in the
  `brand-*` color tokens (`brand-primary`, `brand-accent`, `brand-bg`).
  These are what shows before `/admin/settings` colors load, or if you
  never set them there at all. Not required if you're fine with the
  admin-configured colors always taking over.
- **`frontend/public/brand/logo.jpg`** — replace with your own logo
  image file (same filename, or update the reference in
  `frontend/src/app/page.tsx`).
- **`frontend/public/manifest.json`** and **`frontend/public/favicon`**
  files — PWA manifest name/icons, if you want the "add to home screen"
  experience to show your own branding too.

## What does NOT need changing — the domain itself is already generic

This is a protein/nutrition-shake shop template. The XP/level system,
protein-goal tracking, allergen warnings, and nutrition dashboard are
core to that domain and stay as-is — they're not "Protein Panda"
specific, they're "protein shake shop" specific, which is what you're
templating for. If you sell something other than protein shakes
(a general café, a retail store, a service business), this is a much
bigger rework — the product catalog, nutrition tracking, and AI
assistant prompt are all built assuming a protein/fitness food
business.

## A note on the AI assistant

The AI nutrition assistant's system prompt (`backend/src/ai/ai.service.ts`)
already reads `businessName` from your `/admin/settings` value and
grounds every response in your actual live menu/nutrition/allergen data
— no hardcoded "Protein Panda" products can leak into its answers. You
don't need to touch this file for a rebrand; it was built to be
business-name-agnostic from the start.

## Verifying you got everything

After rebranding, run:
```
grep -rln "Protein Panda" frontend/src backend/src
```
This should return **nothing** in `frontend/src` (fully de-hardcoded).
In `backend/src`, it will still show a handful of files — these are
`.spec.ts` test files and service fallback defaults that intentionally
say `'Protein Panda'` as the safety-net value if `/admin/settings` is
somehow never configured. That's correct, expected behavior, not a
leftover — the moment you set your real business name in Settings, none
of those fallback strings are ever actually shown to a user.
