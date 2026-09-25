# Testra demo video

A 24 s, 1920×1080, 60 fps product demo rendered from the real Testra UI.
Everything is deterministic: each frame is a pure function of `t`, and the
music is composed in code from the same timeline.

## Requirements

- Node 24 (global `fetch`/`WebSocket`, `.ts` type stripping).
- Chromium at `/usr/bin/chromium` (override with `CHROMIUM=`).
- Static ffmpeg/ffprobe. Looked up in this order: `FFMPEG=`,
  `~/.local/opt/ffmpeg/ffmpeg`, `/tmp/tools/ffmpeg`, `ffmpeg` on PATH.

## Pipeline

```sh
# 1. Build the scene (Vite + React, imports the app's real components)
npx vite build --config video/vite.config.mjs

# 2. Stills for review → video/out/stills/
node video/tools/still.mjs 1.0 13.2 21.6

# 3. Music → video/build/music.wav (48 kHz stereo, exactly 24.000 s)
node video/audio/compose.mjs
node video/audio/onsets.mjs          # kick onsets vs the beat grid

# 4. Render → video/out/testra-demo.mp4 (H.264 CRF 14, BT.709, AAC 256k)
node video/tools/render.mjs
node video/tools/render.mjs --from 12 --to 14 --out video/out/test.mp4
node video/tools/render.mjs --scale 2          # supersampled 4K → 1080p
node video/tools/render.mjs --selftest         # blur averaging is exact
```

`src/timeline.ts` is the single source of truth for timing: the scene, the
music and the foley all read it.

## Rendering notes

- Motion blur uses a 180° shutter. Frames where something moves get 4, 8 or 16
  subframes, averaged exactly. The count depends on how far any on-screen
  element travels during the shutter, so fast camera moves don't strobe.
  Static frames are captured once.
- Frames go to lossless FFV1 chunks in `video/build/chunks/<scene>-<settings>/`
  (`--chunk` seconds each, 4 by default). A rerun skips every chunk that
  decodes to the expected frame count, so a crash costs at most one chunk.
  Rebuilding the scene changes `<scene>`, so stale chunks are never reused.
- Join chunks by hand (for example ones rendered on separate runs with
  `--out part.mkv`):
  `node video/tools/concat.mjs --out video/out/testra-demo.mp4 a.mkv b.mkv`
  (`--from <s>` if the first chunk doesn't start at 0).
- Run one Chromium at a time on the Pi.
