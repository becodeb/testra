# Testra demo video

A 34 s, 1920×1080, 60 fps product demo rendered from the real Testra UI.
Every frame is a pure function of `t`. The music is composed in code from the
same timeline (`src/timeline.ts`), so the cuts, clicks and beats always line up.

## Requirements

- **Node 22.18+** (24 recommended). The tools import `src/timeline.ts`
  directly through Node's built-in type stripping.
- **Chrome, Chromium or Edge.** Found automatically: `CHROME=` first, then
  - macOS: `/Applications/Google Chrome.app`, `Chromium.app`, `Microsoft Edge.app`
    (also under `~/Applications`)
  - Windows: `Program Files`, `Program Files (x86)` and `%LOCALAPPDATA%` for Chrome,
    Chromium and Edge
  - Linux: `chromium`, `chromium-browser`, `google-chrome`, `google-chrome-stable`
    or `microsoft-edge` on `PATH`
- **ffmpeg 6+ with ffprobe** (with libx264). Found through `FFMPEG=` / `FFPROBE=`,
  then `PATH`, then `~/.local/opt/ffmpeg/`.
- The repo's own dependencies: run `npm ci` once at the repo root. The video
  adds no packages of its own.

## Draft and final renders

Run these from the repo root:

```sh
npm ci                                   # once
npm --prefix video run build             # scene → video/dist
npm --prefix video run music             # → video/build/music.wav (34.000 s) + onset check
npm --prefix video run render:draft      # → video/out/testra-demo-draft.mp4 (scale 1)
npm --prefix video run render:final      # → video/out/testra-demo.mp4 (scale 2, supersampled)
```

To use several cores, add `-- --jobs 4`, for example
`npm --prefix video run render:final -- --jobs 4`. Each job runs its own
Chrome and ffmpeg (about 1.5 GB of RAM per job at scale 1, measured on
Linux, and more at scale 2).

Expected times: on a Raspberry Pi 5 (one job, software raster), the draft
takes about 45–55 min. The final takes about 3× that. A recent desktop with
`--jobs 4` should do the draft in 5–10 min and the final in 15–30 min.

Other commands:

```sh
npm --prefix video run stills            # review stills → video/out/stills/
npm --prefix video run selftest          # proves the motion-blur averaging is exact
node video/tools/render.mjs --from 16 --to 18 --out video/out/test.mp4   # a test range
npm --prefix video run concat -- --out video/out/x.mp4 a.mkv b.mkv        # join chunks by hand
```

The render options are `--scale 1|2`, `--jobs N`, `--chunk S`, `--blur N`,
`--blur-max N`, `--ghost-px P`, `--gpu`, `--no-audio`, `--crf N` and
`--tune X`. Each one is documented at the top of `tools/render.mjs`.

## How rendering works

- **Chunks and resuming.** Frames go to lossless FFV1 chunks in
  `video/build/chunks/<scene>-<settings>/` (4 s each). A rerun reuses every
  chunk that decodes to the right frame count, so a crash or restart costs at
  most one chunk per job. Rebuilding the scene changes `<scene>`, so stale
  frames are never mixed in. `--jobs` doesn't move chunk boundaries, and every
  chunk starts from a settled page, so the output is the same with any job count.
- **Final encode.** The chunks are joined, converted to BT.709 limited range
  4:2:0 and encoded as H.264 (CRF 14, preset slow, faststart). The music is
  muxed as AAC 256k. Video and audio are both exactly 34.000 s.
- **Motion blur** uses a 180° shutter. A moving frame gets 4, 8 or 16
  subframes, averaged exactly in integers. The count depends on how far any
  on-screen element travels during the shutter, so fast camera moves don't
  strobe. Static frames are captured once.

## Troubleshooting

- **"No Chrome, Chromium or Edge found"**: the message lists every path it
  tried. Set `CHROME=/path/to/chrome`.
- **"ffmpeg not found"**: install ffmpeg 6+ (Homebrew, winget or your
  distro's package), or set `FFMPEG` and `FFPROBE`.
- **Times and dates in the UI**: the browser's timezone is pinned to
  America/Argentina/Buenos_Aires over CDP, so the clock values match on every machine.
- **Fonts**: Inter and JetBrains Mono are bundled from `node_modules`
  (`@fontsource-variable/*`) into `video/dist`. System fonts are never used,
  and the renderer waits for the fonts to load before capturing.
- **Determinism**: rendering the same `t` twice gives identical pixels on one
  machine. Different operating systems rasterize text slightly differently,
  so don't mix chunks rendered on different machines. GPU raster is off by
  default; `--gpu` (or `CHROME_GPU=1`) can speed things up at the cost of
  that guarantee.
- **Out of memory**: lower `--jobs`, or use `--scale 1`.
- **`video/dist is missing`**: run `npm --prefix video run build` first.
