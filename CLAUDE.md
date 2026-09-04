# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Growth Space Admin: an internal admin tool for managing a research facility's growth cabinets
and Reftech (controlled-environment) rooms — booking them out to researchers, tracking
maintenance, and handling space requisitions.

## Project state — read this before touching anything

The project is now scaffolded with Vite + React + Tailwind and runs locally. There is still
**no test runner** and no backend — just the dev/build tooling.

```
src/App.jsx           ← the entire current app (frontend only, no backend)
src/main.jsx          ← Vite/React entry point, mounts <App />
src/index.css         ← Tailwind directives only
supabase/schema.sql    ← Postgres schema for Supabase, not yet wired up
design-prototypes/     ← old exploratory HTML mockups, NOT part of the app — safe to ignore
```

## Commands

```bash
npm install    # install dependencies
npm run dev    # start Vite dev server (http://localhost:5173, or next free port)
npm run build  # production build
npm run preview # preview the production build locally
```

There is no lint or test script configured.

**`src/App.jsx`** (~3,350 lines) is the single source of truth for the whole app: dashboard,
inventory, cabinet/reftech detail drawer, requisitions lifecycle, lab-usage chart, request-space
wizard — all of it, in one file, as one default-exported root component
(`export default function GrowthCabinetApp()`). If you encounter any other copy of this app
(e.g. a coral/cream color scheme, a beaker icon, a non-dark sidebar), it's a stale version from
earlier design iterations — this file is authoritative.

There is **no backend**. All data is generated in-memory on load via deterministic mock
generators and lives in root-level `useState` — every add/edit/approve mutates only local state
and is lost on refresh. `supabase/schema.sql` is a ready-to-run schema for the intended backend
but nothing in `App.jsx` talks to Supabase yet.

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

## Architecture inside App.jsx

Everything lives in one file, organized top-to-bottom as:

1. **Design tokens** (`TOKENS`) — CSS custom properties for the dark-sidebar / light-workspace,
   warm-green theme, injected via a `<style>` tag.
2. **Mock data generation** — deterministic (`mulberry32(42)` seeded PRNG, `TODAY` hardcoded to
   `2026-08-23` rather than `new Date()`) so reloads look stable even though nothing persists.
   Key generators: `generateUnits()`, `generateFakeRequisitions()`, `generateLabUsageHistory()`,
   `seedScheduledMaintenance()`, `backfillRequisitionsFromUnits()`. Reference lists (labs, PIs,
   manufacturers, rooms, species, etc.) are hardcoded consts near the top.
3. **Small presentational/shared components** — `StatusTag`, `DisciplineBadge`, `MiniGauge`,
   `RoomChip`, `Sidebar`, `ActivityRow`, etc.
4. **Page components** — `DashboardPage`, `InventoryPage`, `RequisitionsPage`,
   `RequestSpacePage`, plus the modals/drawers each page opens (`UnitModal`,
   `AddEditUnitModal`, `RequisitionPreviewPanel`, wizard steps).
5. **Root component** (`GrowthCabinetApp`, bottom of file) — owns all app state (`units`,
   `requests`, `categories`, navigation state) and all mutation handlers
   (`handleSaveUnit`, `handleDecideRequisition`, `handleCompleteRequisition`, etc.), then
   renders the sidebar + current page + any open modal.

### Data model concepts worth knowing

- **Unit** = either a `cabinet` (single occupant at a time, `status`/`occupant` fields) or a
  `reftech` room (`bookings` array, can hold multiple overlapping researchers). This split shape
  is intentional in the mock layer but is unified into one `bookings` table in
  `supabase/schema.sql` — see the schema's design notes at the top for why.
- **Requisition lifecycle**: `pending` → `approved`/`declined` → (`approved` only) `completed`.
  Approving assigns a unit and creates a booking/occupant; completing frees the unit again.
- Requisitions and units are seeded independently, so `backfillRequisitionsFromUnits()` exists
  to retroactively link them for demo consistency — this whole class of problem goes away once
  there's a real DB with foreign keys (as `schema.sql` already models).

## Backend (not yet connected)

`supabase/schema.sql` is meant to be run as-is in Supabase's SQL editor on a fresh project.
Tables: `lab_groups`, `profiles` (extends `auth.users`), `maintenance_categories`, `units`,
`requisitions`, `bookings`, `service_log`, `documents`. RLS policies: any authenticated user can
read everything; only admins (`profiles.role = 'admin'`) can write to inventory/maintenance
data; researchers can only create/amend their own pending requisitions.

The next real task on this project is swapping `App.jsx`'s mock generators and local `useState`
mutations for real Supabase queries against this schema.
