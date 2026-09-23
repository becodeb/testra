# Feature: copy detection between students with Jev ("jev-copy-detection")

Locator: `odd/tasks/jev-copy-detection.md` · Engram mirror: `odd/jev-copy-detection/tasks` (project `testra`)
Branch: `feat/jev-copy-detection` in the worktree `/home/opencode/worktrees/testra-jev`, from
`origin/feat/postgres-coolify` @ `e8081c3`. Not pushed: push, merge into
`feat/postgres-coolify` and the Coolify deploy are the owner's call.

## Objective

Teachers see, right in the results of a session, which pairs of students have answers that
coincide in ways that the topic does NOT explain (the same mistake, the same uncommon
wording, the same rare wrong options), with the expected coincidences filtered out and
explained, so they can review them fast. Jev (TypeSafe AI's System One model, through
Vercel AI Gateway) does the semantic judgments; code does what code does better.

## Problem (evidence, 2026-09-23)

- Nothing compares students with each other. The only copy signal is `likelyCopying` in the
  run-scope AI report (`src/server/ai-reports.ts`): one LLM prompt with every participant's
  full detail as a single JSON blob. On a 30-student session that is 435 pairs per question
  judged in one pass by whichever free model the ai-router cascade picks, with
  uncalibrated `confidence`, and a different answer on each regeneration.
- `docs/vigilancia.md` says the product does not decide whether an answer was written by
  someone else. That stays true: this feature flags coincidences for review, it never
  decides.

## Why

User request (2026-09-23): implement Jev to detect copying so teachers see it easily, give it
enough context about what is expected, keep the text AI analysis ("Jev is better for certain
things"), use Vercel AI Gateway, upload the env to Coolify, and test whether it works, using
the free AI at ai-router.becode.com.ar.

## What Jev is (verified 2026-09-23)

- A "System One" decision model: `state` + typed `questions` in, calibrated probabilities out,
  no text generation. Types on the gateway: `boolean` (`probability`), `choice` (`choice` +
  `probabilities`), `score` (`score` + `probabilities`). Questions are answered independently
  and in parallel against the same state.
- Gateway: `POST https://ai-gateway.vercel.sh/v1/evaluate`, `Authorization: Bearer
  $AI_GATEWAY_API_KEY`, model `typesafe-ai/jev`, context window 32K, $0.042 per million input
  tokens, output free (free until 2026-09-25), `zdr: all`, `no_training: all`.
  `providerOptions.gateway.zeroDataRetention` enforces ZDR per request.
- Documented weaknesses: counting, arithmetic, dates, and accuracy dropping when the state
  carries unrelated content. Advice: atomic questions combined in code, keep the state focused,
  put policy/context in the state, thresholds per action, route the 0.3–0.7 band to a human.
- Sources: vercel.com/docs/ai-gateway/modalities/evaluation, docs.typesafe.ai (api,
  primitives/noul, confidence, concepts/state, model-jaggedness/jev-1.13).

## Design

Division of labor:

| Signal | Who | Why |
|---|---|---|
| Same wrong option in mc/ms/tf, weighted by how few classmates chose it | code | counting and rarity are arithmetic, Jev's documented weakness |
| Same wrong short answer (sa) that almost nobody else wrote | code | exact after `normalizeShortAnswer` |
| Long answers sharing word fragments that nobody else in the class wrote and that are not in the prompt or the reference answer | code | exact, cheap, and gives the spans to highlight |
| Long answers: distinctive shared wording, the same mistake, one reworded from the other | Jev | semantic; code cannot tell a paraphrase from two students who studied the same thing |
| Narrative summary | existing LLM report | untouched |

What is expected (goes into Jev's state and into the teacher-facing copy): correct answers
resemble each other and the reference answer; the topic's vocabulary; definitions learned in
class; short or closed answers coinciding when they are right; common distractors.

Jev is called once per (pair, long question) with a focused state (context, prompt, reference
answer, the two answers; never names or ids) and three atomic booleans. Pairs are ranked by
TF-IDF similarity over the class and only the top ones reach Jev (budget per question and per
analysis), so a 30-student session stays at a few hundred calls. Failures degrade honestly:
without a key, or with the gateway refusing, the code signals are still shown and the panel says
the Jev part did not run. Never a fabricated result.

## Scope

Authorized: code, tests, docs and a migration in this repo; `AI_GATEWAY_API_KEY` in the local
`.env` and in the Coolify app `testra-app` (done); calls to the gateway and to the ai-router
for testing.
Needs asking first: pushing, merging into `feat/postgres-coolify`, deploying. Changing the
existing LLM report.

## Constraints

- Student names, emails and ids never reach Jev or the ai-router; opaque labels only.
- Every coincidence is presented as a signal to review, never as proof or a verdict.
- `/demo` and the existing AI report stay untouched.
- Spanish UI copy and code comments, matching the repo. Spanish conventional commits, no AI
  attribution, no `Co-Authored-By`.
- Env through `serverEnv` getters (`process.env`), single-replica in-process work, API routes
  thin with `getActor` + run capabilities.
- The key is a secret: only in the gitignored `.env` and in Coolify (runtime only).

## Tasks

- [x] T1 — Jev client. Route: delegated writer (phase A; 2+ non-trivial files).
  - `src/server/jev-client.ts`: typed `/v1/evaluate` call, zod-validated answers, ZDR provider
    options, typed errors (not configured, billing required, unauthorized, rate limited,
    bad request, unavailable, invalid response), bounded retries on 429/529/5xx/network.
  - `serverEnv.AI_GATEWAY_API_KEY` (+ optional `AI_GATEWAY_URL`), `.env.example`.
  - Checks: unit tests with a stubbed `fetch` (200 per answer type, 403
    `customer_verification_required`, 429 then 200, 500 exhausting retries, malformed body).
- [x] T2 — Code signals. Route: same writer.
  - `src/server/similarity-signals.ts`: normalization with offsets, shared rare wrong
    answers for mc/ms/tf/sa with class rarity, rare shared fragments in long answers (class
    document frequency, excluding prompt/reference wording) with spans, TF-IDF pair ranking.
  - Checks: unit tests on hand-built classes (common distractor not flagged, rare one flagged,
    shared class definition not flagged, copied passage flagged with correct spans).
- [x] T3 — Analysis with Jev. Route: same writer.
  - `src/server/similarity-analysis.ts`: pair selection under budget, Jev state with the
    "expected" context, three atomic booleans, bounded concurrency and time budget, combination
    into pair findings with levels (`strong`, `review`), honest semantic status.
  - Checks: unit tests with a fake evaluator (levels, budget, degradation on billing error,
    names never in the state).
- [ ] T4 — Evaluation: does it work? Route: delegated writer (phase C) + parent runs.
  - Synthetic Spanish dataset generated with the ai-router (independent answers, copies:
    near-verbatim, paraphrase, shared mistake; hard negatives: memorized class definition),
    committed as a fixture; eval runner reporting precision/recall/false positives on hard
    negatives, prefilter recall, latency and cost, for code signals, Jev, and an LLM pairwise
    judge through the ai-router as the comparison.
  - Checks: the runner's report, recorded below.
- [ ] T5 — Persistence and API. Route: delegated writer (phase B).
  - Table `similarity_reports` (one per run, input hash, JSON report) + migration, a route
    mirroring `/api/ai/reports` (GET cached, POST run) with the run capability check.
  - Checks: unit tests for hashing/staleness; local call against the dev server.
- [ ] T6 — Teacher UI. Route: same writer.
  - "Coincidencias entre alumnos" card in the results "Análisis" tab: what is expected,
    run/refresh, ranked pairs with level and one-line evidence, side-by-side answers with the
    shared fragments highlighted, Jev status; the pairs of a student in their detail dialog.
    Teacher-facing text in `src/lib/similarity-copy.ts` with the `{title, what, normal,
    review}` shape of `incident-copy.ts`.
  - Checks: `astro check`, local run on seeded data, screenshot.
- [ ] T7 — Docs. Route: same writer.
  - `docs/vigilancia.md` (what is compared, what is sent to Jev, ZDR, limits, non-goals),
    README env var.

## Acceptance criteria

- A teacher opens a finished session's analysis, runs the comparison and sees the flagged pairs
  with the evidence and the "why this can be normal" line; unflagged classes say so plainly.
- Without `AI_GATEWAY_API_KEY`, or with the gateway refusing, the code signals still appear
  and the card states that the Jev part did not run and why.
- The eval report answers "does Jev help here, and where" with numbers, including where it
  does not.
- `npm test` green, `npx astro check` 0 errors / 0 warnings, build OK.

## Checks

TDD: off. Source: no project or session configuration enables it (vitest being present does
not); same resolution as `odd/tasks/seo-ranking.md`. Runner: `npx vitest run`. Ordinary
checks: `npx vitest run`, `npx astro check`, `npx astro build && npm run build:ws`, plus the
eval runner and a local UI check. Baseline on `e8081c3`: 213/213 tests, astro check 0 errors,
0 warnings, 3 hints.

## Delivery

Forecast about 2000 authored changed lines across T1–T7, above the ~400 heuristic because the
feature spans client, analysis, persistence, UI and an eval harness. Strategy `exception-ok`:
this repo ships by direct push to the deploy branch without PRs (owner policy recorded in
`seo-ranking.md`), so each task lands as its own work-unit commit and the push is asked once
at the end. RDD is off globally (owner decision 2026-09-23): no review ceremony.

## Progress and evidence

- 2026-09-23: research done (sources above). Probe of the gateway with the provided key:
  `GET /v1/credits` 200 (`balance 0`), `GET /v1/models` lists `typesafe-ai/jev`; `POST
  /v1/evaluate` answers **403 `customer_verification_required`**: the Vercel team needs a
  credit card on file before any request, even the free ones. Real Jev calls are blocked until
  the owner adds it.
- 2026-09-23: `AI_GATEWAY_API_KEY` created on Coolify `testra-app`
  (`lmdqoujklt2lfswzwcsnudlt`, fqdn https://testra.becode.com.ar) as runtime-only literal,
  HTTP 201; Coolify mirrored it to preview. It takes effect on the next deploy.
- 2026-09-23: exploration done (code map). Worktree created, `npm ci` OK, baseline green.
- 2026-09-23: T1–T3 done by the phase A writer. Commits: T1 `8b04fb9` (Jev client,
  `serverEnv` getters, `.env.example`), T2 `cd8ca38` (code signals), T3 `f4477e3` (analysis),
  plus `6c429aa` after the parent's readback: the TF-IDF prefilter no longer marks every real
  class as `partial` (`notSelectedPairs` apart from `skippedPairs`), the `maxCalls` cap
  interleaves questions round-robin instead of dropping whole questions, and the 45 s
  deadline aborts in-flight calls through one `AbortSignal` (the client stops retrying on
  abort; a non-JSON 200 is `invalid_response`). Decisions accepted from the writer: a single
  rare shared wrong answer is shown but only `closedPattern` (≥3 rare → strong, 2 → review)
  escalates a pair; `"ok"` is the success status; `not_needed` wins over `not_configured`
  when there is nothing to compare. Variants and shuffled options are handled by comparing
  strictly by question id and option id, built from each student's own
  `questionsForParticipant`. `buildSimilarityClassInput` has no unit test (it touches the DB,
  repo convention).
  Checks: `npx vitest run` 34 files, 253/253 (parent re-ran it: 253 passed);
  `npx astro check` 0 errors, 0 warnings, 3 pre-existing hints.
  `gentle-ai review assess --base-ref e8081c3 --committed-only` → risk `medium`
  (`configuration_change`), 2144 lines; RDD off, so it only set the verification depth:
  writer self-verification plus the parent spot check.
- 2026-09-23: synthetic dataset generated with the ai-router (Groq and Gemini answered, 31
  calls, 199 s): 6 questions × 24 answers (14 independent, 3 memorizers of the class
  definition, 2 sharing a common misconception, 1 with a distinctive mistake, 4 copies:
  near-verbatim, partial, paraphrase, shared mistake), 24 positives, 24 hard negatives; all
  lexical sanity checks pass. One crude slang phrase replaced by a neutral one before
  committing (the repo is public).

## Next step

Phase C (T4 evaluation) with the same writer, then phase B (T5–T7).
