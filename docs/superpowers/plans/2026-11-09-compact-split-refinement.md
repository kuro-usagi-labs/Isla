# Compact split refinement

User requested title and artist in the companion pill, equal height with artwork and a fluid duplication/splitting motion. This is a refinement of the approved Compact interaction, retaining two-click expansion and playback isolation.

Controller now264×60, artwork60×60, gap10. Controller starts as a60px circle beneath the artwork and stretches into its own capsule; both use the shared shell spring. Content fades in once the shape begins to separate. Reverse morph rejoins the artwork. Shell union334px; native invisible canvas chooses the side with space, keeping artwork fixed on screen. Light/dark, real audio pulse and reduced motion preserved.

Verification: updated geometry/metadata tests RED→GREEN; native side-reservation and expanded-drag anchor regressions RED→GREEN. Frontend45 tests, Rust33 tests, frontend production build and native release build pass. Browser QA confirms metadata and exact60px height on both surfaces, right/light and left/dark placement, Pause isolates playback, title opens expanded, pulse uniformly scales both surfaces (observed1.04277). Screenshot `.codex-backups/compact-split-metadata-light.png`.

Independent review found expanded drag could leave middle anchor176, shifting the orb on reveal. Compact expanded-drag anchor now chooses a side (0 or352), covered by regression test. No other actionable findings. Binary backup preserved, release/Isla.exe hash matches built output and was relaunched.
