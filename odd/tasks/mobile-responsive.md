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
- [ ] T2 — Wide tables: a visible scroll affordance and no three-line dates on
  phones, in one shared way across the five tables and the results sub-tabs.
- [ ] T3 — Teacher section nav: scroll hint on phones (same treatment as T2).
- [ ] T4 — 404 responses render with a viewport-aware minimal page.
- [ ] T5 — Preview pager label fits on phones.
- [ ] T6 — Full mobile + desktop sweep of touched routes; record evidence.

## Progress

- 2026-09-23: audit done; document created.
- 2026-09-23: T1 done, commit `a41ede6`. `/evaluaciones/exam-biology-demo`:
  header toolbar wraps below `lg`, `scrollWidth` 617→390 at 390px (also
  clean at 360px). Sticky question-navigator panel compacted on phones
  (legend + drag hint hidden below `sm`, tighter padding): 23%→12.6% of the
  844px viewport. Desktop 1280×800 screenshot pixel-identical to baseline
  (only the live Correcciones badge count differs, unrelated data drift).
  `npm test`: 267 passed.

## Next step

T2.
