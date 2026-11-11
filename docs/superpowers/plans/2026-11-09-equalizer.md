# Equalizer implementation plan

User requested design and implementation of an actual audio equalizer with presets, matching macOS/iOS and the existing light/dark spring drawer system.

Design: 10 peaking bands (31,63,125,250,500,1k,2k,4k,8k,16k Hz), ±12dB, 0.5dB steps; preamp -12 to +6dB. Flat, Bass Boost, Bass Reducer, Treble Boost, Vocal, Acoustic, Electronic, Rock, Jazz, Classical, Late Night and automatically saved Custom. Bypass preserves the curve. Reset restores flat and zero preamp. Open via an EQ button in the player header; mini-player remains above/below the 300px equalizer drawer. Native preset selector, animated illustrative curve, 10 vertical sliders, preamp and automatic-headroom status. Follow theme/accent/reduced-motion; retain Escape/focus semantics.

DSP: stereo-isolated cascade of RBJ peaking biquads after BpmSyncSource, applied to incoming and outgoing decks. Reference https://www.w3.org/TR/audio-eq-cookbook/. Shared atomic controls; audio callback never locks. Sanitize settings, skip frequencies above safe Nyquist boundary, smooth changes over ~20ms and bypass via wet/dry mix. Estimate cascade peak response for automatic preamp headroom. Persist through a dedicated command merging the latest saved settings, defaulting old settings to bypass/flat. Serialize/throttle UI preview and debounce/flush saves.

- [x] RED: missing DSP/settings/model tests observed failing, then passing. Full-level live transition and stale-appearance persistence regressions observed failing, then passing.
- [x] GREEN: native DSP/control/settings commands, frontend equalizer model/view and EQ drawer integrated.
- [x] Verification: 27 frontend and 16 Rust tests pass; production frontend and native release builds pass. Browser checked light/dark, bottom anchor, Bass Boost/Rock, Custom via keyboard band edit, bypass preserving curve and values on reopen; native SQLite reopen preserves EQ alongside volume/window/theme saves. Independent review findings fixed and verified. Packaged release/Isla.exe.

No Git repository. Source backup .codex-backups/before-equalizer.zip. User explicitly delegated routine design choices and implementation; execute inline.

Final DSP ruling: independent coefficient/gain interpolation could overshoot on extreme live presets. Replaced it with two individually normalized fixed-coefficient filter banks crossfaded over 30ms, queuing the latest target until a transition completes. Bypass has a 20ms wet/dry ramp; rare colored-filter startup peaks receive a soft ceiling; flat/bypass remains transparent. Tests cover full-level Flat↔all+12dB transitions at 31/63/1k/8k, response and actual interleaved Source wrapper. Frequency curve is an illustrative band-gain contour, not a measured spectrum.

Persistence ruling: live previews are serialized and throttled (40ms); saves debounce 220ms and flush on unmount. save_equalizer persists only so an older save cannot revert a newer preview. EQ merges under the database mutex; full appearance saves preserve the dedicated EQ field. Stale appearance and reopen regression passes. EQ defaults bypassed for existing libraries. Native mixed-DPI pointer traversal and subjective hardware listening were not verified; synthetic DSP and browser fixture checks are the evidence.

Final UI review: switch/checkbox/radio/tab roles and native buttons own Space; browser confirmed EQ switch toggles without changing playback. Panel has 266px content in 267px available area (no overflow), including ten named vertical sliders, preset dropdown, bypass, preamp, headroom and reset. Follows existing light/dark/system and reduced-motion settings.
