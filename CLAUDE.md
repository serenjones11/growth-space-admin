# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Growth Space Admin: an internal admin tool for managing a research facility's growth cabinets
and Reftech (controlled-environment) rooms — booking them out to researchers, tracking
maintenance, and handling space requisitions (including a public, no-login request form).

## Project state — read this before touching anything

The app is Vite + React + Tailwind on the frontend, backed by a **live Supabase project**
(Postgres + Auth + Storage + Edge Functions). There is no mock data layer anymore — it was fully
replaced; every page reads and writes through real queries. There is still **no test runner** or
lint script configured.

```
src/App.jsx                        ← the entire UI (~4,800 lines): pages, modals, wizard, all of it
src/lib/api.js                     ← every Supabase query/mutation the UI calls (~800 lines)
src/lib/supabaseClient.js          ← creates the Supabase client from VITE_ env vars
src/lib/useSession.js              ← auth session + profile (role) hook
src/index.css                      ← Tailwind directives only
supabase/schema.sql                ← the full schema, kept in sync with migrations/ — see below
supabase/migrations/               ← every migration applied to the live project, in order
supabase/functions/notify-requisition/  ← Edge Function: requisition email notifications (Resend)
design-prototypes/                 ← old exploratory HTML mockups, NOT part of the app — ignore
```

`.env` (gitignored) holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` — required for
`npm run dev` to actually connect to anything. The publishable/anon key is meant to be
client-exposed; it grants nothing beyond what RLS policies allow (see below), so it also gets set
as a plain (non-sensitive) env var on Vercel for the deployed build.

## Commands

```bash
npm install    # install dependencies
npm run dev    # start Vite dev server (http://localhost:5173, or next free port)
npm run build  # production build
npm run preview # preview the production build locally
```

There is no lint or test script configured.

**`src/App.jsx`** is the single source of truth for the whole UI: dashboard, inventory,
cabinet/reftech detail drawer, requisitions lifecycle, timeline view, lab-usage chart, request-space
wizard — all of it, in one file, as one default-exported root component
(`export default function GrowthCabinetApp()`). If you encounter any other copy of this app
(e.g. a coral/cream color scheme, a beaker icon, a non-dark sidebar), it's a stale version from
earlier design iterations — this file is authoritative.

## Notable scaffolding details

- Tailwind is v3, configured the classic way (`tailwind.config.js` + `postcss.config.js`),
  scanning `index.html` and `src/**/*.{js,jsx}`.
- `App.jsx` also injects its own CSS custom properties via an in-component
  `<style>{TOKENS}</style>` block (the dark-sidebar/warm-green theme) — `src/index.css` only
  carries the three `@tailwind` directives, nothing else.
- Google Fonts (Plus Jakarta Sans + Inter) are linked via `<link>` tags inside `App.jsx` itself
  rather than `index.html` — left as-is from the original handoff, not yet cleaned up.
- `recharts` is installed but double-check it's still used before relying on it — most charts
  in `App.jsx` were rebuilt as custom SVG.
- No responsive breakpoints to speak of — the admin shell (fixed sidebar, multi-column grids) is
  desktop-only today. The public `RequestSpacePage` wizard is the closest thing to mobile-usable
  as-is. Treat any mobile/iPad work as a real scoping conversation, not a quick pass.

## Architecture inside App.jsx

Everything lives in one file, organized top-to-bottom as:

1. **Design tokens** (`TOKENS`) — CSS custom properties for the dark-sidebar / light-workspace,
   warm-green theme, injected via a `<style>` tag. `--accent` etc. are also duplicated as plain
   hex in the Edge Function (email clients can't use CSS custom properties) — keep both in sync
   if the palette ever changes.
2. **Small presentational/shared components** — `StatusTag`, `DisciplineBadge`, `MiniGauge`,
   `RoomChip`, `Sidebar`, `ActivityRow`, `DateField` (custom calendar popup), `SpeciesPicker`
   (portalled dropdown, admin-manageable), etc.
3. **Page components** — `DashboardPage`, `InventoryPage`, `RequisitionsPage`,
   `RequestSpacePage`, plus the modals/drawers each page opens (`UnitModal`,
   `AddEditUnitModal`, `RequisitionPreviewPanel`, wizard steps).
4. **Root component** (`GrowthCabinetApp`, bottom of file) — owns navigation state and loads all
   data via `reload()` → `api.fetchAdminData()` into a single `appData` object on `useState`. Every
   mutation handler (`handleSaveUnit`, `handleDecideRequisition`, `handleCompleteRequisition`,
   etc.) calls the matching `src/lib/api.js` function, then re-runs `reload()` — there is no local
   optimistic state, the UI always reflects a fresh read after a write.
5. Non-admins (including signed-out visitors) only ever see `RequestSpacePage` — see the
   `!isAdmin` branch near the bottom of `GrowthCabinetApp`. That page also renders inside the
   admin app (sidebar → "Request"), with `isAdmin` passed through so admin-only affordances
   (e.g. species-list management) show up there but never on the public form.

### Data model concepts worth knowing

- **Unit** = either a `cabinet` (single occupant, `status`/`occupant`-shaped in the frontend) or a
  `reftech` room (can hold several simultaneous bookings) — this split is a frontend read-model
  convenience; the actual schema unifies everything into one `bookings` table with a unit
  foreign key (see `supabase/schema.sql`'s design notes).
- **Requisition lifecycle**: `pending` → `approved`/`declined` → (`approved` only) `completed`.
  Approving assigns a unit and creates a booking; completing frees the unit again. Each
  requisition gets a human-readable `code` (`R26-0001` etc.) assigned by a DB trigger on insert.
- Requisitions and units are true DB relations now (foreign keys, RLS-enforced) — there is no
  seed-time linking step; that whole class of mock-data problem no longer exists.

## Backend — live Supabase project

The app is fully wired to Supabase; there is **no mock data path left**. Schema changes are made
as numbered files in `supabase/migrations/` and applied directly to the live project — there is
no local Supabase CLI / dev stack in this repo (no `supabase/config.toml`), so changes go straight
to the hosted project. `supabase/schema.sql` is kept as a standing snapshot of the *whole* schema
(tables, RLS, functions, triggers) — after adding a migration, mirror the same change into
`schema.sql` so it stays a truthful "run this on a fresh project" reference, and so anyone reading
the repo doesn't have to reconstruct current-state by replaying 30+ migration files by hand.

**Tables**: `lab_groups`, `profiles` (extends `auth.users`, `role` = `admin`/researcher),
`maintenance_categories`, `units`, `rooms`, `requisitions`, `bookings`, `service_log`,
`documents`, `activity_log`, `species_options`, `requisition_code_counters`.

**RLS shape**: admins (`profiles.role = 'admin'`, checked via `is_admin()`) can read/write
everything. Everyone else — including anonymous visitors, since there's no researcher SSO yet —
can only INSERT a new requisition and read/amend their own pending ones; a few reference tables
(`species_options`, and the `list_lab_groups()` RPC) are deliberately public-read since the
public request form needs them without a session.

**Email notifications**: `supabase/functions/notify-requisition` (Deno Edge Function, called via
`pg_net` from triggers on `requisitions`, not from the frontend) sends Resend emails — admins get
a full requisition preview when one comes in; the requester gets a slimmer "approved and
assigned" email once a unit is assigned, re-sent if an admin later edits the dates or unit. Auth
is a shared secret (`x-webhook-secret`, stored in `supabase_vault`), since Postgres triggers have
no user session to attach a JWT to — that's also why the function has `verify_jwt: false`.
Secrets (`RESEND_API_KEY`, `WEBHOOK_SECRET`, optionally `NOTIFY_FROM_EMAIL`/`APP_URL`) are set as
Edge Function secrets in Supabase, never as Vercel/frontend env vars.

## Deployment

Frontend is set up to deploy on Vercel (Vite preset, no custom `vercel.json` needed — no
client-side router, so no rewrite rules required). Needs `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` set as Vercel env vars (Production **and** Preview/Development),
copied from `.env` — Vite only bakes these in at build time, so changing them requires a redeploy,
not just a re-save.
