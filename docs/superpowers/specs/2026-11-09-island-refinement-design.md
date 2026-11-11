# Isla island refinement

User approved the audit recommendations and requested implementation, preserving a next-song notification and expressive, fluid iOS/macOS-inspired motion.

Use the existing unified shell and React/Motion/Tauri stack. Keep pause and next available in compact, notification and volume states. Prioritize volume interaction over automatic track notices, then resume a notice only while its lifetime remains. Keep notifications for 2.4 seconds; reserve particles for a single favorite/most-played accent. Animate the shell with damped springs and fade/slide content; reduced motion uses short fades, no bounce/rotation/particles.

Native hit testing follows actual animated shell bounds, including rounded corners, without large invisible desktop blockers. Hidden layers are inert; focus follows the active layer. Keyboard shortcuts preserve native button activation. Improve secondary text contrast, expanded header spacing, navigation and album tint. Preserve existing library/playback features.

Use lightweight progress events without queue/artwork payloads. Remove full BPM analysis from the playback command path and cache analysis in background work. Extract artwork color from decoded image pixels.

Alternatives: additional animation overlays would retain the current state collisions; a full application redesign would add unnecessary scope. Refine the existing shell, as accepted by the user.

Verification: frontend behavior tests, Rust geometry/progress/color tests, typecheck, production build, Rust test suite, and visual inspection where available.

User steering: next-song must look materially different from the normal player, not only an added label. Notification shell is 360×100 with radius 32, versus default 260×58. Use a separate handoff composition: header and relocated transport above a route from a receding outgoing cover to a larger incoming artwork/title/artist. Keep normal playback layout separate and animate transport movement with layout springs.

Spring refinement: use mode-specific physical springs with shared position/dimension physics to preserve anchored edges. Notice k300/d25.5/m0.9 (~2px width overshoot), expanded k285/d31/m0.9 (no width overshoot), volume k340/d28/m0.8, return k330/d29/m0.9. Radius settles with k260/d28/m0.8; content and transport use coordinated springs with short independent opacity/blur fades. Drag is immediate and reduced motion uses a 100ms tween. The shell stays mounted so interrupted morphs retarget its current motion rather than resetting.

Latest user steering supersedes the white handoff layout above: user rejected the two-small-covers/arrow card. Replace with an obsidian live music activity (372x140/r40), 64px hero artwork with a peeking vinyl layer, bold incoming title and artist, album-tinted aura and waveform, subtle outgoing caption and persistent transport at bottom right. Animate old cover receding/new artwork springing in and fade the shell to black. Remove colored outline and the previous side-by-side arrow layout. Normal/volume/expanded styling remains unchanged. Notification lifetime is 3.2 seconds. Browser verified composition in both standalone fixture and real App flow; controls remain accessible.

Final theme correction: user explicitly rejected forced black. Preserve the latest activity layout and all geometry/spring/cover motion; inherit the existing surface, text, divider and shadow tokens for light/dark/system. Sheen, artwork shadow, favorite color and transport surfaces use theme variables. Remove the black shell overlay and dark-only shadow and reuse the already theme-adjusted effective accent. Regression added for preserving the light-theme accent; 19 frontend tests and production/native builds pass. Expanded-player screenshot received next is an audit request only; no additional expanded layout rewrite authorized by that question.
