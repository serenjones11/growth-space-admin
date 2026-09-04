# Growth Space Admin

This zip contains everything built so far, organised for handing off to Claude Code.

## What's actually current

**`app/App.jsx`** is the one and only current version of the app — every feature discussed
across the whole design conversation (dashboard, inventory, cabinet popup, requisitions
lifecycle, lab-usage chart, etc.) is in this single file. It's a self-contained React
component using Tailwind utility classes, lucide-react icons, and recharts — it has **no
backend yet**; all data is generated in-memory on load and resets on refresh.

If you (or Claude Code) see a version with a coral/cream colour scheme, a lab-beaker icon
on requisitions, or a sidebar that isn't dark green — **that's an old version**, not this
one. Early in the design process the whole visual language changed from a coral/cream
theme to the current dark-sidebar green theme, and the app went through several more
rounds of changes after that. Because every version was saved to a file with the same
name across a very long conversation, it's easy to accidentally re-download an old
message's attachment instead of the latest one. This zip resolves that ambiguity — treat
`app/App.jsx` in here as the single source of truth going forward.

## Folder structure

```
app/
  App.jsx              ← the current, complete app (frontend only, no backend yet)
supabase/
  schema.sql            ← Postgres schema for Supabase (tables, enums, RLS policies, seed data)
design-prototypes/      ← exploratory HTML mockups from earlier in the design process.
                           NOT the app — these were one-off comparisons used to choose a
                           direction (e.g. "5 ways to show lab usage over time") before
                           the winning ideas were built into App.jsx. Kept for reference
                           only; safe to ignore or delete.
```

## Turning `App.jsx` into a runnable project

`App.jsx` currently expects these to be available (they were assumed present in the
environment it was built in):
- React (function components + hooks: useState, useMemo, useRef)
- Tailwind CSS (utility classes throughout — no separate CSS file exists yet)
- `lucide-react` (icons)
- `recharts` (only if any chart still uses it — most charts were rebuilt as custom SVG,
  worth double-checking whether this import is still needed by grepping the file)
- Google Fonts: Plus Jakarta Sans + Inter (linked via a `<link>` tag inside the component
  itself — fine for now, but should move to `index.html` in a real project)

A reasonable Vite scaffold:
```bash
npm create vite@latest growth-space-admin -- --template react
cd growth-space-admin
npm install lucide-react recharts
npx tailwindcss init -p   # then configure content paths + add the Tailwind directives
```
Then drop `App.jsx` in as `src/App.jsx`, export it as the default export (it already is),
and render it from `src/main.jsx`.

## Next step: Supabase

`supabase/schema.sql` is ready to run in Supabase's SQL Editor on a fresh project. See the
comments at the top and bottom of that file for what it sets up and what to do right
after running it (adding users, setting one to `admin`, creating a Storage bucket).

Once that's running, the bulk of the remaining work is swapping `App.jsx`'s mock data
generators and local `useState` mutations for real Supabase queries — that's the natural
next task to hand to Claude Code.
