# Feature: phone layout ("mobile-responsive")

Locator: `odd/tasks/mobile-responsive.md` · Engram mirror: `odd/mobile-responsive/tasks` (project `testra`)
Branch: `feat/mobile-responsive`, from `feat/postgres-coolify` @ `a2b6477`.
Delivery: push, merge and deploy are the user's call.

## Objective

Testra looks right on phones (360–390 px wide) without changing how it looks
on a computer (>= 1024 px).

## Problem (audit, 2026-09-23, Playwright at 390 px and 360 px)

- **Broken:** the exam editor (`/evaluaciones/[id]`) widens the whole page to
  617 px on a 390 px phone. The header toolbar in
  `src/components/exam-editor.tsx` (~line 444: save status, "Vista previa",
  "Configuración", "Preparar para el curso") is one flex row with no wrap. The
  bottom question navigator panel also looks tall on a phone; re-check it once
  the width is fixed.
- **Ugly:** five tables sit in `overflow-x-auto` with a `min-w-[580–820px]`
  and give no hint that more columns exist sideways; date cells wrap into
  three lines ("23 s / 2026 / m."). `src/pages/sesiones/index.astro`,
  `live-run-monitor.tsx`, `results-workspace.tsx` (plus its sub-tab bar),
  `admin-console.tsx` (two tables), `classroom-panel.tsx`.
- **Ugly:** the teacher section nav in `src/layouts/AppLayout.astro` scrolls
  sideways on phones and cuts "Resultados" with no scroll hint.
- **Minor:** bare `new Response("…", { status: 404 })` pages have no viewport
  meta, so phones render them zoomed out at 980 px:
  `rendir/[code]`, `sesiones/[id]`, `evaluaciones/[id]`,
  `evaluaciones/[id]/vista-previa`, `admin/index`.
- **Minor:** the preview pager squeezes "Variante local · sin guardar" into
  three lines between its buttons.
- Clean on phones already: `/`, `/login`, `/demo`, `/acerca`, legal pages,
  `/docs/vigilancia`, `/evaluaciones`, `/evaluaciones/nueva`, `/correcciones`,
  `/resultados`, and the whole student runtime at `/rendir/[code]`.

## Why

User request (2026-09-23): "Hacé que testra sea responsive y se vea bien en
celulares (en compu se ve bien así que no la rompas)".

## Scope

Authorized: layout/CSS/markup changes in this repo on this branch, with
work-unit commits. Not in scope: behavior changes, copy rewrites, the
hydration-mismatch warnings the audit also saw (reported, not fixed).

## Constraints

- Desktop must not change: every fix is mobile-first below `sm`/`md`/`lg`, or
  invisible when nothing overflows. Compare 1280×800 screenshots against the
  baselines in `/tmp/testra-audit/desktop/`.
- Keep the existing Tailwind utility style; no new dependencies.

## Checks

- TDD: off (no project or session setting enables it; source: none). Runner if
  needed: `npm test` (vitest).
- `npm test` and `npx astro check` stay green (0 errors, 0 warnings).
- At 390 and 360 px, every touched route has `scrollWidth === clientWidth`, and
  screenshots look right.
- At 1280×800, touched routes match the baselines.

## Tasks

- [x] T1 — Exam editor toolbar wraps on phones; question navigator panel
  re-checked at 390 px. Route: delegated writer (2+ files overall).
- [x] T2 — Wide tables: a visible scroll affordance and no three-line dates on
  phones, in one shared way across the five tables and the results sub-tabs.
- [x] T3 — Teacher section nav: scroll hint on phones (same treatment as T2).
- [x] T4 — 404 responses render with a viewport-aware minimal page.
- [x] T5 — Preview pager label fits on phones.
- [x] T6 — Full mobile + desktop sweep of touched routes; record evidence.

## Progress

- 2026-09-23: audit done; document created.
- 2026-09-23: T1 done, commit `a41ede6`. `/evaluaciones/exam-biology-demo`:
  header toolbar wraps below `lg`, `scrollWidth` 617→390 at 390px (also
  clean at 360px). Sticky question-navigator panel compacted on phones
  (legend + drag hint hidden below `sm`, tighter padding): 23%→12.6% of the
  844px viewport. Desktop 1280×800 screenshot pixel-identical to baseline
  (only the live Correcciones badge count differs, unrelated data drift).
  `npm test`: 267 passed.

- 2026-09-23: T2 done, commit `b78bb57`. New shared `.scroll-fade-x` utility
  in `src/styles/global.css` (background-attachment local/scroll edge-fade;
  gotcha found and fixed: `background-image` layers can't carry a position
  suffix, that has to be a separate `background-position` with matching
  layer count, and `@theme inline` tokens like `--color-paper` don't exist
  as runtime CSS vars, so the fallback had to be a literal hex, not
  `var(--color-paper)`). Applied to `sesiones/index.astro`,
  `live-run-monitor.tsx`, `results-workspace.tsx` (table + sub-tab bar, with
  a `--scroll-fade-bg` override for its `bg-inset` background),
  `admin-console.tsx` (both tables), `classroom-panel.tsx`; `whitespace-nowrap`
  added on every date/time cell found in those files. Verified at 390 and
  360px on `/sesiones`, `/sesiones/run-biology-demo`, `/admin`,
  `/resultados?run=run-biology-ended` (`scrollWidth === clientWidth` on all);
  scrolled each table start/mid/end and confirmed by screenshot the fade
  only shows on the side with hidden content, gone at 1280×800 (compared
  against `/tmp/testra-audit/desktop/sesiones-index.png`,
  `admin-index.png`, `resultados-ended.png`, `sesiones-running.png` — same
  layout, only live demo data differs). `classroom-panel.tsx`'s grades
  table needs a Classroom-linked ended run, not present in the seeded demo
  data, so it was verified by code inspection/consistency with the other
  five instances rather than a live screenshot. `npm test`: 267 passed.

- 2026-09-23: T3 done, commit `acee8b7`. `src/layouts/AppLayout.astro`
  `.nav-secciones` (~line 72) gets `scroll-fade-x`. `/evaluaciones` at
  390px: right fade visible at scroll start (Resultados/Consola tapados),
  left fade appears once scrolled, none at either edge once fully
  scrolled to the end. `scrollWidth === clientWidth`. The nav is
  `md:hidden`, so desktop 1280×800 is untouched by construction. `npm
  test`: 267 passed.

- 2026-09-23: T4 done, commit `369d0b9`. New shared `src/pages/404.astro`
  (sets `Astro.response.status = 404` itself, reads `?msg=` for the exact
  original message, branded/centered, uses `Seo.astro` so viewport meta and
  the noindex fail-closed both come for free — the page never joined
  `PUBLIC_ROUTES`). The five call sites now
  `return Astro.rewrite(\`/404?msg=${encodeURIComponent(mensaje)}\`)` instead
  of a bare `new Response`. Verified with `curl -o /dev/null -w '%{http_code}'`
  → 404 on all five (`/sesiones/nope-does-not-exist`,
  `/evaluaciones/nope-does-not-exist`,
  `/evaluaciones/nope-does-not-exist/vista-previa`, `/rendir/ZZZZZZ`, and
  `/admin` — this last one required briefly restarting the dev server
  *without* `SUPERADMIN_EMAILS` since the demo teacher is superadmin
  otherwise; restarted with it again right after), and by `curl` grep that
  each response carries the viewport meta tag and its own original message
  text unchanged. Screenshot at 390px confirms no zoomed-out rendering.
  `npx astro check`: 0 errors, 0 warnings, 3 pre-existing hints. `npm test`:
  267 passed.

- 2026-09-23: T5 done, commit `2f27add`. `src/components/exam-preview.tsx`
  pager nav: label gets `order-last w-full text-center` (own centered row
  below the two buttons) below `sm`, `sm:order-none sm:w-auto` restores the
  exact single-row layout at `sm`+; parent gets `flex-wrap` below `sm`,
  `sm:flex-nowrap` above. `/evaluaciones/exam-biology-demo/vista-previa` at
  390 and 360px: one line, centered, no squeeze; `scrollWidth ===
  clientWidth` both widths. Desktop 1280×800 screenshot pixel-identical to
  `/tmp/testra-audit/desktop/evaluaciones-vista-previa.png` (only the
  Correcciones badge count differs). `npm test`: 267 passed.

- 2026-09-23: T6 done (doc evidence only, no code change). Swept
  `/evaluaciones`, `/evaluaciones/exam-biology-demo`,
  `/evaluaciones/exam-biology-demo/vista-previa`, `/sesiones`,
  `/sesiones/run-biology-demo`, `/sesiones/run-biology-ended`,
  `/resultados?run=run-biology-ended`, `/admin`, `/correcciones`,
  `/rendir/ZZZZZZ` (404) at 390 and 360px: `scrollWidth === clientWidth`
  on all ten. Desktop 1280×800 for `/evaluaciones` and `/correcciones`
  matched their `/tmp/testra-audit/desktop/` baselines pixel-for-pixel
  (only live demo-data counters differ — Correcciones badge, `Por
  corregir` list — from interacting with the demo dataset while testing,
  not a layout change). Ran a full console/page-error sweep across all ten
  routes with Playwright: the only `pageerror`s are React hydration
  mismatches on `/sesiones/run-biology-demo`, `/sesiones/run-biology-ended`,
  `/resultados`, `/admin`, and **`/correcciones`** (a page this branch never
  touched) — same Intl date-formatting mismatch the audit already flagged
  as out of scope and not fixed here; seeing it on the untouched
  `/correcciones` route confirms it's pre-existing and systemic, not
  something this branch introduced. The one console error on
  `/rendir/ZZZZZZ` is the browser logging the page's own intended 404
  status, not a bug. Final `npx astro check`: 0 errors, 0 warnings, 3
  pre-existing hints. Final `npm test`: 267 passed. Dev server stopped
  after this check.

- 2026-09-23: T4 follow-up (parent review). `/404?msg=` let anyone show
  arbitrary text under the Testra brand on this domain (content spoofing).
  The message now travels in `Astro.locals.notFoundMessage` and `404.astro`
  never reads the URL. Verified with curl: the five routes still answer 404
  with their own message and a viewport meta; `/404?msg=Cuenta%20suspendida`
  shows "No encontrado". `npx astro check`: 0 errors, 0 warnings, 3 hints.
  `npm test`: 267 passed. Parent spot check of the scroll fades at 390 px:
  visible on table rows and the section nav; header rows with their own
  background cover it (known limit of the technique, accepted).

## Next step

None — T1 through T6 are all done. Possible follow-ups (not decided,
reported back): apply the same `scroll-fade-x` treatment to
`analytics-panel.tsx`'s table (same `overflow-x-auto min-w-[680px]`
pattern, not in the original audit/scope); fix the pre-existing
hydration-mismatch warnings (explicitly out of scope per this doc).
