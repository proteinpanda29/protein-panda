# Running this on Replit

This lets you view and use the app from a URL, on your phone or any
device, without your own computer needing to be on. A few things are
genuinely different from running it locally, covered honestly below —
this hasn't been tested inside Replit itself (that requires network
access this build environment doesn't have), so if something in these
steps doesn't match what you see, tell Claude the exact error and it
gets fixed the same way everything else in this project has been.

## 1. Import the project

Upload/import this whole folder as a new Repl (Node.js template).

## 2. Add a real PostgreSQL database

Replit now offers a genuine built-in Postgres database (not just their
old key-value store) — open the **Database** tool in your Repl and
provision one. It sets a `DATABASE_URL` secret automatically; you don't
need to type a connection string yourself.

## 3. Set the other required secrets

In Replit's **Secrets** panel, add:

```
JWT_SECRET=<any long random string>
```

Everything else (email/SMS/AI/payment keys) is optional — the app
already degrades gracefully without them (OTPs fall back to a
dev-console log instead of real SMS/email, the AI assistant simply
won't be configured, etc.) — see the main README's setup section for
the full list if you want those features live too.

## 4. Redis (optional)

There's no built-in Redis on Replit. Two options:
- **Skip it.** The app already handles a missing Redis gracefully — the
  leaderboard just shows empty instead of erroring, nothing else is
  affected.
- **Use a free external Redis** (Upstash is the common pairing with
  Replit) and set `REDIS_URL` to its connection string as a Secret.

## 5. First run

Hit Replit's Run button. The root `package.json` in this project
handles the rest: installs both the backend and frontend, runs the
database migrations, then starts both servers together.

**First run will take a few minutes** — installing dependencies for two
separate Node projects and running migrations both take real time.
Subsequent runs are much faster.

## 6. Find your actual public URL

Once it's running, Replit shows a webview with the live URL — copy it.
**Then set two more Secrets** using that exact URL (Replit's domain
format has changed over the years, so check yours rather than guessing):

```
NEXT_PUBLIC_API_URL=<your Repl's URL>/api
FRONTEND_URL=<your Repl's URL>
```

Then restart the Repl once so both servers pick up the correct URLs —
without this step, the frontend won't be able to reach the backend
(CORS will block it), which is the most likely thing to go wrong on
first setup if something doesn't load.

## 7. Seed some starter data (optional but recommended)

From Replit's Shell tab:
```
cd backend && npx ts-node prisma/provision-staff.ts
```
This creates an admin login (`+910000000001`) and a delivery login
(`+910000000002`) so you have something to log in with immediately.

## What to expect

- The "always on" behavior (staying live when you're not actively in
  the Replit editor) may need a paid Replit plan, depending on their
  current offering — check Replit's own pricing page for the current
  state of this, since it changes.
- If OTP login doesn't receive a real SMS/email (expected unless you
  configured those secrets), check the Replit console output — OTP
  codes print there as a fallback specifically for this kind of setup.
