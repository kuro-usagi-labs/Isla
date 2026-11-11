# Compact Orb Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Compact artwork orb reveals a separate adaptive transport pill before expanded Now Playing.

**Architecture:** Add local presentation state and compact geometry helpers. Keep the shared pulse/morph shell; draw separate themed surfaces and send separate native hit regions during split presentation.

**Tech Stack:** Existing React, Motion, Tauri/Rust. No new dependencies.

**Spec:** docs/superpowers/specs/2026-11-09-compact-orb-design.md. Approved by user, with amendment: transport is a separate pill left/right according to screen space.

## Global Constraints

Only Compact changes. Preserve light/dark, real audio pulse, reduced motion, drag behavior, temporary notices and desktop anchoring. Transport clicks never expand. Collapse resets to orb. Native transparent gap must remain click-through.

## Review Focus

Rapid repeat activation; drag release is not activation; notice/volume returning to transport; right/bottom monitor anchoring; keyboard focus and pulse bounds across hidden stages.

### Task 1: Geometry and stage policy

Files: src/utils/interaction.ts, src/utils/interaction.test.ts, src-tauri/src/window_manager.rs.

- [x] Add failing tests for compact 60px circle, 214px split geometry at left/right/bottom anchors, activation action and finite clamped progress.
- [x] Run focused tests and observe failure.
- [x] Add getCompactLayout(anchorX, anchorY, controls), compactActivation(size, controls), playbackFraction(position,duration); extend getIslandGeometry with optional compactControls parameter and native compact dimensions to60×60.
- [x] Run focused tests, expected all pass.

### Task 2: Orb, satellite and interaction

Files: src/components/CompactOrb.tsx, src/App.tsx, src/services/bridge.ts, src-tauri/src/main.rs, src-tauri/src/window_manager.rs, src/utils/island.test.tsx, scripts/island-preview.tsx.

- [x] Add failing markup tests: orb has progress and reveal opener but no transport; revealed state has three controls and expanded opener; hidden layer inert.
- [x] Implement orb and separate transport pill inside shared pulse shell with spring entrance, themed surfaces, real progress, drag/volume behavior and accessible activation. Preserve temporary notices by retaining presentation state.
- [x] Extend bounds command with optional region list; test that gap and circular corners are click-through while both surfaces receive input.
- [x] Wire reset/collapse/Escape/focus and native compact anchoring. Add preview compact and left/right anchors for UI QA.
- [x] Run frontend/Rust tests and build. Verify both themes, click sequence, transport isolation, pulse, notification return and edge placement in browser fixture.

### Task 3: Review and delivery

- [x] Independent review, address important findings, verify frontend and native builds.
- [x] Backup previous executable, package hash-matched release/Isla.exe, relaunch and check responding.

Workspace has no Git metadata; use source backup instead of worktree/commit-based helper scripts. User approval authorizes direct implementation; no further approval gate is needed for this plan.

## Verification record

45 frontend tests and 31 Rust tests pass. Frontend production build and native release build pass (Vite reports a non-blocking 500kB chunk size advisory). Initial geometry, orb markup and native gap tests failed before implementation, then passed. Reviewer found empty Play expanding and hover stuck after unmount. Empty Play now disabled (RED→GREEN regression). Hover cleanup clears interaction state on unmount and hide; browser reproduced no pulse (`transform: none`) before fix and measured uniform `matrix(1.03677,0,0,1.03677,0,0)` after next-song notice with fix. No deferred review findings.

Browser QA: left/light and right/bottom/dark satellite placement; first click reveals, Pause doesn't expand, second click expands, collapse returns to orb, Space reveals and Escape dismisses, next-song returns to revealed stage, reduced motion disables pulse. Real pointer drag events verified at both collapsed stages without advancing the stage. Native gap geometry is covered by Rust test; actual desktop monitor dragging/pulse interaction remains dependent on hardware UI testing. Screenshots `.codex-backups/compact-satellite-light.png` and `compact-satellite-dark.png`. Source/binary backups preserved.
