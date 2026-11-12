# Windows input regression audit — Isla 1.0.5

Fixes a native hit-test panic that could leave the transparent window intercepting
desktop clicks and prevent dragging the artwork after collapsing the player.

## Root cause

Pulse and morph animations produce fractional circular bounds. The old hit test
clamped between `x + radius` and `x + width - radius`. Although mathematically
equal for a circle, these endpoints can round differently in floating point.
Rust panics when the lower endpoint exceeds the upper endpoint.

This happened while the input worker held shared window state. The worker died,
the mutex became poisoned, and subsequent geometry and drag commands failed.
Earlier hitbox/flag changes did not eliminate this panic.

## Changes

- Replace the clamp with a center-based rounded-rectangle distance calculation.
- Keep input failures from killing the native input worker permanently.
- Recover poisoned transient window state and release stale capture/drag state.
- Preserve light/dark styling, spring motion, shadows and audio playback behavior.

## Regression coverage

- Exact pre-fix panic: `x=396.0000173`, `width=70.5244129544237`,
  `radius=35.26220647721185`. The old calculation panicked with lower endpoint
  `431.2622237772119` and upper endpoint `431.26222377721183`.
- 10,000 fractional pulse frames and poisoned-mutex recovery.
- Real production frontend and native backend with WebView2, on a private test
  desktop that is never switched into view. Fixture mouse messages stay inside
  that fixture; the user's mouse, keyboard and applications are not controlled.
- Button, blur, idle collapse and expanded-player drag, at top-left and bottom-right
  anchors with pulse active; verify outside input target, artwork interaction,
  native window movement and release.
- Headless light/dark and edge-position DOM/drag regressions.

Validation: 51 native unit tests pass. Eight real WebView2 scenarios pass with
default browser settings and active pulse. Additional renderer-pointer movement
checks confirm that dragging the collapsed artwork changes the native window's
position (not just its internal drag flag).

For Windows developers, the native fixture is opt-in and compiled out of normal
builds. After building the frontend, build Rust with
`--features tauri/custom-protocol,input-audit`, then run `pnpm test:input-native`.
The runner refuses a normal production binary and creates a private desktop for
the fixture. `ISLA_AUDIT_ANCHOR=bottom-right` and `ISLA_AUDIT_MODE` (`manual`,
`blur`, `idle`, `expanded-drag`) select the native regression scenario.

Quit the old Isla process from its tray menu before opening this build; a process
whose input worker has already panicked needs to be restarted.
