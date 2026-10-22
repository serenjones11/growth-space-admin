# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Growth Space Admin: an internal admin tool for managing a research facility's growth cabinets
and Reftech (controlled-environment) rooms — booking them out to researchers, tracking
maintenance, and handling space requisitions (including a public, no-login request form).

## Project state — read this before touching anything

The app is Vite + React + Tailwind on the frontend, backed by a **live Supabase project**
(Postgres + Auth + Storage + Edge Functions). There is no mock data layer anymore — it was fully
replaced; every page reads and writes through real queries. `npm run lint` (ESLint) and `npm test`
(Vitest unit tests for the pure logic in `src/lib/`) both need to pass before pushing.

```
src/App.jsx                        ← the entire UI (~5,200 lines): pages, modals, wizard, all of it
src/lib/api.js                     ← every Supabase query/mutation the UI calls (~950 lines)
src/lib/dates.js                   ← "today", day counts, ending-soon/overdue rule - shared by UI, api, backup
src/lib/backup.js                  ← Dashboard "Full backup" Excel export (exceljs, lazy-loaded)
src/lib/*.test.js                  ← Vitest unit tests (dates, lab-usage maths, backup columns)
src/lib/supabaseClient.js          ← creates the Supabase client from VITE_ env vars
src/lib/useSession.js              ← auth session + profile (role) hook
src/index.css                      ← Tailwind directives only
supabase/schema.sql                ← the full schema, kept in sync with migrations/ — see below
supabase/migrations/               ← every migration applied to the live project, in order
supabase/tests/                    ← SQL regression checks, run in the SQL editor (they roll back)
supabase/seed.sql                  ← fake sample data for the TEST project only
.env.staging                       ← TEST project URL + publishable key (committed; fake data only)
.github/workflows/ci.yml           ← lint + tests + build on every push / pull request
supabase/functions/notify-requisition/  ← Edge Function: requisition email notifications (Resend)
supabase/functions/manage-users/   ← Edge Function: Settings page user management (list/add/role/reset/remove)
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
npm run lint   # ESLint (eslint.config.js)
npm test       # Vitest unit tests
npm run dev:staging # dev server against the TEST Supabase project (.env.staging)
```

Every push runs lint, tests and a build on GitHub Actions, and Vercel's build runs the same
checks (`vercel-build` in package.json), so a commit that fails them never replaces the live site -
the previous deployment stays up.

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
- Charts are custom SVG in `App.jsx`; there is no charting library.
- Dates: booking dates are calendar days (`YYYY-MM-DD`). Compare them as strings or via
  `src/lib/dates.js` - never mix `new Date("YYYY-MM-DD")` (UTC midnight) with local-time `Date`s,
  which is off by a day around midnight in British Summer Time. `App.jsx`'s `TODAY` is refreshed
  when the date rolls over.
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
- A unit's **research area** (`units.disciplines`: `{plant}`, `{insect}`, both, or empty) is a
  label set on the add/edit CER form. It drives the tile's discipline pill(s), the timeline row icons
  and the inventory discipline filter - not the requisitions booked on it - and doesn't restrict
  which requisitions it can take.
- **Requisition lifecycle**: `pending` → `approved`/`declined` → (`approved` only) `completed`.
  Approving assigns a unit and creates a booking; completing frees the unit again. Each
  requisition gets a human-readable `code` (`R26-0001` etc.) assigned by a DB trigger on insert.
- Requisitions and units are true DB relations now (foreign keys, RLS-enforced) — there is no
  seed-time linking step; that whole class of mock-data problem no longer exists.
- **Bookings follow their requisition automatically**: the `sync_booking_from_requisition`
  trigger creates/updates an approved requisition's booking whenever the requisition is written,
  so the client only ever writes `requisitions` to approve, edit or move one (never `bookings`).
  While an amendment is under review (status back to `pending`) the booking keeps the approved
  version. The `guard_requisition_write` trigger resets admin-only columns (status, unit,
  decided/completed, admin notes, amendment record) on writes from anyone who isn't an admin.

## Two Supabase projects: test first, then live

- **Live**: "CER App" (`ttyyttkdezvlyldtrcpx`) - real data. Vercel **production** uses it.
- **Test**: "CER App (test)" (`hzkmhlnypxwsvoagurko`) - fake data from `supabase/seed.sql`.
  Vercel **preview** deployments (any branch other than `main`) and `npm run dev:staging` use it.
  It has the `manage-users` Edge Function but deliberately no `notify-requisition` webhook secret,
  so test data never sends real emails. Free-plan projects pause after a week unused; restore it
  from the Supabase dashboard when needed.

Workflow for any database change: write the migration file, apply it to the **test** project, try
it there (preview deployment or `npm run dev:staging`, plus `supabase/tests/`), and only then apply
the same file to **live** and mirror it into `schema.sql`. Edge Functions likewise: deploy to test,
check, then deploy to live. (Supabase's built-in branching would automate this but needs the Pro
plan.) To rebuild the test project from scratch: run `schema.sql`, then `seed.sql`, in its SQL
editor.

## Backend — live Supabase project

The app is fully wired to Supabase; there is **no mock data path left**. Schema changes are made
as numbered files in `supabase/migrations/` and applied directly to the live project — there is
no local Supabase CLI / dev stack in this repo (no `supabase/config.toml`), so changes go straight
to the hosted project. `supabase/schema.sql` is kept as a standing snapshot of the *whole* schema
(tables, RLS, functions, triggers) — after adding a migration, mirror the same change into
`schema.sql` so it stays a truthful "run this on a fresh project" reference, and so anyone reading
the repo doesn't have to reconstruct current-state by replaying 30+ migration files by hand.

**Roles** (`profiles.role`): `owner` - the whole app plus managing users on the Settings page;
`admin` - shown as **"User"** in the app: the whole app except managing users; `researcher` -
no admin access (only the public request form). `is_admin()` is true for owners *and* users, so
every RLS policy treats them alike; `is_owner()` marks owners. Creating/removing logins needs the
service-role key, so the Settings page calls the `manage-users` Edge Function (`verify_jwt` on),
which checks the caller's role itself: any owner/user may list, only owners may change anything,
nobody may change or remove themselves, and the last owner can't be removed. Accounts are created
with a password the owner sets and passes on (Supabase's built-in email can't send invites to
arbitrary addresses without custom SMTP); people change it on the Settings page.

**Tables**: `lab_groups`, `profiles` (extends `auth.users`, `role` = `owner`/`admin`/`researcher`),
`maintenance_categories`, `units`, `rooms`, `requisitions`, `bookings`, `service_log`,
`documents`, `activity_log`, `species_options`, `light_cycle_options`, `requisition_code_counters`, `manufacturers`,
`notification_preferences`, `backup_log` (when the Dashboard "Full backup" Excel export (GrowSpace-Backup-DD-MM-YYYY.xlsx) was last
downloaded — `src/lib/backup.js` builds the workbook client-side with a lazily loaded `exceljs`).

**RLS shape**: admins (`profiles.role = 'admin'`, checked via `is_admin()`) can read/write
everything. Everyone else — including anonymous visitors, since there's no researcher SSO yet —
can only INSERT a new requisition and read/amend their own pending ones; a few reference tables
(`species_options`, and the `list_lab_groups()` RPC) are deliberately public-read since the
public request form needs them without a session.

**Email notifications**: `supabase/functions/notify-requisition` (Deno Edge Function, called via
`pg_net` from triggers on `requisitions`, not from the frontend) sends Resend emails — admins get
a full requisition preview when one comes in (and an "amended requisition" version, changed
fields in red, when a researcher amends one - see schema.sql section 24); the requester gets a slimmer "approved and
assigned" email once a unit is assigned, re-sent if an admin later edits the dates or unit; and
admins get an "ending soon" email ~2 weeks before an approved requisition's end date (daily
`pg_cron` job `send-end-date-reminders`, re-armed if the end date moves). Admin emails respect
each admin's `notification_preferences` row (no row = everything); there's no UI for that table
yet, so for now it's set directly in the database. Auth
is a shared secret (`x-webhook-secret`, stored in `supabase_vault`), since Postgres triggers have
no user session to attach a JWT to — that's also why the function has `verify_jwt: false`.
Secrets (`RESEND_API_KEY`, `WEBHOOK_SECRET`, optionally `NOTIFY_FROM_EMAIL`/`APP_URL`) are set as
Edge Function secrets in Supabase, never as Vercel/frontend env vars.

## Deployment

Frontend deploys on Vercel (project `grow-space`, Vite preset, no `vercel.json` — no client-side
router, so no rewrite rules). `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` are set per
environment: **Production** = live project (same values as `.env`), **Preview/Development** = test
project (same as `.env.staging`). Vite bakes them in at build time, so changing them needs a
redeploy, not just a re-save. Vercel's build runs `npm run vercel-build` (lint + tests + build).
