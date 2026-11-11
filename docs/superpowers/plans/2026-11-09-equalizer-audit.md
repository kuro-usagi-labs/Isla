# Equalizer audit and fluid control refinement

User asks to verify all presets/sliders affect real audio and improve macOS/iOS-like layout/motion while preserving chosen themes.

Audit plan: share the actual frontend preset data with Rust signal tests. Measure every preset at all ten center frequencies, every band at positive/negative gain, preamp at negative/positive gain, bypass and rapid live updates. Trace preview/persistence and fix discovered failures before claiming audio effects.

Known issue from source tracing: automatic headroom currently includes preamp in its correction, cancelling positive preamp settings; preamp edits while bypassed also do not activate EQ unlike band edits. Test and correct both. Frequencies excluded by the native Nyquist guard must be visibly unavailable for low-sample-rate tracks rather than appearing effective.

Design: retain the 300px drawer and mini-player. Group curve, controls and bass/mids/air labels into one rounded tonal surface. Native accessible ranges remain the interaction layer; independent visual thumbs/fills spring during presets/reset and follow the pointer directly while dragging. Show focused frequency/gain, clearer preset and bypass controls, and retain light/dark tokens, reduced motion, keyboard and double-click reset. Preserve the user's curve when bypassed.

- [x] RED/GREEN native all-band/all-preset/preamp signal audit; preset single source of truth.
- [x] Correct control behavior, persistence failures found during audit, and unsupported-band affordance.
- [x] Refine layout/motion, browser verify both themes and pointer/keyboard behavior, independent review, production/native build and release package.

Results: 30 frontend tests and 19 Rust tests pass. A failing signal test reproduced positive preamp cancellation; correction now compensates only band boosts. Browser checks confirmed drag (63Hz +12 to -10.5dB), keyboard edits, bypass retaining values, preamp reactivation, reset, saved values after drawer reopen, both themes and bottom anchoring. Removed 6px of unnecessary vertical overflow. Independent review found no actionable regression. Native release build and packaged executable were verified; no subjective hardware listening claim.

Source backup: .codex-backups/before-eq-audit.zip. No Git repository. Execute approved scope inline. Synthetic signal measurements establish DSP behavior; do not claim subjective hardware listening.
