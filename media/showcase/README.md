# Isla launch film source

Run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm showcase:build
pnpm showcase:preview
pnpm showcase:check
pnpm showcase:draft
pnpm showcase:render
pnpm showcase:package
```

Install FFmpeg/ffprobe on PATH and Chromium with `pnpm exec playwright install
chromium`. For an existing Chromium installation, set `CHROME_PATH` to its
executable. Hyperframes can use its own browser via `pnpm exec hyperframes browser
ensure`. The draft is 30 fps; the final is 60 fps with two shutter samples and
2× internal resolution, downsampled to 1080p for sharp close-ups.

Edit `../showcase-template.html` and `../showcase-ui.tsx`, then regenerate using
`showcase:build`. The builder renders the real React components and bundles the
production liquid contour and EQ curve functions. Generated browser libraries,
app CSS and score are rebuilt from the lockfile. Fonts and sound samples are local.

`scripts/render-launch.mjs` adapts Barty's deterministic `seek(t)` render contract:
parallel frames, shutter sampling, H.264 encoding and a two-pass normalized audio
mix. The camera is baked at load, so rendering out of order gives identical poses.
Hyperframes supplies the timeline preview and full composition checks; its
alternative renderer is available as `pnpm showcase:render:hyperframes`.
The timeline preview carries the original score; the Barty renderer adds the
fourteen interaction cues and normalizes the final mix.

`SPEC.md` documents the shots, `REVIEW.md` records verification and `CREDITS.md`
lists sources. Final MP4 and GIF files are published in `docs/media/`.

Third-party notices: Barty-Bart/motion-graphics (MIT, license in
`.agents/skills/BARTY-LICENSE`), Motion (MIT), Hyperframes (Apache-2.0), Inter (SIL
Open Font License, included in assets), GSAP ([Standard License](https://gsap.com/standard-license/)),
and the CC0 samples credited below. The synthesized score uses no song samples.
