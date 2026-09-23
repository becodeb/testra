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
- [x] T4 — Evaluation: does it work? Route: delegated writer (phase C) + parent runs.
  - Synthetic Spanish dataset generated with the ai-router (independent answers, copies:
    near-verbatim, paraphrase, shared mistake; hard negatives: memorized class definition),
    committed as a fixture; eval runner reporting precision/recall/false positives on hard
    negatives, prefilter recall, latency and cost, for code signals, Jev, and an LLM pairwise
    judge through the ai-router as the comparison.
  - Checks: the runner's report, recorded below.
- [x] T5 — Persistence and API. Route: delegated writer (phase B).
  - Table `similarity_reports` (one per run, input hash, JSON report) + migration, a route
    mirroring `/api/ai/reports` (GET cached, POST run) with the run capability check.
  - Checks: unit tests for hashing/staleness; local call against the dev server.
- [x] T6 — Teacher UI. Route: same writer.
  - "Coincidencias entre alumnos" card in the results "Análisis" tab: what is expected,
    run/refresh, ranked pairs with level and one-line evidence, side-by-side answers with the
    shared fragments highlighted, Jev status; the pairs of a student in their detail dialog.
    Teacher-facing text in `src/lib/similarity-copy.ts` with the `{title, what, normal,
    review}` shape of `incident-copy.ts`.
  - Checks: `astro check`, local run on seeded data, screenshot.
- [x] T7 — Docs. Route: same writer.
  - `docs/vigilancia.md` (what is compared, what is sent to Jev, ZDR, limits, non-goals),
    README env var.
- [ ] T8 — Measure Jev for real and calibrate `SEMANTIC_*`. Route: parent runs the harness.
  Blocked on the owner: the Vercel team needs a card on file.
  - `EVAL_JEV=1 EVAL_JEV_VARIANTS=base,no_context,es npm run eval:copias`, plus the LLM
    comparison on the same 120 pairs; adjust `SEMANTIC_STRONG_PROBABILITY` /
    `SEMANTIC_REVIEW_PROBABILITY` from the numbers.

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

- 2026-09-23: T4 done by the same writer (`de4d459` harness, fixture, generator,
  `npm run eval:copias`; `f79211c` calibration) and the parent (`2eb8142`). Results
  (`scripts/copy-eval/results/`):
  - Code fragments: precision 93.8 %, recall 62.5 % (verbatim 100 %, partial 83 %, shared
    mistake 67 %, paraphrase 0 % — by construction, that is Jev's job); 0 of 18
    class-definition hard negatives flagged. The one false positive is an idiom two students
    used independently.
  - TF-IDF prefilter: 24/24 copies inside the budget of 72 of 276 pairs.
  - LLM judge through the free ai-router (120-pair sample, same context): precision 58.3 %,
    recall 87.5 %, **72.2 % false positives on students who only repeat the class
    definition**, 17.5 % parse/transport failures, p50 629 ms. Consistent between runs.
  - Closed questions: the first rule (≥2 rare shared wrong answers) flagged 19.3 innocent
    pairs per 30-student class. Replaced by an expected-by-chance model (Poisson-binomial
    over the questions both got wrong, collision probability from the rest of the class,
    corrected by the number of pairs): with α_review = 1, α_strong = 0.01 the innocent pairs
    flagged drop to 0.045 (15 mc) and 0.12 (mixed) per class, detection 12 % (15 mc only), 0 %
    (true/false only — sharing a wrong true/false answer says nothing), 50.5 % (mixed with
    short answers). The writer had picked 0.05/0.001; the parent changed it because the
    runner chose by worst-case detection, which true/false pins at 0.
  - Fragment "run alone" trigger calibrated to 11 tokens: at 8–10 it flags memorizers of the
    class definition. On this dataset it adds nothing; kept as a safety net.
  - Jev: stops cleanly on `billing_required` after the first 4 concurrent calls; zero numbers
    made up. Moved to T8.
  Checks: `npx vitest run` 259/259, `npx astro check` 0/0/3 hints, `npm run eval:copias` OK.

- 2026-09-23: T5–T7 done by a fresh phase B writer. Commits: T5 `36c845e` (table
  `similarity_reports` + migration `0008`, `src/server/similarity-reports.ts` with a
  name-independent input hash and in-process dedupe, `/api/ai/similarity` GET/POST), T6
  `99f55e8` (card "Coincidencias entre alumnos" first in the Análisis tab, student dialog
  section, `src/lib/similarity-copy.ts`, demo seed `npm run db:seed:coincidencias`), T7
  `eb90e90` (`docs/vigilancia.md`, `docs/coincidencias-evaluacion.md`, README).
  Parent review of the screenshots found a real bug: fragment highlights landed on the other
  student's answer (spans computed in name order, stored under the id-sorted pair key), cutting
  words ("p|ara", "cu|ando"). Fixed in `0316838` with a regression test with ids out of array
  order; same commit lists the shared wrong answers of every flagged pair, significant or not
  (`closedPattern.questions`). `95f654e`: each answer labeled with its student, "Coincidencia
  fuerte" in the warning tone and "Para revisar" neutral (the hierarchy was inverted).
  Parent: `684008d` singular "la eligió 1 compañero más"; `debe308` the evaluation doc no
  longer implies Jev beats the LLM judge before measuring it.
  Migration note: `drizzle-kit generate` re-emits already-applied DDL here because 0005–0007
  were hand-written without snapshots; `0008` was trimmed to the new table and checked with
  `npm run db:migrate` on the local DB.
  Checks: `npx vitest run` 35 files, 267/267 (parent re-ran); `npx astro check` 0/0/3 hints;
  `npx astro build && npm run build:ws` OK. Local end to end on `node server.mjs` :4391 with
  the demo seed: POST → `semantic.status unavailable`, `reason billing_required`, 4 pairs from
  code signals, the planted pair strong on both long questions plus 4 shared wrong answers
  (by chance 1.9), none of the 3 memorizers flagged; GET after POST cached (`stale:false`);
  one answer edited in SQL → `stale:true`; POST again regenerates. Hero pair highlights
  after the fix are identical whole-word strings on both sides. Screenshots desktop 1280 and
  mobile 390 in `/tmp/testra-jev-shots/`. `gentle-ai review assess` over bf46477..95f654e:
  risk `medium` (`executable_change`); RDD off → writer self-verification plus parent spot
  check.
  Re-probe of the gateway at the end: still 403.

## Next step

Owner: add a card to the Vercel team (AI Gateway) — Jev is free until 2026-09-25 — then run T8
and decide push/merge/deploy. Until T8, Jev's thresholds (0.9/0.7) are unmeasured starting
values, and the key already on Coolify would switch Jev on in production as soon as billing
works.
