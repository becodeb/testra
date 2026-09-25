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

## Progress

- 2026-09-25: research done, storyboard approved, branch created, ffmpeg
  static installed at `/tmp/tools/ffmpeg`.
- 2026-09-25: T1 done (`e529a32`). T2+T3 delegated to one writer.
- 2026-09-25: container restart killed the draft render and wiped /tmp;
  ffmpeg moved to ~/.local/opt. T2+T3 done, draft rendered.
- User asked to see the draft before the final render.

## Next step

T4: user feedback on the draft + known issues (13.2 "Informado por el
navegador" half cut by its reveal; heavy blur on the 12 s and 14 s camera moves).
