# Feature: product demo video ("demo-video")

Locator: `odd/tasks/demo-video.md` · Engram mirror: `odd/demo-video/tasks` (project `testra`)
Branch: `feat/demo-video` from `feat/postgres-coolify` @ `33fbc74`. Not pushed.

## Objective

A ~24 s product demo video (1920×1080, 60 fps, 120 BPM) that answers "¿qué es
Testra?" by showing the real UI: create → open the room → students join live →
activity signal with context → AI suggests, the teacher decides → publish.

## Why

User request (2026-09-25): premium motion-design explainer, real Testra UI, no
invented features, storyboard approved before implementation ("continua").

## Scope

Authorized: a self-contained `video/` folder in this repo (scene, audio,
renderer), plus this document. Nothing under `src/` changes; the scene imports
from `src/` read-only. Rendered media stays out of git (`video/build/`,
`video/out/`). Push, PR and merge are the user's decisions.

## Constraints

- Real UI: the repo's compiled `src/styles/global.css` (Tailwind v4 via
  `@tailwindcss/vite`), `src/components/ui/*` primitives, `lucide-react` icons,
  `src/assets/testra-logo.png` / `testra-mark.png`, Inter Variable and
  JetBrains Mono Variable. Markup and classes copied from the real components
  (`exam-editor.tsx`, `live-run-monitor.tsx`, `join-run.tsx`,
  `ai-correction-review.tsx`, `results-workspace.tsx`, `publish-results.tsx`).
- UI copy is literal from the code. Invented data only where plausible (extra
  student names), never invented features.
- Deterministic: every frame is a pure function of `t`; no timers, no
  `Date.now()`, no CSS transitions/animations in the scene.
- Music is composed in code (FreePD closed 2026-09-25; Internet Archive search
  failed), so the beat grid is exact and there is no license risk.
- Environment: Raspberry Pi 5 (aarch64, 4 cores, ~1 GB free RAM). ffmpeg is a
  static build at `~/.local/opt/ffmpeg/` (symlinked at `/tmp/tools/`, which a container restart wipes; not on PATH). The repo's Playwright
  hangs on `page.screenshot` with `/usr/bin/chromium`: drive Chromium over CDP
  from Node instead (Node 24 has `fetch`/`WebSocket`).
- Repo conventions: Spanish conventional commits, no AI attribution.

## Storyboard (approved 2026-09-25)

120 BPM → beat 0.5 s, bar 2 s. Cursor = the teacher; the student types with a
caret only. The top nav stays fixed and its active underline slides between
sections. Eyebrow copy from the landing: CREÁ LA EVALUACIÓN · ABRÍ LA SALA ·
CORREGÍ · PUBLICÁ.

| t | Beat | UI | Cursor | Camera |
|---|---|---|---|---|
| 0:00 | Creá | Editor question card, click "Fotosíntesis" radio @1.0, "Guardado" spinner→check, bubble 1 gets check | enters, click | 1.35×, card springs in |
| 0:02 | Lista | "EVALUACIÓN LISTA" header, bubbles 1·2·3 checked | click "Preparar para el curso" @3.0 → "Preparando sala…" | pull out to 1.0 |
| 0:04 | Abrí la sala | button morphs into the "SALA DE ESPERA" card, code K7M4QH types per 16th | — | zoom to the code |
| 0:06 | Alumno | code chip lifts into "Entrá a tu evaluación" input; blur swap to "¿Cómo te llamás?"; types "Lucía Paredes"; presses "Entrar a la sala" | none (student) | pan with the chip |
| 0:08 | Sala se llena | join card compresses into a row in "Alumnos"; 4 more rows per beat; count 1→5 | — | pan back, pull out |
| 0:10 | Iniciar | eyebrow → "EVALUACIÓN EN VIVO", pill → green "En curso", timer 40:00 runs, rows → "Rindiendo" cascade | click "Iniciar evaluación" @10.0 | still |
| 0:12 | **AHA @13.0** | Avance ticks; signal "Tomás Benítez — La evaluación dejó de estar visible (4,2 s)" enters "Avisos de actividad", count 0→1 | — | zoom to the panel (subtitle legible) |
| 0:14 | Cerrar | pill "Cerrada", timer freezes, rows "Entregó"; eyebrow CORREGÍ | click "Finalizar evaluación" @15.0 | pull out |
| 0:16 | Corrección con IA | Sofía's row expands into "Corrección con IA"; "La IA sugiere" counts to 3 de 4 puntos; confidence bar fills | — | push in |
| 0:18 | La nota la ponés vos | "Guardando…" → check; focus on "La nota la ponés vos." | click "Aceptar esta sugerencia" @18.5 | micro push-in @19 |
| 0:20 | Publicá | card collapses into the Resultados row; "Publicar resultados" enables; chip "Publicados" | click @21.0 | pull out |
| 0:22 | Cierre | UI dissolves to canvas; logo + "Evaluaciones en línea que no deciden por vos." | — | converge; last 0.3 s → empty canvas = frame 0 |

Simplifications: no finalize confirm dialog, no join disclosure box, no
Configuración screen; 5 students instead of the seed's 3.

## Tasks

TDD: off (source: no project/session TDD config; vitest exists but that does
not enable TDD). Checks per task are listed inline. Delivery strategy:
`exception-ok` (one self-contained media artifact under `video/`, reviewed as
a whole). RDD: off globally by the user (2026-09-23), no review ceremony.

- [x] T1 — Scene: Vite + React page under `video/` rendering the 12 beats from
  `setTime(t)`, with timeline, springs, camera and cursor as separate modules.
  Route: delegated writer (2+ non-trivial files), plus one QA revision round.
  Checks: `npx vite build --config video/vite.config.mjs` built; 34 stills via
  `node video/tools/still.mjs` with no page errors; same t twice → identical
  sha256 (8.45, 20.3); `tsc` over `video/src` with the repo tsconfig: clean.
  Evidence: commit `e529a32`.
  Deviations accepted: zoom at 0:00 is 1.25× (1.35× overflows the card);
  bubble 1 never gets a check (the real UI never checks the active bubble);
  name types on 32nds; morph boxes are empty for ~0.2 s before content fades in.
  Eyebrow captions dropped (2026-09-25, parent decision): the only clear spot
  was the header, where the pill read as a Testra UI element, which the brief
  forbids; the real eyebrows (SALA DE ESPERA, EVALUACIÓN EN VIVO, CORRECCIÓN
  CON IA) already carry the story.
- [x] T2 — Music: composed 24 s track at 120 BPM with accents on the storyboard
  clicks, written as WAV by a Node script. Route: delegated writer.
  Checks: ffprobe 24.000000 s (1,152,000 frames), deterministic sha256;
  volumedetect max −1.5 dB; loudnorm −15.02 LUFS, TP −1.41; 39 kick onsets,
  mean dev 0.83 ms, max 0.98 ms; loop point clean (last 10 ms −91 dB);
  UI foley ~24 dB under the music.
- [x] T3 — Renderer: CDP frame capture at 60 fps with motion blur on moving
  frames only, piped to ffmpeg, muxed with the music. Route: delegated writer
  (with T2). Deviation: adaptive 4/8/16 subframes averaged in Node (fixed 4 +
  tmix ghosted on fast zooms). Chunked and resumable.
  Checks: `render.mjs --selftest` PASS (no bleed between groups); test 12–14 s
  120 frames 60 fps BT.709; brand #0a2878 decodes to [9,40,120]; full draft
  `video/out/testra-demo-draft.mp4`: 1440 frames, 24.000 s, AAC 48 kHz, peak
  −1.5 dB (parent re-checked). ~31 min at scale 1, ~75 min est. at scale 2.
- [ ] T4 — QA: one still per beat, review legibility, overlaps, click/action
  sync, dead frames, blur; fix what fails. Route: inline review + delegated fixes.
- [ ] T5 — Final render + delivery of the MP4 to the user.

## Storyboard v2 (approved 2026-09-25, supersedes the table above)

User feedback on the draft: the student view is missing, and short text cards
("diapositivas") should explain the key ideas; longer than 30 s is fine. The
user's pitch stresses: varied question formats, assisted correction reviewed
by the teacher, incidents logged with what/when/how long, an individual report
per student, no automatic judgment, and transparency (the student is told).

~34 s, 120 BPM (17 bars). The cursor belongs to whoever's screen is shown.

| t | Beat |
|---|---|
| 0:00 | Card "Creá tu examen." |
| 0:01.5 | Editor: key "Fotosíntesis" marked; "Tipo de respuesta" select opens showing the 5 real types (Opción única, Varias opciones, Verdadero / Falso, Respuesta corta, Desarrollo), closes; click "Preparar para el curso" |
| 0:05.5 | Room morph, code K7M4QH |
| 0:07 | Student joins (code → input, "Lucía Paredes", "Entrar a la sala") |
| 0:09 | Room fills; "Iniciar evaluación" @10; En curso, Rindiendo |
| 0:11 | Card "Mientras rinden, Testra registra." |
| 0:12.5 | Student runtime (real `student-runtime.tsx` look): Lucía on question 2, leaves the window, returns → real dialog "Este evento quedó registrado" + "Estuviste fuera de la ventana 4,3 s. Tu docente ve el mismo registro. Los incidentes no cambian tu nota automáticamente." → "Entendido" |
| **0:17 AHA** | the registered event flies from the student's screen into the teacher's "Avisos de actividad" (Lucía Paredes — La evaluación dejó de estar visible (4,3 s)), subtitle legible |
| 0:19 | "Finalizar evaluación" → Cerrada, Entregó |
| 0:19.5 | Card "Cada aviso, con su contexto." |
| 0:21 | Lucía's per-student report (results detail dialog, "Avisos (2)", real `IncidentCard`): Cambió de pestaña o ventana · 4,3 s · "Estaba en la pregunta 2: …" · what/normal · "Qué conviene revisar: …"; plus "Usó copiar, cortar o pegar" · "Pegó 12 caracteres" |
| 0:24 | Card "La IA sugiere. Vos decidís." |
| 0:25.5 | AI correction (Sofía) 3 de 4 → "Aceptar esta sugerencia" → "La nota la ponés vos." |
| 0:28.5 | Results → "Publicar resultados" → "Publicados" |
| 0:31 | Logo + "Evaluaciones en línea que no deciden por vos." → empty canvas (loop) |

Also fix from the draft: 13.2 "Informado por el navegador" half cut by its
reveal; the fast camera moves around 12 s and 14 s blur text too much.

Delivery (user, 2026-09-25): rendering is slow on this Pi, so push the branch
and hand the user a prompt for the Claude on their computer to clone and
render. Push authorized for `feat/demo-video` only (Coolify deploys
`feat/postgres-coolify`, so this does not deploy).

- [x] T6 — Scene v2 done (`8cb5068`: build ok, stills every 0.5 s reviewed,
  determinism 16.7/29.5 ok, tsc clean; accepted ~0.3 s empty-canvas breath
  between card exit and UI entry at 21.0 and 26.0; report titles follow the
  real IncidentCard copy). Music re-time + portable renderer delegated.
  Music v2: 34.000 s, −15.09 LUFS, TP −1.37, 48 kicks max 1.02 ms off grid,
  loop clean. Portable renderer: tools/find-bin.mjs (Chrome/Edge/Chromium +
  ffmpeg per OS), `--jobs N` (per-chunk reload keeps chunks bit-identical),
  video/package.json scripts, README rewritten; `--selftest` PASS (parent
  re-ran). Untested on macOS/Windows.
  Original scope: Scene v2 + music re-timed to v2 + portable renderer (Chrome and
  ffmpeg auto-detected on macOS/Windows/Linux, env overrides). Route:
  delegated writer. Checks: build, stills per beat reviewed, determinism,
  music checks as T2, renderer selftest.
- [x] T7 — Push `feat/demo-video` and write the local-render prompt (pushed
  2026-09-25 at `f2be34a`; prompt handed to the user in chat).
- [ ] T8 — Final render on the user's computer (`npm --prefix video run
  render:final -- --jobs N`, see video/README.md). The Pi draft render was
  stopped on purpose (redundant) and the Cloudflare tunnel closed.
  Checks: 2040 frames, 60 fps, 34.000 s, 1920×1080, AAC; spot stills sharp.

## Progress

- 2026-09-25: research done, storyboard approved, branch created, ffmpeg
  static installed at `/tmp/tools/ffmpeg`.
- 2026-09-25: T1 done (`e529a32`). T2+T3 delegated to one writer.
- 2026-09-25: container restart killed the draft render and wiped /tmp;
  ffmpeg moved to ~/.local/opt. T2+T3 done, draft rendered.
- User asked to see the draft before the final render. Draft served via a
  Cloudflare quick tunnel (user authorized). Feedback → storyboard v2.

## Next step

T8 on the user's computer. For changes after watching it: edit `video/src`
(timeline in `video/src/timeline.ts`), `npm --prefix video run build`, review
stills, re-run `music` if event times moved, then render. T4/T5 were
superseded by T6–T8.
