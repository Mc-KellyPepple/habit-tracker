# Habit Tracker

A small full-stack habit tracker: check habits off daily, get a push
reminder if you haven't. Built to fit entirely in free tiers.

## Why this stack

| Piece | What it does | Why it's needed (not just decorative) |
|---|---|---|
| **React Native (Expo)** | Mobile app — sign in, list habits, check in, add habits | The actual product surface |
| **Supabase** | Auth (magic link), Postgres (habits/check-ins/push tokens), Row Level Security | Every user can only ever see their own rows — enforced at the database, not just in app code |
| **Docker + Render** | A tiny Express service with one real job: find who hasn't checked in and push them a reminder | A phone can't run its own cron job while the app is closed — this is the one piece that genuinely needs a server |
| **VS Code** | `.devcontainer/` gives a consistent, one-command dev environment | Opens straight into a working Node setup with the right extensions already listed |

## Architecture

```
[Expo app] --(anon key, RLS-scoped)--> [Supabase: Auth + Postgres]
                                              ^
                                              | (service-role key, bypasses RLS)
                                              |
[cron-job.org, hourly] --POST /trigger-reminders--> [Express in Docker, on Render] --Expo Push API--> [device]
```

Render's own Cron Jobs are **not available on the free plan** — they're
paid-only. So instead of a background worker, the server is a normal free
web service with one protected HTTP endpoint, and a free external
scheduler (cron-job.org) calls it once an hour. That external ping also
happens to solve Render free tier's "sleeps after 15 min idle" behavior —
the scheduled call is what wakes it back up.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Go to the SQL Editor, paste in `supabase/schema.sql`, run it.
3. Go to Authentication → Providers → make sure **Email** is enabled,
   and under Authentication → URL Configuration set a redirect URL if
   you plan to test magic links (for local dev, the default works).
4. Grab these from Project Settings → API:
   - `Project URL`
   - `anon public` key → goes in the **mobile** app
   - `service_role` key → goes in the **server** only, never in the app

## 2. Run the mobile app

```bash
cd mobile
cp .env.example .env   # fill in EXPO_PUBLIC_SUPABASE_URL / ANON_KEY
npm install
npx expo start
```

Scan the QR code with Expo Go — but note **push notifications only work
on a physical device**, not the simulator/emulator.

## 3. Run the server locally

```bash
cd server
cp .env.example .env   # fill in SUPABASE_URL / SERVICE_ROLE_KEY / CRON_SECRET
npm install
npm run dev
```

Test it:
```bash
curl -X POST http://localhost:3000/trigger-reminders \
  -H "x-cron-secret: whatever-you-put-in-.env"
```

## 4. Build & run the Docker image locally (optional sanity check)

```bash
cd server
docker build -t habit-tracker-server .
docker run -p 3000:3000 --env-file .env habit-tracker-server
```

## 5. Deploy the server to Render

**Option A — Blueprint (uses `render.yaml`):**
1. Push this repo to GitHub.
2. In Render: New → Blueprint → pick the repo. Render reads `render.yaml`
   and creates the service on the free plan automatically.
3. Fill in the three environment variables it asks for
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`).

**Option B — Manual:**
1. New → Web Service → connect the repo.
2. Root directory: `server`. Runtime: **Docker**. Plan: **Free**.
3. Add the same three environment variables under the Environment tab.
4. Deploy. Health check path `/health` is already set in `render.yaml`;
   set it manually too if you used the manual flow.

## 6. Schedule the reminder trigger (free, external)

Render's free tier can't run its own cron, so:

1. Sign up at [cron-job.org](https://cron-job.org) (free).
2. Create a job:
   - URL: `https://YOUR-SERVICE.onrender.com/trigger-reminders`
   - Method: `POST`
   - Header: `x-cron-secret: <same value as your Render CRON_SECRET>`
   - Schedule: every hour (`0 * * * *`) — all habit reminder hours are
     stored as UTC, so an hourly check catches everyone's local time.
3. Save. Check the job's execution history after the first hour to
   confirm you're getting `200` responses.

## Known limitations (light version, on purpose)

- One push token per user — signing into a second device replaces the
  first device's reminders, it doesn't add a second recipient.
- No offline support in the mobile app — every screen reads live from
  Supabase.
- No streaks/history view yet — just today's check-in state.
- First reminder ping after idle time will be slow (Render free cold
  start, typically 30-50s) — fine for a personal habit app, worth
  mentioning if you demo this live.
