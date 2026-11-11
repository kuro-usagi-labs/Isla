# Island refinement implementation plan

Goal: keep the next-song activity expressive and usable while improving motion, native interaction and playback performance.

Architecture: retain a single animated shell; centralize visual state geometry and motion policy. Publish its animated bounds to the native interaction controller. Keep metadata events separate from progress ticks.

Tech stack: React 19, Motion, TypeScript, Tauri 2, Rust.
Spec: ../specs/2026-11-09-island-refinement-design.md

Constraints: preserve local library and existing settings, preserve expressive motion by default, no replacement architecture or service.

Review focus: volume during notifications; rapid next/previous; bottom/right edge pill morphs; hidden focus and Space activation; progress updates cannot overwrite a different track.

- [x] Task 1: regressions observed failing before fixes: controls, activity priority, hidden layer semantics, geometry, progress payload, artwork hue.
- [x] Task 2: compact shell, handoff notification, shared motion/geometry, keyboard/focus, panel/navigation and theme contrast implemented. 17 frontend tests and TypeScript build pass.
- [x] Task 3: animated rounded native hit bounds, background BPM cache, lightweight progress and pixel-derived cover accents implemented. 9 Rust tests pass.
- [x] Task 4: browser visual checks for normal pill, notification, volume interruption, panel/navigation, dark theme and reduced motion; independent code review completed without remaining actionable findings. Release packaged at release/Isla.exe.

Ruling: no Git repository exists, so work in the provided workspace with .codex-backups/before-island-refinement.zip; no worktree or commits are possible. Execute inline under the user's explicit implementation request. Source audit already established root causes. Visual CSS changes use render checks; regression tests focus on state/interaction contracts.

Final steering: notice now uses 360x100/r32 with a separate outgoing-to-incoming artwork route and transport above, rather than normal playback content plus a label. Transport stays mounted and moves via a layout spring. Volume wins even when the track changes during its overlay lifetime (browser regression reproduced, then fixed).

Validation limitation: native executable launches and exposes only active-layer controls in the accessibility tree. CUA pointer validation is inconclusive for a cursor-dependent click-through window because it checks the future click point before moving the actual cursor. Rounded-bounds behavior is covered by Rust tests; live mixed-DPI/multi-monitor pointer traversal was not verified.

Existing saved cover accents require a library rescan to replace earlier hash-based values. The development-only scripts/island-preview.html uses fixture songs and is excluded from the production entry point.
