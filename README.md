# Isla — Premium Floating Offline Music Player for Windows

**Isla** is a lightweight, completely offline Windows desktop music player built around a floating, draggable Dynamic Island-inspired interface with a **Light Liquid Glass** design system.

Built with **Tauri 2**, **Rust**, **Rodio / CPAL / Symphonia**, **Lofty**, **SQLite (`rusqlite`)**, **React 19**, **TypeScript**, **Vite**, **Tailwind CSS**, **Motion for React**, and **Lucide Icons**.

---

## 1. Architecture & Project Structure

```text
d:\Lang\KurMusicPlay
├── index.html                  # Frameless transparent root container
├── package.json                # Frontend dependencies & build/test scripts
├── pnpm-workspace.yaml         # Build script permissions
├── tsconfig.json               # Strict TypeScript configuration
├── vite.config.ts              # Vite + React + Tailwind v4 configuration
├── scripts/
│   ├── build-env.ps1           # Windows toolchain & PATH setup script
│   └── generate-icons.mjs      # Generates multi-resolution PNG & ICO icons
├── src/                        # React + TypeScript Frontend
│   ├── main.tsx                # Application entry point
│   ├── App.tsx                 # Coordinated window-state & event controller
│   ├── styles/
│   │   └── index.css           # Light/Dark Liquid Glass design tokens & styling
│   ├── types/
│   │   └── isla.ts             # Shared TypeScript interfaces matching Rust models
│   ├── services/
│   │   └── bridge.ts           # Typed Tauri command & event bridge
│   ├── utils/
│   │   ├── format.ts           # Time, file size, search, and sorting helpers
│   │   └── format.test.ts      # Vitest unit tests
│   └── components/
│       ├── ArtworkTile.tsx     # Local album artwork & Liquid Glass fallback tile
│       ├── WaveformBars.tsx    # Animated 4-bar audio waveform indicator
│       ├── CompactPill.tsx     # State A — Compact Floating Pill
│       ├── ExpandedPlayer.tsx  # State B — Expanded Music Player & Top Control Bar
│       ├── TrackRow.tsx        # Queue/Library track row & context menu popover
│       ├── LibraryViews.tsx    # State C — Queue, Songs, Albums, Artists, Playlists, Favorites
│       └── SettingsView.tsx    # State C — Appearance, Floating Player, Playback, Library, App
└── src-tauri/                  # Rust Backend
    ├── Cargo.toml              # Rust dependencies (Tauri 2, Rodio, Symphonia, Lofty, Rusqlite)
    ├── tauri.conf.json         # Frameless transparent window & NSIS bundle config
    ├── capabilities/
    │   └── default.json        # Scoped Tauri 2 permissions
    └── src/
        ├── main.rs             # Tauri setup, system tray, global shortcuts, IPC commands
        ├── models.rs           # Serializable domain structs
        ├── db.rs               # SQLite schema migrations, library, playlists, settings
        ├── scanner.rs          # Recursive folder & file scanner, Lofty metadata & cover art
        ├── audio.rs            # Dedicated Rodio + Symphonia + CPAL playback thread
        └── window_manager.rs   # Multi-monitor geometry, edge clamping, startup registry
```

---

## 2. Implemented Features

### State A — Compact Floating Pill
- **Dimensions**: Configurable (`Compact` 240×56 px, `Default` 260×60 px, `Large` 296×64 px) inside a tight transparent frame (`+12px` ambient shadow margin) so desktop clicks outside the pill are never blocked.
- **Visuals**: Rounded capsule, translucent milky-white Liquid Glass surface, subtle hairline border, album artwork, current song title & artist, animated 4-bar waveform, and bottom progress hairline.
- **Interaction**:
  - Drag anywhere on the Windows desktop; position is persisted automatically across restarts.
  - Clicking the non-control area expands smoothly into the Expanded Music Player.
  - Play/Pause and hover Next Track buttons remain directly clickable without triggering expansion.

### State B — Expanded Music Player
- **Top Control Bar**:
  - Shuffle toggle (`Shuffle`).
  - Repeat mode toggle cycling `off` → `all` → `one`.
  - Previous track (`<<`), Play/Pause (`||` / Play), Next track (`>>`).
  - Live volume percentage (`72%`) + speaker icon with interactive slider popover, double-click mute, and mouse-wheel fine adjustment.
  - Collapse-to-Pill button (`Esc` or chevron button).
- **Now Playing Card**:
  - Rounded square album artwork (`68×68px`) with Liquid Glass fallback when embedded cover art is absent.
  - Song title, favorite heart button, and `Artist - Album` subtitle.
  - Tabular elapsed (`1:55`) and remaining (`-1:52`) timestamps.
  - Smooth pointer-captured scrubbing progress bar with circular thumb.
  - Circular right-hand action button toggling between the Up Next Queue and Songs browser.
- **Up Next Song Queue**:
  - Scrollable track rows with `46×46px` rounded album thumbnails, song title, `Artist - Album`, `•••` context menu, and tabular track duration (`3:21`).
  - Context menu actions: Play Now, Play Next, Add to Queue, Add/Remove Favorite, Add to Playlist (or create a new playlist with the track), Move Up, Move Down, Remove from Queue, and File Information (format, bitrate, sample rate, size, path).

### State C — Library, Playlists & Settings
- **Internal Navigation Rail**: Switches between `Queue`, `Songs`, `Albums`, `Artists`, `Playlists`, `Favorites`, and `Settings` inside the same floating window.
- **Local Music Library & SQLite Indexing**:
  - Native folder selection dialog, individual audio file import, and direct drag-and-drop onto the floating window.
  - Recursive background folder scanning with live progress notifications (`isla://scan-progress`).
  - Extracts title, artist, album, album artist, genre, track number, year, duration, format, bitrate, sample rate, embedded cover art (`data:image/...;base64`), and contrast-safe artwork accent color via `lofty`.
  - Deduplicates tracks using normalized canonical paths and detects missing/moved files.
- **Playlist System**:
  - Create, rename, and delete playlists; add/remove songs; reorder playlist tracks up and down; persistent queue and favorites.
- **Settings**:
  - **Appearance**: Light / Dark / System theme, Glass Intensity (`Subtle`, `Balanced`, `Luminous`), Accent Color presets, Album Artwork Influence toggle, Reduced Motion toggle.
  - **Floating Player**: Always on Top, Compact Pill Size, Open Expanded on Launch, Remember Desktop Position, Auto-Collapse When Unfocused, Compact Pill Waveform.
  - **Playback**: Real Windows CPAL Output Device selector, Default Repeat & Shuffle preferences.
  - **Library**: Linked music folders list, Add Folder, Rescan Library, Clean Missing Files, and Library Statistics (total songs, albums, storage size, total duration).
  - **Application**: Launch at Windows Startup (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), Minimize to System Tray on Close, Global Playback Shortcuts (`MediaPlayPause`, `MediaTrackNext`, `MediaTrackPrevious`, `Alt+Shift+P`, `Alt+Shift+,/.`, `Alt+Shift+I`), Hide to Tray, and Quit Isla.

---

## 3. Development & Build Instructions (Windows)

### Prerequisites
- Windows 10/11 (x64) with Microsoft Edge WebView2 Runtime
- Node.js 20+ & `pnpm`
- Rust stable toolchain

### Environment Setup & Development
```powershell
# Load toolchain environment variables
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\build-env.ps1

# Install frontend dependencies
pnpm install

# Run TypeScript check and frontend unit tests
pnpm run typecheck
pnpm test

# Run Rust backend unit tests (SQLite, metadata scanner, multi-monitor geometry)
cd src-tauri
cargo test
cd ..

# Start Tauri desktop app in development mode
pnpm tauri dev
```

### Production Build & Windows Packaging
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\build-env.ps1

# Build frontend production bundle and native Rust release executable with embedded assets
pnpm run build
cd src-tauri
cargo build --release --features tauri/custom-protocol
```
- The standalone Windows executable is produced at:
  `src-tauri/target/x86_64-pc-windows-gnu/release/isla.exe` (or `src-tauri/target/release/isla.exe`).
- To generate the Windows NSIS setup installer (`Isla_1.0.0_x64-setup.exe`), ensure NSIS (`makensis.exe`) is on `PATH` and run:
  ```powershell
  pnpm tauri build --bundles nsis
  ```

---

## 4. Known Limitations

### Dynamic Island refinement (2026-11-09)
- Native hang fix: drag monitor queries now occur outside the window-state mutex, with a fresh snapshot at drag entry and250ms refresh while dragging. Bounds IPC runs asynchronously; native window event emission also occurs after releasing the mutex. This removes a UI-thread/window-worker lock cycle exposed by frequent pulse hitbox updates. A reentrant lock-order regression covers compact and expanded drag;26 Rust tests pass.
- Live interaction audit: pulse retires through a critically damped spring during hover, pause and state changes, with immediate reset for Reduced Motion. Its center follows actual morph geometry.32/34px transport controls share one bottom-right anchor in compact/volume/next-song states; hover uses theme colors without reflow. Expand clears transient activity timers. Native rounded hit bounds include scale and a settled-frame measurement; development StrictMode replay reschedules cancelled bounds frames. Verified with continuous onsets/progress in both themes, rapid next/expand/collapse, volume interruption and Space/Escape.
- App icon: minimal imagegen-created graphite player pill on an ivory tile, with a lavender album/record and a play button. Selected source is `src-tauri/icons/isla-master.png`; its generation prompt is saved in `icon-prompt.txt`. Run `node scripts/generate-icons.mjs` on Windows to export PNGs and the ten-frame ICO (16–256px). `src-tauri/build.rs` tracks icon changes. Runtime window/tray context uses the full256px PNG, so enlarged taskbars/docks can downsample it rather than upscale a system32px image. The packaged release includes `Isla.ico` for shortcuts.
- Normal player, next-song activity and volume HUD use distinct layouts. Next-song morphs to a 372×140px island following the chosen light/dark/system theme, with 64px hero artwork, a vinyl layer, album-tinted ambience and persistent Pause/Next controls at the bottom right.
- Volume feedback takes precedence over automatic song notifications; transport relocation and artwork handoff use damped springs.
- Hidden layers are inert, native hit testing follows the animated rounded shell, and reduced motion honors both the app setting and system preference.
- Progress ticks omit queue/artwork; BPM analysis warms in background; cover accents use decoded pixels and adapt for light/dark contrast. Rescan existing tracks to replace previously saved hash-based cover accents.
- Expanded player now opens on Now Playing with a 76px cover, centered 56px primary transport and quieter playback options. Explicit Up Next and Library buttons open spring drawers; bottom-anchored players grow upward. Queue rows omit BPM/play-count badges and preserve original queue indices. Library uses a mini-player to free browsing space. Escape closes context menu, volume, drawer, then player in that order.
- **Equalizer**: Open **EQ** in the player header for a ten-band 31Hz–16kHz audio equalizer (±12dB), preamp, bypass and reset. Includes Flat, Bass Boost, Bass Reducer, Treble Boost, Vocal, Acoustic, Electronic, Rock, Jazz, Classical, Late Night and saved Custom. Presets apply live; band edits select Custom; bypass retains the curve. Settings persist across restarts and appearance changes. The panel follows light/dark/system and directional spring drawers.
- Native stereo biquads follow the [W3C Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/). Individually normalized filter banks crossfade during edits; automatic headroom compensates boosts. The displayed curve illustrates band gains. EQ starts bypassed for existing users.
- Equalizer audit: all 11 UI presets share one data source with native signal tests; Flat is transparent and every colored preset has a distinct measured response. All ten bands are tested for boost/cut, and preamp is tested at −6/0/+6dB. Positive preamp is applied after automatic band headroom; a soft ceiling limits loud peaks. Unsupported high bands are disabled for low-sample-rate sources. Tone controls, curve and Bass/Mids/Air labels share one themed surface; preset/reset thumbs spring, pointer drags follow directly, and edits expose save/retry feedback.
- **Beat Pulse**: Settings → Floating Player → Beat Pulse moves the complete compact pill with one uniform centered spring scale from live bass-energy onsets in decoded post-EQ audio. Text, artwork and controls retain their proportions and relative positions; controls have no competing layout projection or hover width reflow. Native click bounds follow the pulse and reset when it stops. Both crossfade decks contribute according to output gain. It rests during silence, pause/mute, dragging, expanded/activity states and Reduced Motion. Legato sections do not receive an artificial BPM pulse. The native canvas retains 48px shadow clearance. Next-song notifications omit filler footer copy.
- Validation: 34 frontend tests, TypeScript production build, 25 Rust tests and native release build. Browser checks cover light/dark, bottom anchoring, slider drag/keyboard, bypass, preamp, reset, drawer persistence and Beat Pulse on/off/pause/reduced motion. Transport proportions remain constant across pulses during90ms progress updates. Beat tests cover8–96kHz, reversed stereo polarity, silence, sustained tones, sample transparency and settings migration; a local decoded20s music excerpt yielded38 onsets. Subjective hardware listening, device-specific latency and mixed-DPI/multi-monitor pointer traversal still need live device verification.

- **Audio Formats**: Baseline formats (`MP3`, `FLAC`, `WAV`, `OGG Vorbis`, and `M4A/AAC` via Symphonia) are decoded natively offline. DRM-protected streams or proprietary lossless codecs (e.g., WMA Lossless) are not supported.
- **CSS Backdrop Blur on Frameless Transparent Windows**: Windows WebView2 renders high-saturation frosted glass inside the application surface; full desktop-behind-window acrylic blur depends on the Windows 10/11 DWM compositor and user transparency preferences, so Isla uses a carefully tuned high-legibility translucent milky-white fallback layer to guarantee crisp text contrast and 60 FPS dragging on all GPUs.
