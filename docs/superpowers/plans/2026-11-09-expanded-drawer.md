# Expanded player drawer implementation plan

User approved the preceding audit: make Now Playing and Play/Pause dominant; queue becomes an explicit drawer; preserve chosen light/dark/system, directional anchoring and fluid springs.

Design: resting expanded player 412x268/r28, opening a drawer morphs the existing shell to 412x388/r28. Bottom-anchored windows grow upward and place drawer above player; top-anchored windows grow downward. Default player uses a 76px cover, clear title/artist, full-width scrubber, centered 56px primary transport and quiet shuffle/repeat/crossfade. Queue mode compresses player to 232px leaving a 156px drawer. Library mode uses an 88px mini-player and the remaining 300px for existing library/settings views. Queue and Library have separate labeled buttons. Closing a drawer returns focus to its trigger. Escape closes volume then drawer before collapsing the app. Hidden/exiting drawers are inert.

Queue rows: 36px artwork, 13px medium title, artist only; remove play-count/BPM badges from these rows. Preserve native queue indices for play/reorder/remove even with duplicate tracks. Exclude current/previous tracks from Up Next; wrap for repeat-all and show all non-current candidates in shuffle. Keep full library functionality and queue context menus.

- [x] Geometry and original queue-index regressions observed failing, then passing; default player render asserts queue is unmounted.
- [x] Shell height callback, drawer lifecycle, redesigned player and condensed queue rows implemented.
- [x] Browser verification: light/default player, queue below; dark/bottom player, queue above; original queue index playback, Volume Slider changes, Space toggles playback once, Escape priority and focus return. 23 frontend tests and 9 Rust tests pass; frontend/native production builds pass. Independent review found context-menu Escape priority; fixed and verified before packaging release/Isla.exe.

No Git repository: source backup .codex-backups/before-expanded-drawer.zip. Execute inline as requested. Existing skill workflows from this session apply; UI styling is checked by visual inspection, behavior by regression tests.

Ruling: retain 436x412 native canvas and publish actual animated shell bounds; only visible shell geometry changes. Native mixed-DPI/multi-monitor traversal remains unverified live. Browser found focus scrolling the hidden-overflow shell by 27.2px at the bottom anchor; changing shell/root overflow to clip restored scrollTop=0 and matching shell/drawer top=12 with bottom=400. Only drawer content scrolls.

Final review fix: capture Escape at window level while the app context menu is open, before nested drawer handlers; after closing the menu the drawer stays open. Exiting drawers and volume popovers are inert. Dark and light surfaces use existing theme tokens; next-song activity is unchanged.
