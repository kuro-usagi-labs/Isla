# Isla launch film

24 seconds · 1920×1080 · 60 fps · H.264/AAC MP4.

One application object, filmed through macros, pans and pull-backs. Production
React components supply the markup; the production liquid contour and equalizer
curve functions supply the geometry. No screenshot slides or feature paragraphs.
The brand remains small; the only closing copy is “Isla.” and “Offline music.
Within reach.”

Camera direction adapts Barty-Bart/motion-graphics's explainer-default and
explainer-engaging skills (MIT). Camera targets are eased keyframes, baked through
a critically damped follow at 240 Hz, then sampled deterministically. Maximum
roll is 5 degrees; maximum yaw is 9 degrees. The view deliberately crops the
application during macro shots and restores context with full-player views.

Motion's spring generator (stiffness 240, damping 26, mass .85) drives the shell
and retained UI. The render samples a 180-degree shutter twice per 60-fps frame,
captures at 2× device resolution, and downsamples with Lanczos to preserve sharp
type in the macro shots.
Hyperframes uses a paused GSAP clock adapter for the same seekable composition.

| Time | Action and camera |
| --- | --- |
| 0–4.6 s | Macro artwork; dolly back to split controls, pause response, gather |
| 4.6–8.2 s | Expand to Now Playing; push into playback, pan along the seek action |
| 8.2–11.85 s | Pull back to EQ; move across ten gains and the live curve |
| 11.85–15.5 s | Return to full player; light to dark; follow the UI into artwork |
| 15.5–21.8 s | Dark split and merge; volume HUD; return to artwork |
| 21.8–24 s | Pull back; brand and short closing line |

The score is original, synthesized at 96 BPM. Fourteen CC0 sound cues accent
the visible interactions. Audio is normalized in two passes; inspect the exported
AAC track for final loudness and peak measurements. Credits are in CREDITS.md.
The displayed track is fictional. Demo pulse follows the score; the application's
pulse measures onsets from decoded audio.
