# Feature: search ranking ("seo-ranking")

Locator: `odd/tasks/seo-ranking.md` · Engram mirror: `odd/seo-ranking/tasks` (project `testra`)
— **mirror pending**: Engram has no `testra` project and, from the `~/projects`
umbrella, answers `ambiguous_project` offering only `ai-games`/`ai_router`.
Branch: `seo/ranking` in the worktree `/home/opencode/worktrees/testra-seo`, from
`origin/feat/postgres-coolify` @ `7e19e82`. Delivered by pushing to
`feat/postgres-coolify`, which Coolify deploys to https://testra.becode.com.ar.

## Objective

Help Testra show up in search: first for its own name (a student told "entrá a
Testra" searches for it), then for the words teachers actually type.

## Problem (evidence, 2026-09-23)

- The on-page basics exist since 2026-09-21: titles, descriptions, canonicals,
  Open Graph, `SoftwareApplication` and `FAQPage` JSON-LD, `robots.txt` and a
  sitemap generated from `PUBLIC_ROUTES`.
- A web search for `testra.becode.com.ar` and for "Testra evaluaciones en línea
  docentes" returns the GitHub repo, not the site. Other brands compete for the
  name: testra.com (motion control), testra.app (CI testing), TeSTra (paper).
- There is no `WebSite` structured data, so Google has no explicit site name
  for the subdomain.
- `/favicon.ico` answers 404.
- "examen"/"exámenes" appears nowhere in the public pages; the whole
  vocabulary is "evaluación", while teachers and students search "examen".
- Nothing tells search engines the site exists: no Search Console, no
  IndexNow, no link from becode.com.ar (it lists other products, not Testra),
  and the GitHub repo has an empty homepage field.

## Why

User request (2026-09-23): "mejorame el SEO, así aparecemos primero", then
push so it deploys.

## Scope

Authorized: code in this repo and a push to `feat/postgres-coolify`.
Needs asking first: other repos (becode.com.ar), GitHub repo settings, new
content pages. Needs the owner: Search Console (their Google account).

## Constraints

- Indexing stays fail-closed: `PUBLIC_ROUTES` remains the single source of
  truth; the list and the robots `Disallow` entries do not change.
- `/demo` files are off limits: another agent built them and may still be
  working there.
- No claim the product does not back. "Gratis" stays out of visible copy: only
  the JSON-LD says price 0 and the owner has not confirmed it.
- Spanish copy and comments, matching the repo. Spanish conventional commits,
  no AI attribution.
- `lang="es"` → `es-AR` is out: Google ignores `lang` to detect language.

## Tasks

- [x] T1 — Site name and `favicon.ico`. Route: delegated writer (2+ non-trivial files).
  - `Seo.astro` emits `WebSite` JSON-LD (`name: "Testra"`, `url: <origin>/`) only on `/`.
  - `scripts/generate-icons.mjs` also writes `public/favicon.ico` (PNG inside ICO, 16/32/48).
  - Checks: `/` has the `WebSite` block and `/acerca` does not; `/favicon.ico` is 200 with an image type and 3 entries.
- [x] T2 — The home page uses the searcher's words. Route: same writer.
  - Title "Exámenes y evaluaciones en línea para docentes"; description opens with "Creá un examen en línea"; step 1 detail opens with "Armá un examen"; the `SoftwareApplication` description names exámenes; hero image gets `fetchpriority="high"`.
  - Checks: rendered title, description and hero `<img>` attribute.
- [x] T3 — IndexNow. Route: same writer.
  - `public/4b0e775e82ef465fd0811f776583d73b.txt`, `scripts/indexnow.mjs` (reads the live sitemap, checks the key file, POSTs to api.indexnow.org, has `--dry-run`), README section on SEO and indexing.
  - Checks: a dry run against the local server lists the 8 sitemap URLs and validates the key file.
- [x] T4 — Deliver. Route: parent, inline.
  - Rebase on the latest `origin/feat/postgres-coolify`, push, confirm the Coolify deploy (`last_online_at` after the push and `running:healthy`), check the live tags, ping IndexNow.

## Acceptance criteria

- Live `/` carries the `WebSite` JSON-LD, `/favicon.ico` is 200, the home title
  contains "Exámenes", the key file is live and IndexNow answers 200 or 202.
- `npm test` green, `npx astro check` with 0 errors and 0 warnings, build OK.

## Checks

TDD: off. Source: no project or session configuration enables it (vitest being
present does not). Ordinary checks: `npm test`, `npx astro check`,
`npx astro build && npm run build:ws`, and rendered-HTML checks against a local
`node server.mjs` (port 4391, Postgres on 54533).

## Delivery

Forecast about 150 authored changed lines, under the ~400 budget. Strategy
`ask-on-risk`; one push to the deploy branch, no PR (the repo deploys from the
branch and the owner asked for a direct push).

## Progress and evidence

- 2026-09-23: exploration done (live audit + code map). Baseline build OK in
  7.8 s; local server healthy.
- 2026-09-23: T1 done. `Seo.astro` emits a second, separate `WebSite`
  JSON-LD script gated on `indexable && path === "/"`; `SoftwareApplication`
  left untouched for T2. `scripts/generate-icons.mjs` gained `generarFavicon()`
  (resizes the mark to 16/32/48 PNGs, hand-assembles the ICO container).
  `node scripts/generate-icons.mjs` regenerated `public/`; `git status --short
  public/` showed only the new `favicon.ico` — no pre-existing image changed,
  so no restore was needed. Manually parsed the ICO header: reserved=0,
  type=1, count=3, sizes 16/32/48, each of the 3 payloads starts with the PNG
  signature.
- 2026-09-23: T2 done. `index.astro` title/description/step-1 detail now say
  "examen"; `Seo.astro`'s `SoftwareApplication.description` too.
  `fetchpriority="high"` added directly as a JSX prop on the hero `<Image>`;
  traced `astro/dist/assets/services/service.js`'s `getHTMLAttributes` to
  confirm it spreads unrecognized props straight to the `<img>` (no `priority`
  boolean needed, that one is for the responsive `layout` feature this project
  doesn't use). Verified live: built, started `node server.mjs` on :4391 and
  curled `/` — `<title>Exámenes y evaluaciones en línea para docentes ·
  Testra</title>`, description meta matches, hero `<img>` carries
  `fetchpriority="high"`, page contains "Armá un examen", `/` has exactly 3
  `application/ld+json` blocks and `/acerca` has none with `"@type":"WebSite"`.
- 2026-09-23: T3 done. Added `public/4b0e775e82ef465fd0811f776583d73b.txt`
  (exact key, no trailing newline — checked byte length is 32) and
  `scripts/indexnow.mjs` (checks the local key file, the deployed key file,
  the live sitemap, then `--dry-run` lists or a real POST notifies). Added the
  `## SEO e indexación` README section. Rebuilt (`npx astro build && npm run
  build:ws`), restarted `node server.mjs` on :4391, and ran
  `node scripts/indexnow.mjs http://127.0.0.1:4391 --dry-run`: listed exactly
  the 8 sitemap URLs and the key location, exit 0.
  `node scripts/indexnow.mjs http://127.0.0.1:1 --dry-run` failed fast with a
  clear connection-error message, exit 1. Never ran it without `--dry-run`.
- 2026-09-23: parent readback of the diff; comment wording polished and folded
  into its commits. Commits: T1 `b8205c4`, T2 `8b02bcd`, T3 `12f5b5f`.
  Parent spot check: `npm test` 226/226; rendered `/` shows the new title, the
  `SoftwareApplication`, `WebSite` and `FAQPage` blocks and
  `fetchpriority="high"`; `/favicon.ico` 200 `image/vnd.microsoft.icon`.
- 2026-09-23: assess over `7e19e82..12f5b5f` (`--committed-only`): risk
  `medium` (reason `executable_change` on the key file), 344 changed lines,
  `review_due: false`, `review_due_reason: under_budget`. RDD itself was
  switched off globally by the owner during this session (`review mode
  status`: `off (decided by global)`), so no review applies; the assess only
  set the verification depth: medium with a default-profile writer means writer
  self-verification plus the parent spot check.

- 2026-09-23: T4 done. Pushed `7e19e82..205b955` to `feat/postgres-coolify`
  at 00:01:21 UTC. The push did not deploy: the repo has no webhook and every
  `testra-app` deployment is `is_api: true`. Triggered it with
  `POST /api/v1/deploy?uuid=lmdqoujklt2lfswzwcsnudlt` at 00:03:27 UTC;
  `last_online_at` 00:13:01, `running:healthy`, `/api/health` ok.
  Live checks: `/` title "Exámenes y evaluaciones en línea para docentes ·
  Testra", new description, JSON-LD `SoftwareApplication` + `WebSite`
  (`url` https://testra.becode.com.ar/) + `FAQPage`, hero
  `fetchpriority="high"`, "Armá un examen" present; `/acerca` and `/rendir`
  carry no `WebSite`; `/favicon.ico` 200 `image/vnd.microsoft.icon` with
  16/32/48; key file 200 with the exact key. `node scripts/indexnow.mjs`:
  dry run listed the 8 sitemap URLs, the real call answered 202.

## Next step

Code work is done. What moves the ranking now is off-page and owner-only:
Search Console (domain property for `becode.com.ar` via DNS, submit the
sitemap), a link from becode.com.ar (its portfolio in
`~/projects/becode/src/content/projects/` lists other products, not Testra) and
the GitHub repo homepage field. Content pages for generic queries
("exámenes online") are a separate, owner-approved piece of work.
