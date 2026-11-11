# Live audio output detection

User sees only Speakers in Isla while Windows exposes Headphones and Speakers, and wants to retain per-app output selection. Confirmed Windows registry has both active render endpoints. Read-only CPAL diagnostic (`cargo run --example audio_outputs`) reports both and Windows default Headphones. App only fetched devices once at bootstrap: UI list/default label stale.

Implement native active-endpoint monitoring at1.5s, asynchronous enumeration command, frontend event subscription plus focus/manual refresh. System Default follows default changes while preserving current position/play state. Explicit outputs remain selected through default changes; a removed explicit endpoint pauses and reports unavailable instead of silently playing elsewhere. Remember disconnected selection in UI. Keep light/dark styling.

- [x] RED/GREEN route policy regressions: default change, explicit isolation, removal and reconnect/no-auto-play.
- [x] Native monitor, strict endpoint opening, route handoff and stale-list-safe UI refresh; present refresh and selection status in Settings.
- [x] Verify actual CPAL enumeration, UI both themes, missing-device label, tests and native build; independent routing/lifecycle review; package/relaunch.

Verification: 37 frontend and 30 Rust tests pass; TypeScript/Vite and native release builds pass. CPAL diagnostic lists Realtek Speakers and Headphones (plus the currently active FxSound virtual endpoint). Browser fixture verifies live removal/reconnection, explicit speaker selection retained, disconnected headphones selected/status, light/dark rendering. It simulates notifications, not physical hardware routing. Reviewer findings fixed: subscribe before initial snapshot, and output failures cannot flag existing music files as missing. Follow-up review found no remaining actionable issues. Packaged release/Isla.exe SHA256 matches built binary; previous binary backed up before replacement.

No changes to global Windows routing. Native diagnostic opens no stream. Hardware unplug/replug and subjective audio listening require direct device testing; do not claim them from simulated events. Source backup `.codex-backups/before-output-device-detection.zip`.
