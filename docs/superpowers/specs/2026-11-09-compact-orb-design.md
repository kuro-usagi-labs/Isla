# Compact artwork orb and progressive expansion

## Intent

For the Compact size only, replace the resting capsule with circular artwork and an inset circular playback-progress ring. The first activation reveals transport controls; the next activation of artwork/background opens the existing Now Playing panel supplied in the user's reference. Preserve the selected light/dark theme and audio-reactive beat pulse.

## Approach

Use three explicit presentation stages inside the existing shared animated shell: orb, satellite transport, expanded. User approved the design and amended the middle stage: controls appear in a separate pill beside the artwork, to the right when space permits and to the left near the right screen edge. Both surfaces live inside the existing window with separate click regions. Hover-only reveals would interrupt the requested click flow. Default and Large retain their existing behavior.

## Proposed interaction details

- Resting orb: 60 × 60 logical pixels; circular artwork centered inside a subtle theme-aware rim. Progress ring sits inside the shell, starts at twelve o'clock and follows real playback position. No title or transport buttons in this stage.
- First click, Enter or Space on the opener reveals a separate 144 × 44 transport capsule beside the anchored 60px artwork circle, with a 10px gap. Previous, play/pause and next stay aligned during pulse. Gap and circular corners remain click-through.
- Second activation on the artwork/background opens the existing expanded Now Playing panel. Transport-button activation never advances the presentation stage. Dragging never counts as a click; volume wheel remains usable.
- Collapse from expanded returns to the artwork orb. Escape from transport returns to orb. Switching into Compact starts at orb unless already expanded. Switching out preserves existing Default/Large behavior.
- Next-song notification and volume feedback remain temporary morphs, returning to the previous compact stage. They must not consume or skip either click stage.
- Beat pulse uniformly carries shell and content together in both collapsed stages. It eases down during control interaction or morphing, retaining existing reduced-motion behavior. No artificial beat loop.
- Preserve desktop anchoring through all sizes, keep shadow and pulse unclipped, and publish animated native hit bounds. Keyboard focus must move to a visible control and never remain on hidden content.

The 60 px size, collapse-to-orb behavior and Escape handling were approved along with the design. The satellite dimensions are implementation choices.

## Verification

Regression tests for stage transitions, transport isolation, geometry/anchoring, notification return state and progress clamping. Verify the actual UI through orb → transport → expanded → orb in both themes, with pulse, keyboard and reduced motion. Run frontend tests/build and Rust tests/native release build, review interactions and package the updated executable.
