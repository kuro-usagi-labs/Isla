# Live playback motion and interaction audit

User authorizes auditing and fixing pulse, hover, transport, next-song and expanded-player flow in both themes. Preserve full-UI uniform audio-driven pulse and existing light/dark appearance; no decorative-only pulse or forced dark activity.

Evidence: during next → expand → collapse within3.2s, old Next Song activity reappeared. Source shows hook cleanup jumps pulse to zero on every mode/track change, while pulse transform origin uses destination rather than animated geometry. Transport changes from flex to absolute with differing widths/gaps between resting and notice state. Previous/Next have24/27px widths. Native rounded radius does not include displayed pulse scale.

Design: pulse eases to rest when paused/hovering controls/morphing, immediate reset only for reduced motion/unmount. Keep its center tied to the shell's actual animated geometry. Anchor controls consistently bottom-right with fixed sizes and shared tap feedback; reserve metadata space separately. Hover highlights use theme tokens and do not reflow. Clear activity timers on entering expanded mode so collapse returns to now playing. Keep rounded clip and actual animated native hit bounds.

- [x] Reproduce baseline, add failing interaction guard/geometry regressions, implement motion/transport cleanup.
- [x] Browser-test active progress and continuous beat fixture: hover/click/next/rapid next/expand/collapse, volume interruption, reduced motion and both anchors/themes.
- [x] Review fixes independently, run frontend/native checks and optimized builds, package/relaunch release.

Results:34 frontend tests,25 Rust tests, TypeScript/Vite production and optimized native builds pass. A failing guard test reproduced pulse continuing during control interaction. Browser baseline reproduced stale next-song after rapid expand/collapse; corrected behavior settles on regular player. Source review and browser measurements validate unified bottom/right controls,32/34px targets, critically damped retirement, actual animated pulse origin, scaled corner radius, token-based hover in both themes, volume priority and single Space/Escape behavior. Continuous beat fixture uses480ms onsets and90ms progress updates. Hover converged to identity with260×58 native bounds; actual and published rectangles now match exactly after morph and pause.

Extra audit findings fixed: StrictMode cleanup cancelled but did not null boundsFrame, blocking replay publication. Final Motion style writes could occur after an animation-complete measurement, leaving a subpixel stale hitbox. Both frame refs now cancel/null safely, with a delayed settled measurement. Independent reviewer found no remaining actionable regression, including follow-up frame lifecycle review. Native application observed playing a local song with Pause present; deeper UI interaction stopped when user input took control. No subjective audio/device-latency claim.

Execute inline in current workspace; no Git repository. Backup `.codex-backups/before-motion-interaction-audit.zip`. Browser fixture tests UI/event behavior; native beat detector unchanged and separately signal-tested.
