# Compact toggle and gathering collapse — 2026-11-11

Requested: artwork toggles controls; separate expand button; collapse content gathers
into artwork and survives rapid reversal during audio pulse.

Implemented: persistent foreground driven by the liquid reveal MotionValue. Position,
scale and opacity derive from the same progress, with inertia retained on reversal.
Hidden controls become inert immediately, while visual contents finish gathering.
The four-button controller retains its 152x60 geometry; artwork remains 60x60.
Clicking artwork during a pending expand cancels the intent. Notice/default pill
activation still opens the full player.

Validation: 54 frontend tests and TypeScript passed. Browser checks in light with
beat loop and dark/right/bottom: eight toggles at 90 ms intervals preserve the same
DOM group, finish resting without accidentally opening the full player. At 150 ms
into collapse the group is still rendered and has moved from ~118 px separation to
~24–28 px from artwork; at rest centers coincide and controls are inert. Dedicated
expand button opens full player. All seven state scenarios return to 60x60 by 3 s.
Proof: .codex-backups/compact-toggle-expand.png. No new dependencies.

Native release build passed, executable copied with matching SHA256 and relaunched. Previous executable: .codex-backups/Isla-before-toggle-collapse.exe.
