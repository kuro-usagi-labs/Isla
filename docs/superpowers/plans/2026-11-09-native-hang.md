# Native drag deadlock investigation and fix

User reported real Not Responding. Process18560 confirmed Responding=False. Captured LLDB native stacks before restart in `.codex-backups/hang-18560-backtrace.txt`; main thread blocked in WaitOnAddress, while audio thread remained separate. Release stripped symbols limit exact frame naming.

Source confirmed a lock-order cycle: window interaction thread holds WindowStateMemory mutex while calling available_monitors/current_monitor; Tauri runtime window_getter sends a message to main thread and waits on recv. Synchronous set_island_bounds runs on main thread and waits for same mutex. Pulse increases frequency of bounds commands, making drag contention much easier to hit. UI fixture had not exercised native drag/window calls.

Fix: query cached monitor snapshots before acquiring interaction-state lock, never call window APIs or emit from inside that lock, and make bounds IPC asynchronous so frame traffic cannot block the native event loop. Cache monitor topology during drag at250ms intervals. Keep short, pure geometry/state updates inside mutex. Preserve theme, pulse and audio behavior.

- [x] Add reentrant monitor-query regression, observe failure with original lock scope, release guard before callback and integrate snapshot before tick lock.
- [x] Run full tests and optimized build. Independent lock-order review. Replace hung process after capturing evidence, package/relaunch and inspect native UI responsiveness.

Verified26 Rust tests, including a RED→GREEN regression simulating a monitor callback reentering state to service UI bounds, for both compact and expanded drag. Cached monitor topology now refreshes on drag entry and every250ms while active; reviewer caught and resolved a stale-topology edge for short drags after display changes. All Tauri/Win32 window operations, event emission and DB writes in the interaction loop run outside its state guard. Bounds command is async. Review found no remaining actionable lock-order/lifecycle issue.

Native process was restarted only after LLDB detached and evidence was saved. New executable hash matches optimized build; UI accessibility content is available again and Responding=True. Attempted native drag automation was rejected by computer-use's click-through target guard before input; do not claim a completed native drag stress test. Native shortcut attempts did not visibly change playback during observation. No library/settings deletion or migration performed.

Backup `.codex-backups/before-deadlock-fix.zip`. No Git repository. This is a real native concurrency fix, not an animation fallback.
