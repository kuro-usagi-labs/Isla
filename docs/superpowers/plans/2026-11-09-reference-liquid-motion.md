# Reference-driven liquid motion refinement

User requested removing metadata from Compact's controller and changing motion to match the supplied15.08s736×414 Dynamic Island video. Studied36overviewframes plus32detailedframes at5.10–6.15s(split neck) and12.40–13.30s(expansion).

Implement the reference's stretch → narrowing neck → separation, inverse rejoin, and shape-before-content sequencing. Keep user-selected light/dark instead of copying black. Orb60×60 and controller152×60 with12px gap; three playback buttons, no visible metadata. Preserve two-click activation, transport isolation, real pulse and reduced motion.

New pure liquid-island contour computes one rounded silhouette, Bezier neck, then two paths. MotionValue drives background and hit regions together; no blur filters on text or fake beat clock. Keep orb mounted during other states to retire its skin as shared shell expands. Filter inert geometry and focus candidates. Pulse eases down during shell morphs. Expanded content arrives after100ms, retires before shell closes. Compact/notice/expanded springs tuned together.

Latest user steering: artwork circle is the center of every transition. Added compact-flow reducer: controls → merging → orb settlement → expanded; controls → merging → volume. Merge completion uses actual shell settlement, with two-frame confirmation for rapid input before the first split paints. Volume retains the same artwork element docked to its anchored edge, grows one224×60 surface with icon/level and returns to orb. No transport buttons during volume. Main player waits until merge completes. Escape cancels queued intents; repeated scroll cannot override a pending expand.

Tests: shape/markup/geometry and staged flow tests RED→GREEN,51frontend tests and production build pass;33Rust tests pass. Reviewer found hidden satellite stealing focus selection during notice and volume requiring artwork focus; selectors now exclude inert nodes and use visible artwork for volume. UI transport records focus intent before state morph. Browser confirms keyboard Next focuses visible Pause, actual merge phase measured75px before expanded412px, and volume grows from artwork while artworkX stays48px. Right/bottom/dark QA measured artworkX399.99px during rejoin (width91.74px), then opens412px player; volume extends left and artwork remains400px. Collapse returns to artwork. Real hardware dragging beyond browser fixture remains unverified; existing native anchoring/hit tests pass.

Backups: .codex-backups/before-reference-motion.zip, reference video and contact-sheet study retained locally. No network upload of user video.

Delivery: final native release build passed, hash-matched release/Isla.exe replaced with previous executable backed up and relaunched. Browser confirms uniform pulse resumes after collapse (scale1.02557). Final proof `.codex-backups/artwork-centered-liquid-controls.png`.51frontend+33Rust tests pass,84total. No remaining actionable reviewer findings.
