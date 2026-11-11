# Expanded player gathers into artwork — 2026-11-11

The expanded canvas retains its 412px layout and its last 268/388px height while
collapsing. Its uniform scale, center and opacity derive from the live shell width,
rather than a separate fading timeline. Foreground groups remain visible until the
last portion of the gather. Drawer/volume reset waits until width reaches rest;
a guard also handles collapse before the first expansion frame. Inactive content
is inert immediately, and exposure stays off on subsequent satellite/volume states.

Browser checks: light with beat loop and dark right/bottom. At 150ms into close,
root width measured 135–154px with opacity 1, progress/controls retained and center
error below .005px. Reopening during collapse returned the same root to 412x268.
Queue collapse retained its 388px canvas until rest, then opacity zero. No console
errors in fresh preview. Unit tests cover full/rest/intermediate geometry.

Validation: 55 frontend tests passed, TypeScript/Vite and native release build passed. Packaged executable hash verified and application relaunched. Previous binary .codex-backups/Isla-before-expanded-gather.exe.
