# Unified motion and idle return

User-authorized refinement of the existing artwork-centered Dynamic Island design.
Keep light/dark, real audio pulse, stable clickable controls, native window bounds.
Use the existing Motion springs, no added animation dependency. Reference one shows
stretch/separate/rejoin; reference two shows restrained macOS Dock magnification.
Figma community preview supplies compact and expanded content hierarchy.

- [x] One idle controller: 2400 ms to return every open state to base; volume 1100 ms.
  Actual clicks, keys, wheel and input restart. Hover does not. Holding a drag/slider
  suspends expiry until release; state changes must not lose the hold.
- [x] Animate content translation/scale from the anchor, short follow-through stagger,
  reverse on collapse; compact controller contents follow split direction. Keep
  hit regions stable, preserve reduced motion. Remove competing activity timers.
- [x] Verify timer cancellation/restart/hold tests, frontend build, browser compact,
  expanded, notice, volume, themes and rapid interactions; package native release.

Review focus: timer cannot reset on playback ticks; hidden controls inert; next-song
cannot restore old satellite; pointer release outside shell; idle return within 3 s.

## Verification
- 54 frontend tests passed, including idle reset, held interaction and stale timer cancellation.
- 33 Rust tests passed. Production TypeScript/Vite build passed (existing >500 kB chunk advisory).
- Browser DOM audit: compact light and dark/right/bottom return to 60x60 after 3 s
  for controls, expanded, song notice, volume, queue, equalizer and library.
- Large dark returns 292x62; default reduced-motion returns 260x58 after 3 s.
- Found and fixed internal merge/expand phases restarting the deadline; automatic
  track changes in expanded mode no longer reset it. Context menu shares capture handlers.
- Independent review: no remaining actionable findings after fixes.
- Fresh proof tab has no console errors; older development tabs logged HMR-only
  createRoot/effect-dependency-size warnings during source edits, removed by reload.
- Visual proof: .codex-backups/unified-motion-expanded.png.


Delivery: rebuilt and packaged release/Isla.exe on 2026-11-11. Fresh frontend 54/54, TypeScript/Vite and native release build passed. Previous executable backed up as .codex-backups/Isla-before-unified-motion.exe.
