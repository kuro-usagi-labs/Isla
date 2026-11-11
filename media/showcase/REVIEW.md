# Launch-film review

The film uses the production React UI and geometry in one continuously animated
object. Camera targets follow Barty's macro/pan/pull-back direction; camera follow
is baked at 240 Hz. Motion drives the shell, controls, color interpolation and
retained player content.

Shots were inspected at 0.7, 1.9, 2.55, 4, 5.9, 6.7, 7.5, 9.7, 10.5, 13.2,
14.5, 16.4, 19.2, 23 and 23.75 seconds. The updated seek shot and closing frame
were re-snapshotted after the timestamp correction. Full-player views provide
context between deliberate macro crops. The final render captures at 2× device
resolution and downsamples to 1080p; two shutter samples retain motion blur.

Hyperframes full check passes with no errors in lint, runtime, layout, contrast,
craft or audio. The automated GSAP motion lane is inactive for the manual Motion
renderer; motion was reviewed through the sampled poses. Warnings concern the nested single-object
composition, muted EQ labels, and incidental labels crossing the macro crop
(Now Playing, EQ, Bass, Auto headroom, Saved, Reset). Macro crops are intentional;
the full-player overview and final brand are held separately.

Final artifact: 1920×1080, 60 fps, 1,440 frames, 24.000 seconds, H.264/AAC.
Exported AAC loudness: -16.62 LUFS integrated, -4.14 dBTP true peak, 2.60 LU range.
These are measurements of the exported MP4's input signal, not the analyzer's
hypothetical normalization output. The MP4 is fast-start enabled.

The README GIF and posters are extracted from that MP4. The GIF is below 10 MB.
The track/artwork are illustrative; the original score and staged demo pulse are
distinct from the application's actual decoded-audio beat analysis. Audio sources
and fourteen cue timestamps are documented in CREDITS.md.
