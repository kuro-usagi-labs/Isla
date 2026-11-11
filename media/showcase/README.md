# Isla showcase source

Run these from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm showcase:build
pnpm showcase:preview
pnpm showcase:check
pnpm showcase:render
```

FFmpeg and ffprobe must be on PATH for audio validation and rendering. Hyperframes
can install its own headless Chrome with `pnpm exec hyperframes browser ensure`.

Edit `../showcase-template.html` and `../showcase-ui.tsx`, then regenerate with
`showcase:build`. The builder reads the real production React components and
bundles the production liquid contour and EQ curve functions. Generated browser
libraries, app CSS and soundtrack are not committed; rebuild them from the lockfile.

`SPEC.md` describes the film. `REVIEW.md` records visual verification. The finished
MP4 and GIF are published under `docs/media/` for GitHub Pages and the repository.

Third-party notices: Motion (MIT), Hyperframes (Apache-2.0), Inter (SIL Open Font
License, included in assets), and GSAP (Standard License,
https://gsap.com/standard-license/). Motion and GSAP are copied from the installed
packages when building the editable project. The soundtrack is synthesized by
`scripts/build-showcase.mjs` and uses no third-party audio samples.
