# Changelog

## [1.0.2] — 2026-11-12

### Click-through hotfix

- Clear the previous panel hitbox and transient pointer/menu capture state when switching window modes.
- Serialize/coalesce animated hit-region updates and reject geometry from a previous expanded/collapsed mode.
- Retain pointer release only for presses originating on visible Isla UI; background clicks no longer inherit capture from the previous window state.
- Apply native click-through through one owner, retry failed updates, and refresh the flag on mode changes.
- Exclude hidden, inert and zero-size regions from hit testing.
- Remove the technical "The showcase" section and render commands from the main README.

Validation: 61 frontend tests and 42 native tests passed locally, including the
new click-through and IPC regression cases. Full manual desktop input verification
was not completed.

## [1.0.1] — 2026-11-12

### Playback performance

- Decode files on a separate worker with a bounded 250 ms PCM read-ahead buffer.
- Reuse packet conversion buffers and prepare EQ coefficients/headroom outside the audio render path.
- Keep crossfade and progress deadlines advancing during continuous slider/volume commands.
- Reuse upcoming-queue calculations during playback progress updates.
- Add native playback probes and a [Windows performance audit](docs/performance/2026-11-12-playback.md), including raw results and test limitations.

Validation: 39 native tests and 55 frontend tests passed. The 60-second timed
Windows output probe recorded no work-budget overruns or decoder-buffer starvation.

## [1.0.0] — 2026-11-12

Initial public release. See the [release notes](docs/releases/v1.0.0.md) for features,
motion improvements, fixes, platform support and known limitations.
