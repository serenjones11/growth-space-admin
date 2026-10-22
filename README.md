# GrowSpace (Growth Space Admin)

A web app for managing a research facility's growth cabinets and Reftech
(controlled-environment) rooms: booking space out to researchers, tracking
maintenance, and handling space requests, including a public request form that
needs no login.

- **Frontend:** a single-page React app (Vite + Tailwind), hosted on Vercel.
- **Backend:** Supabase (Postgres database, logins, file storage, and an Edge
  Function that sends notification emails through Resend).

`CLAUDE.md` is the detailed technical guide (architecture, data model, security
rules, email set-up). This file covers getting it running.

## Running it locally

You need Node.js 20+ and a `.env` file in this folder with the Supabase
project's URL and publishable (anon) key:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key>
```

Both are in the Supabase dashboard under Project Settings → API. The
publishable key is designed to be public: what it can do is limited by the
database's row-level security rules.

```bash
npm install       # once
npm run dev       # local dev server, http://localhost:5173
npm run lint      # ESLint
npm test          # unit tests (Vitest)
npm run build     # production build into dist/
```

## Where things live

```
src/App.jsx              the whole UI (pages, modals, request wizard)
src/lib/api.js           every database call the UI makes
src/lib/dates.js         shared date rules (today, ending soon, overdue)
src/lib/backup.js        the Dashboard's "Full backup" Excel export
src/lib/*.test.js        unit tests
supabase/schema.sql      the full database schema, current state
supabase/migrations/     every change applied to the live database, in order
supabase/tests/          SQL checks to run in the Supabase SQL editor
supabase/functions/      Edge Functions: notification emails, user management
supabase/seed.sql        made-up sample data for the test project
```

## Test database

There's a second Supabase project, "CER App (test)", with made-up data. Try
database changes there before the live project (see `CLAUDE.md`).
`npm run dev:staging` runs the app against it, and Vercel preview deployments
(any branch other than `main`) use it automatically.

## Deploying

Pushing to `main` deploys the frontend on Vercel, but only if lint, tests and
the build pass (GitHub Actions also runs them on every push). If they fail,
the live site keeps the previous version. Vercel's two `VITE_SUPABASE_*`
variables point Production at the live project and Preview/Development at the
test project (they're baked in at build time, so changing them needs a
redeploy).

Database changes are SQL files in `supabase/migrations/`, applied to the test
project, then the live one, then mirrored into `supabase/schema.sql`. The email function is
deployed to Supabase separately and reads its secrets (`RESEND_API_KEY`,
`WEBHOOK_SECRET`, optionally `NOTIFY_FROM_EMAIL` and `APP_URL`) from Supabase's
Edge Function secrets.

## Backups

The Dashboard's **Full backup** button downloads an Excel workbook of every
unit, requisition and maintenance entry. It contains personal data, so store
it somewhere access-restricted. Supabase's own database backups depend on the
plan (the free plan has none).
