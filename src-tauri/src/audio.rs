use crate::db::Database;
use crate::audio_devices::{route_action, RouteAction};
use crate::beat::{BeatMeter, BeatSource};
use crate::equalizer::{EqControl, EqualizedSource, EqualizerSettings};
use crate::models::{AudioDeviceInfo, PlayerProgress, PlayerSnapshot, RepeatMode, Track};
use std::collections::HashMap;
use std::sync::OnceLock;
use rand::seq::SliceRandom;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{OutputStream, OutputStreamHandle, Sink, Source};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub use crate::decoder::{probe_audio_stream, SymphoniaSource};
use crate::decoder::BpmSyncSource;

/// Analyzes an audio file's rhythmic onset envelope to detect:
/// 1. Accurate musical BPM (`72.0 ..= 172.0 BPM`) via percussive/bass onset autocorrelation + harmonic comb filter
/// 2. First downbeat offset in the intro (`0.0 ..= 1.8s`) so beat-matched Automix drops right on the first beat
type AnalysisKey = (std::path::PathBuf, u64, std::time::SystemTime);
type AnalysisCache = Mutex<HashMap<AnalysisKey, Option<(f32, f64)>>>;
static ANALYSIS_CACHE: OnceLock<AnalysisCache> = OnceLock::new();

fn analysis_key(path: &Path) -> Option<AnalysisKey> {
    let meta = path.metadata().ok()?;
    Some((path.to_path_buf(), meta.len(), meta.modified().ok()?))
}

fn cached_track_analysis(path: &Path) -> Option<(f32, f64)> {
    let key = analysis_key(path)?;
    ANALYSIS_CACHE.get_or_init(Default::default).lock().ok()?.get(&key).copied().flatten()
}

pub fn analyze_track_bpm_and_beat(path: &Path, duration_secs: f64) -> Option<(f32, f64)> {
    let key = analysis_key(path)?;
    let cache = ANALYSIS_CACHE.get_or_init(Default::default);
    if let Some(result) = cache.lock().ok()?.get(&key).copied() { return result; }
    let result = analyze_track_bpm_and_beat_uncached(path, duration_secs);
    if let Ok(mut entries) = cache.lock() {
        entries.retain(|(p, _, _), _| p != path);
        entries.insert(key, result);
    }
    result
}

fn analyze_track_bpm_and_beat_uncached(path: &Path, duration_secs: f64) -> Option<(f32, f64)> {
    // 1. Detect intro first-beat offset from the first 3.5 seconds so Automix skips dead silence
    let mut intro_beat_offset = 0.0f64;
    if let Ok(mut intro_src) = SymphoniaSource::try_open(path, 0.0) {
        let sr = intro_src.sample_rate().max(8_000) as usize;
        let ch = (intro_src.channels() as usize).max(1);
        let hop = (sr / 100).max(64); // 10ms frames (100 Hz)
        let max_frames = 320usize; // 3.2 seconds
        let mut frame_rms = Vec::with_capacity(max_frames);

        'intro_loop: for _ in 0..max_frames {
            let mut sum_sq = 0.0f32;
            let mut count = 0usize;
            for _ in 0..hop {
                let mut mono = 0.0f32;
                for c in 0..ch {
                    if let Some(s) = intro_src.next() {
                        mono += s;
                    } else if c == 0 {
                        break 'intro_loop;
                    }
                }
                mono /= ch as f32;
                sum_sq += mono * mono;
                count += 1;
            }
            if count == 0 {
                break;
            }
            frame_rms.push((sum_sq / count as f32).sqrt());
        }

        let peak_rms = frame_rms.iter().copied().fold(0.0f32, f32::max);
        if peak_rms > 0.015 {
            let threshold = (peak_rms * 0.26).max(0.012);
            if let Some(idx) = frame_rms.iter().position(|&v| v >= threshold) {
                let offset = (idx as f64) * (hop as f64 / sr as f64);
                if (0.04..=1.65).contains(&offset) {
                    intro_beat_offset = (offset - 0.015).max(0.0);
                }
            }
        }
    }

    // 2. Analyze a 22-second representative groove window in the body of the song for BPM
    let start_sec = if duration_secs > 52.0 {
        (duration_secs * 0.28).min(36.0)
    } else if duration_secs > 20.0 {
        duration_secs * 0.18
    } else {
        0.0
    };

    let mut src = SymphoniaSource::try_open(path, start_sec).ok()?;
    let sr = src.sample_rate().max(8_000) as usize;
    let ch = (src.channels() as usize).max(1);
    let env_rate = 100.0f32;
    let hop = ((sr as f32 / env_rate).round() as usize).max(64);
    let actual_env_rate = sr as f32 / hop as f32;
    let target_frames = 2200usize; // ~22 seconds at 100 Hz

    let lp_alpha = (2.0 * std::f32::consts::PI * 165.0 / sr as f32).clamp(0.005, 0.25);
    let mut lp_state = 0.0f32;
    let mut prev_bass_e = 0.0f32;
    let mut prev_full_e = 0.0f32;
    let mut onset_env: Vec<f32> = Vec::with_capacity(target_frames);

    'groove_loop: for _ in 0..target_frames {
        let mut bass_sq = 0.0f32;
        let mut full_sq = 0.0f32;
        let mut count = 0usize;
        for _ in 0..hop {
            let mut mono = 0.0f32;
            for c in 0..ch {
                if let Some(s) = src.next() {
                    mono += s;
                } else if c == 0 {
                    break 'groove_loop;
                }
            }
            mono /= ch as f32;
            lp_state += lp_alpha * (mono - lp_state);
            bass_sq += lp_state * lp_state;
            full_sq += mono * mono;
            count += 1;
        }
        if count < hop / 2 {
            break;
        }
        let bass_e = (1.0 + 35.0 * (bass_sq / count as f32)).ln();
        let full_e = (1.0 + 20.0 * (full_sq / count as f32)).ln();
        let d_bass = (bass_e - prev_bass_e).max(0.0);
        let d_full = (full_e - prev_full_e).max(0.0);
        prev_bass_e = bass_e;
        prev_full_e = full_e;
        // Weight kick/bass transients (68%) + full-band snare/hat transients (32%)
        onset_env.push(d_bass * 0.68 + d_full * 0.32);
    }

    if onset_env.len() < 450 {
        return None;
    }

    // Subtract local moving average (0.45s window) so rhythmic spikes stand out sharply
    let win = 22usize;
    let mut cleaned = vec![0.0f32; onset_env.len()];
    for i in 0..onset_env.len() {
        let start = i.saturating_sub(win);
        let end = (i + win + 1).min(onset_env.len());
        let local_mean: f32 = onset_env[start..end].iter().sum::<f32>() / (end - start) as f32;
        cleaned[i] = (onset_env[i] - local_mean).max(0.0);
    }

    let max_val = cleaned.iter().copied().fold(0.0f32, f32::max);
    if max_val <= 1e-5 {
        return None;
    }
    for v in &mut cleaned {
        *v /= max_val;
    }

    // Evaluate candidate BPMs (74 ..= 168 BPM) with fractional lag interpolation + 2x/3x/4x harmonic comb
    let score_bpm = |bpm: f32| -> f32 {
        let period = (60.0 * actual_env_rate) / bpm;
        if period < 18.0 || period * 2.0 >= cleaned.len() as f32 {
            return 0.0;
        }

        let sample_interp = |idx_f: f32| -> f32 {
            let i0 = idx_f.floor() as usize;
            if i0 + 1 >= cleaned.len() {
                return 0.0;
            }
            let frac = idx_f - i0 as f32;
            cleaned[i0] * (1.0 - frac) + cleaned[i0 + 1] * frac
        };

        let n = cleaned.len();
        let mut corr1 = 0.0f32;
        let mut corr2 = 0.0f32;
        let mut corr4 = 0.0f32;
        let mut corr_half = 0.0f32;
        let mut count = 0usize;

        for i in 0..n {
            let base = cleaned[i];
            if base <= 0.01 {
                continue;
            }
            let i_f = i as f32;
            if i_f + period < n as f32 {
                corr1 += base * sample_interp(i_f + period);
                corr_half += base * sample_interp(i_f + period * 0.5);
                count += 1;
            }
            if i_f + period * 2.0 < n as f32 {
                corr2 += base * sample_interp(i_f + period * 2.0);
            }
            if i_f + period * 4.0 < n as f32 {
                corr4 += base * sample_interp(i_f + period * 4.0);
            }
        }

        if count == 0 {
            return 0.0;
        }
        let norm = count as f32;
        let raw_score =
            (corr1 / norm) * 1.0 + (corr2 / norm) * 0.58 + (corr4 / norm) * 0.34 + (corr_half / norm) * 0.22;

        // Perceptual tempo prior centered around 120 BPM so 120-132 BPM grooves beat half-time 60-66 BPM
        let diff = (bpm - 120.0) / 44.0;
        let prior = (-0.18 * diff * diff).exp();
        raw_score * prior
    };

    let mut best_bpm = 120.0f32;
    let mut best_score = -1.0f32;
    let mut candidate = 74.0f32;
    while candidate <= 168.0 {
        let s = score_bpm(candidate);
        if s > best_score {
            best_score = s;
            best_bpm = candidate;
        }
        candidate += 0.5;
    }

    // Fine-grain refinement (±0.8 BPM in 0.1 steps)
    let mut fine_bpm = best_bpm;
    let mut fine_score = best_score;
    let start_fine = (best_bpm - 0.8).max(72.0);
    let end_fine = (best_bpm + 0.8).min(172.0);
    let mut f_cand = start_fine;
    while f_cand <= end_fine {
        let s = score_bpm(f_cand);
        if s > fine_score {
            fine_score = s;
            fine_bpm = f_cand;
        }
        f_cand += 0.1;
    }

    // Snap to clean integer BPM when within 0.38 BPM (since studio tracks are almost always integer BPM)
    let nearest_int = fine_bpm.round();
    let final_bpm = if (fine_bpm - nearest_int).abs() <= 0.38 {
        nearest_int
    } else {
        (fine_bpm * 2.0).round() * 0.5
    };

    Some((final_bpm.clamp(72.0, 172.0), intro_beat_offset))
}

/// Computes the optimal tempo-lock speed ratio (`bpm_out / bpm_in`) for incoming track
/// if the two tracks are within DJ tempo-sync tolerance (`±9%`), including 2x/0.5x harmonic ratios.
fn compute_tempo_sync_ratio(bpm_out: Option<f32>, bpm_in: Option<f32>) -> Option<f32> {
    let out = bpm_out.filter(|&b| (60.0..=200.0).contains(&b))?;
    let inc = bpm_in.filter(|&b| (60.0..=200.0).contains(&b))?;
    let candidates = [out / inc, (out * 0.5) / inc, (out * 2.0) / inc];
    candidates
        .into_iter()
        .min_by(|a, b| (a - 1.0).abs().partial_cmp(&(b - 1.0).abs()).unwrap())
        .filter(|&ratio| (0.91..=1.09).contains(&ratio))
}

/// Quantizes the requested crossfade duration to an exact musical phrase (`4`, `8`, `12`, `16`, or `24` beats)
/// so transitions lock onto bar boundaries like a real DJ mix.
fn quantize_crossfade_to_musical_bars(
    requested_secs: f32,
    bpm_out: Option<f32>,
    bpm_in: Option<f32>,
) -> f32 {
    if requested_secs <= 0.4 {
        return requested_secs;
    }
    let ref_bpm = match (bpm_out, bpm_in) {
        (Some(a), Some(b)) if a > 60.0 && b > 60.0 => {
            if (a - b).abs() <= 16.0 {
                (a + b) * 0.5
            } else {
                b
            }
        }
        (Some(a), _) if a > 60.0 => a,
        (_, Some(b)) if b > 60.0 => b,
        _ => return requested_secs,
    };

    let beat_sec = 60.0 / ref_bpm;
    let phrase_beats = [4.0f32, 8.0, 12.0, 16.0, 24.0, 32.0];
    let best_beats = phrase_beats
        .into_iter()
        .min_by(|&b1, &b2| {
            let d1 = (b1 * beat_sec - requested_secs).abs();
            let d2 = (b2 * beat_sec - requested_secs).abs();
            d1.partial_cmp(&d2).unwrap()
        })
        .unwrap_or(8.0);

    (best_beats * beat_sec).clamp(1.6, 15.0)
}

pub enum AudioCommand {
    OutputDevicesChanged { devices: Vec<AudioDeviceInfo> },
    SetBeatPulse { enabled: bool },
    PlayTrack {
        track: Track,
        new_queue: Option<Vec<Track>>,
    },
    PlayQueueIndex {
        index: usize,
    },
    TogglePlayPause,
    Play,
    Pause,
    Stop,
    Next {
        user_initiated: bool,
    },
    Previous,
    Seek {
        position_secs: f64,
    },
    SetVolume {
        volume: f32,
    },
    ToggleMute,
    SetShuffle {
        shuffle: bool,
    },
    SetRepeatMode {
        mode: RepeatMode,
    },
    SetCrossfade {
        enabled: bool,
        duration_secs: f32,
    },
    SetEqualizer { settings: EqualizerSettings },
    SetQueue {
        tracks: Vec<Track>,
        start_index: Option<usize>,
        auto_play: bool,
    },
    AddToQueue {
        track: Track,
        play_next: bool,
    },
    RemoveFromQueue {
        index: usize,
    },
    ReorderQueue {
        from_index: usize,
        to_index: usize,
    },
    ClearQueue,
    SetOutputDevice {
        device_name: String,
    },
    SyncTrackMetadata {
        track: Track,
    },
}

pub struct AudioController {
    tx: Sender<AudioCommand>,
    snapshot: Arc<Mutex<PlayerSnapshot>>,
}

pub fn list_output_devices() -> Result<Vec<AudioDeviceInfo>,String> {
    let host = rodio::cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|d| d.name().ok())
        .unwrap_or_default();

    let mut out = Vec::new();
    let devices = host.output_devices().map_err(|error| format!("Cannot enumerate audio outputs: {error}"))?;
        for dev in devices {
            if let Ok(name) = dev.name() {
                let is_default = !default_name.is_empty() && name == default_name;
                out.push(AudioDeviceInfo { name, is_default });
            }
        }
    out.sort_by(|a,b| a.name.cmp(&b.name));
    out.dedup_by(|a,b| { if a.name == b.name { b.is_default |= a.is_default; true } else { false } });
    out.sort_by(|a,b| b.is_default.cmp(&a.is_default).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

fn spawn_output_device_monitor(tx: Sender<AudioCommand>, app: AppHandle) {
    std::thread::Builder::new().name("isla-audio-devices".into()).spawn(move || {
        let mut previous: Option<Vec<AudioDeviceInfo>> = None;
        loop {
            if let Ok(devices) = list_output_devices() {
                if previous.as_ref() != Some(&devices) {
                    // Queue routing before notifying the UI, so a new selection cannot overtake an old topology.
                    if tx.send(AudioCommand::OutputDevicesChanged { devices: devices.clone() }).is_err() { break; }
                    let _ = app.emit("isla://audio-devices-changed",&devices);
                    previous = Some(devices);
                }
            }
            std::thread::sleep(Duration::from_millis(1500));
        }
    }).expect("Failed to spawn audio endpoint monitor");
}

fn open_output_stream(device_name: &str) -> Result<(OutputStream, OutputStreamHandle,String), String> {
    let trimmed = device_name.trim();
    let host = rodio::cpal::default_host();
    let device = if trimmed.is_empty() {
        host.default_output_device().ok_or_else(|| "No system default audio output is available".to_string())?
    } else {
        host.output_devices().map_err(|error| format!("Cannot enumerate audio outputs: {error}"))?
            .find(|device| device.name().map(|name| name == trimmed).unwrap_or(false))
            .ok_or_else(|| format!("Audio output disconnected: {trimmed}. Choose another output in Settings."))?
    };
    let name = device.name().map_err(|error| format!("Cannot read output name: {error}"))?;
    let (stream,handle) = OutputStream::try_from_device(&device).map_err(|error| format!("Cannot open audio output {name}: {error}"))?;
    Ok((stream,handle,name))
}

impl AudioController {
    pub fn new(
        db: Arc<Database>,
        initial_settings_volume: f32,
        initial_shuffle: bool,
        initial_repeat: RepeatMode,
        initial_crossfade_enabled: bool,
        initial_crossfade_secs: f32,
        initial_device: String,
        restored_queue: Vec<Track>,
        restored_index: Option<usize>,
        restored_pos: f64,
        app_handle: AppHandle,
    ) -> Self {
        let current_track = restored_index.and_then(|i| restored_queue.get(i).cloned());
        let duration_secs = current_track.as_ref().map(|t| t.duration_secs).unwrap_or(0.0);
        let clamped_cf_secs = initial_crossfade_secs.clamp(0.0, 15.0);

        let initial_snapshot = PlayerSnapshot {
            is_playing: false,
            current_track,
            outgoing_track: None,
            position_secs: restored_pos.clamp(0.0, duration_secs.max(0.0)),
            duration_secs,
            volume: initial_settings_volume.clamp(0.0, 1.0),
            is_muted: false,
            shuffle: initial_shuffle,
            repeat_mode: initial_repeat,
            crossfade_enabled: initial_crossfade_enabled && clamped_cf_secs > 0.2,
            crossfade_secs: if clamped_cf_secs > 0.2 {
                clamped_cf_secs
            } else {
                6.0
            },
            is_crossfading: false,
            crossfade_progress: 0.0,
            live_mix_bpm: None,
            queue: restored_queue,
            current_queue_index: restored_index,
            output_device: if initial_device.trim().is_empty() {
                None
            } else {
                Some(initial_device.clone())
            },
            last_error: None,
        };

        let snapshot = Arc::new(Mutex::new(initial_snapshot));
        let (tx, rx) = mpsc::channel::<AudioCommand>();
        spawn_output_device_monitor(tx.clone(),app_handle.clone());

        let snapshot_clone = Arc::clone(&snapshot);
        std::thread::Builder::new()
            .name("isla-audio-engine".to_string())
            .spawn(move || {
                run_audio_thread(rx, snapshot_clone, db, app_handle, initial_device);
            })
            .expect("Failed to spawn audio thread");

        Self { tx, snapshot }
    }

    pub fn send(&self, cmd: AudioCommand) -> Result<(), String> {
        self.tx
            .send(cmd)
            .map_err(|e| format!("Audio engine channel closed: {e}"))
    }

    pub fn get_snapshot(&self) -> PlayerSnapshot {
        self.snapshot
            .lock()
            .map(|s| s.clone())
            .unwrap_or_else(|e| e.into_inner().clone())
    }
}

struct OutgoingDeck {
    beat_meter: Arc<BeatMeter>,
    sink: Sink,
    track: Option<Track>,
    start_gain: f32,
    started_at: Instant,
    fade_duration: Duration,
    speed_bits: Arc<AtomicU32>,
    bass_cut_bits: Arc<AtomicU32>,
    target_end_speed: f32,
}

struct EngineRuntime {
    active_output_name: Option<String>,
    beat_meter: Arc<BeatMeter>,
    beat_pulse_enabled: bool,
    equalizer: Arc<EqControl>,
    stream: Option<OutputStream>,
    stream_handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    active_speed_bits: Arc<AtomicU32>,
    active_bass_cut_bits: Arc<AtomicU32>,
    active_start_speed: f32,
    active_track_bpm: Option<f32>,
    outgoing_decks: Vec<OutgoingDeck>,
    active_fade_in: Option<(Instant, Duration)>,
    current_active_gain: f32,
    auto_crossfade_triggered_track_id: Option<i64>,
    device_name: String,
    accumulated_secs: f64,
    playing_since: Option<Instant>,
}

impl EngineRuntime {
    fn current_position(&self, duration_secs: f64) -> f64 {
        let extra = self
            .playing_since
            .map(|inst| inst.elapsed().as_secs_f64())
            .unwrap_or(0.0);
        let raw = self.accumulated_secs + extra;
        if duration_secs > 0.0 {
            raw.clamp(0.0, duration_secs)
        } else {
            raw.max(0.0)
        }
    }

    fn ensure_stream(&mut self) -> Result<(), String> {
        if self.stream_handle.is_none() {
            let (s, h,name) = open_output_stream(&self.device_name)?;
            self.stream = Some(s);
            self.stream_handle = Some(h);
            self.active_output_name = Some(name);
        }
        Ok(())
    }

    fn stop_outgoing_decks(&mut self) {
        for deck in self.outgoing_decks.drain(..) {
            deck.sink.stop();
        }
    }

    fn cancel_crossfade(&mut self, effective_volume: f32, snap: &mut PlayerSnapshot) {
        self.stop_outgoing_decks();
        self.active_fade_in = None;
        self.current_active_gain = 1.0;
        self.active_start_speed = 1.0;
        self.active_speed_bits
            .store(1.0f32.to_bits(), Ordering::Relaxed);
        self.active_bass_cut_bits
            .store(0.0f32.to_bits(), Ordering::Relaxed);
        if let Some(sink) = self.sink.as_ref() {
            sink.set_volume(effective_volume);
        }
        snap.is_crossfading = false;
        snap.crossfade_progress = 0.0;
        snap.outgoing_track = None;
        snap.live_mix_bpm = snap.current_track.as_ref().and_then(|t| t.bpm);
    }

    fn tick_crossfade_envelopes(
        &mut self,
        effective_volume: f32,
        snap: &mut PlayerSnapshot,
    ) -> bool {
        let was_crossfading = snap.is_crossfading;

        // 1. Update outgoing deck(s) with equal-power cosine fade-out + tempo glide + DJ bass-cut
        let mut idx = 0;
        while idx < self.outgoing_decks.len() {
            let deck = &self.outgoing_decks[idx];
            let dur_secs = deck.fade_duration.as_secs_f32().max(0.05);
            let raw_t = (deck.started_at.elapsed().as_secs_f32() / dur_secs).clamp(0.0, 1.0);
            if raw_t >= 1.0 || deck.sink.empty() {
                let removed = self.outgoing_decks.remove(idx);
                removed.sink.stop();
            } else {
                // Smoothstep S-curve + cosine equal-power attenuation
                let u = raw_t * raw_t * (3.0 - 2.0 * raw_t);
                let gain_out = deck.start_gain * (u * std::f32::consts::FRAC_PI_2).cos();
                deck.sink
                    .set_volume((effective_volume * gain_out).clamp(0.0, 1.0));

                // Glide outgoing tempo smoothly toward incoming track's tempo
                let cur_out_speed = 1.0 + (deck.target_end_speed - 1.0) * u;
                deck.speed_bits
                    .store(cur_out_speed.to_bits(), Ordering::Relaxed);

                // DJ EQ Bass-Swap: attenuate outgoing low frequencies (< 145 Hz) across t = 0.20..0.62
                let out_bass_cut = ((raw_t - 0.18) / 0.45).clamp(0.0, 1.0) * 0.85;
                deck.bass_cut_bits
                    .store(out_bass_cut.to_bits(), Ordering::Relaxed);

                idx += 1;
            }
        }

        // 2. Update incoming active sink with equal-power sine fade-in + tempo lock glide + DJ bass drop
        if let Some((started_at, dur)) = self.active_fade_in {
            let dur_secs = dur.as_secs_f32().max(0.05);
            let raw_t = (started_at.elapsed().as_secs_f32() / dur_secs).clamp(0.0, 1.0);
            if raw_t >= 1.0 {
                self.active_fade_in = None;
                self.current_active_gain = 1.0;
                self.active_start_speed = 1.0;
                self.active_speed_bits
                    .store(1.0f32.to_bits(), Ordering::Relaxed);
                self.active_bass_cut_bits
                    .store(0.0f32.to_bits(), Ordering::Relaxed);
                if let Some(sink) = self.sink.as_ref() {
                    sink.set_volume(effective_volume);
                }
            } else {
                let u = raw_t * raw_t * (3.0 - 2.0 * raw_t);
                let gain_in = (u * std::f32::consts::FRAC_PI_2).sin().max(0.02);
                self.current_active_gain = gain_in;
                if let Some(sink) = self.sink.as_ref() {
                    sink.set_volume((effective_volume * gain_in).clamp(0.0, 1.0));
                }

                // Glide incoming speed from matched outgoing BPM (`active_start_speed`) -> native `1.0`
                let cur_in_speed = self.active_start_speed + (1.0 - self.active_start_speed) * u;
                self.active_speed_bits
                    .store(cur_in_speed.to_bits(), Ordering::Relaxed);

                // DJ EQ Bass-Swap: keep incoming sub-bass tucked during first 35%, then drop full bass in by 62%!
                let in_bass_cut = if dur_secs >= 0.6 {
                    (1.0 - ((raw_t - 0.25) / 0.38).clamp(0.0, 1.0)) * 0.78
                } else {
                    0.0
                };
                self.active_bass_cut_bits
                    .store(in_bass_cut.to_bits(), Ordering::Relaxed);

                snap.is_crossfading = true;
                snap.crossfade_progress = raw_t;
                snap.outgoing_track = self.outgoing_decks.last().and_then(|d| d.track.clone());
                snap.live_mix_bpm = self
                    .active_track_bpm
                    .map(|b| (b * cur_in_speed).round())
                    .or_else(|| snap.outgoing_track.as_ref().and_then(|t| t.bpm));
            }
        }

        if self.active_fade_in.is_none() && self.outgoing_decks.is_empty() {
            self.current_active_gain = 1.0;
            self.active_speed_bits
                .store(1.0f32.to_bits(), Ordering::Relaxed);
            self.active_bass_cut_bits
                .store(0.0f32.to_bits(), Ordering::Relaxed);
            snap.is_crossfading = false;
            snap.crossfade_progress = 0.0;
            snap.outgoing_track = None;
            snap.live_mix_bpm = snap.current_track.as_ref().and_then(|t| t.bpm);
            return was_crossfading;
        }

        snap.is_crossfading
    }

    fn load_and_start_track(
        &mut self,
        track: &Track,
        start_offset_secs: f64,
        effective_volume: f32,
        auto_play: bool,
        crossfade_duration_secs: f32,
        outgoing_track: Option<Track>,
    ) -> Result<(f64, Option<f32>), String> {
        let path = Path::new(&track.file_path);
        if !path.is_file() {
            return Err(format!("Audio file not found: {}", track.file_path));
        }

        self.ensure_stream()?;
        let handle = self
            .stream_handle
            .as_ref()
            .ok_or_else(|| "No active audio output stream".to_string())?;

        // Playback never decodes an analysis window. Scanner/background indexer warm this cache.
        let cached = cached_track_analysis(path);
        let detected_bpm = track.bpm.or(cached.map(|(bpm, _)| bpm));
        let intro_beat_offset = cached.map(|(_, offset)| offset).unwrap_or(0.0);

        // When DJ-crossfading into a track from the beginning, align to its first downbeat!
        let effective_start_offset =
            if auto_play && crossfade_duration_secs > 0.5 && start_offset_secs <= 0.02 {
                intro_beat_offset
            } else {
                start_offset_secs
            };

        let raw_source = SymphoniaSource::try_open(path, effective_start_offset)?;
        let decoded_duration = if track.duration_secs > 0.5 {
            track.duration_secs
        } else {
            raw_source
                .total_duration()
                .map(|d| d.as_secs_f64())
                .unwrap_or(0.0)
        };

        let new_speed_bits = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let new_bass_cut_bits = Arc::new(AtomicU32::new(0.0f32.to_bits()));
        let sync_source = BpmSyncSource::new(
            crate::read_ahead::ReadAheadSource::new(raw_source)?,
            Arc::clone(&new_speed_bits),
            Arc::clone(&new_bass_cut_bits),
        );

        let sink =
            Sink::try_new(handle).map_err(|e| format!("Failed to initialize audio sink: {e}"))?;

        let mut did_start_crossfade = false;
        let mut initial_in_speed = 1.0f32;

        if auto_play && crossfade_duration_secs > 0.08 {
            if let Some(old_sink) = self.sink.take() {
                if !old_sink.empty() && !old_sink.is_paused() {
                    self.stop_outgoing_decks();

                    let bpm_out = outgoing_track
                        .as_ref()
                        .and_then(|t| t.bpm)
                        .or(self.active_track_bpm);
                    let bpm_in = detected_bpm;

                    // Quantize crossfade length to exact 4/8/12/16-beat musical bars!
                    let quantized_fade_secs = quantize_crossfade_to_musical_bars(
                        crossfade_duration_secs,
                        bpm_out,
                        bpm_in,
                    );
                    let fade_dur = Duration::from_secs_f32(quantized_fade_secs);

                    // Compute tempo-sync ratio if tracks are within DJ sync range (±9%)
                    let sync_ratio = compute_tempo_sync_ratio(bpm_out, bpm_in).unwrap_or(1.0);
                    initial_in_speed = sync_ratio;
                    let target_out_end_speed = if (sync_ratio - 1.0).abs() > 0.002 {
                        (1.0 / sync_ratio).clamp(0.92, 1.08)
                    } else {
                        1.0
                    };

                    new_speed_bits.store(initial_in_speed.to_bits(), Ordering::Relaxed);
                    if quantized_fade_secs >= 0.6 {
                        new_bass_cut_bits.store(0.75f32.to_bits(), Ordering::Relaxed);
                    }

                    let old_speed_bits = Arc::clone(&self.active_speed_bits);
                    let old_bass_cut_bits = Arc::clone(&self.active_bass_cut_bits);

                    self.outgoing_decks.push(OutgoingDeck {
                        beat_meter: Arc::clone(&self.beat_meter),
                        sink: old_sink,
                        track: outgoing_track,
                        start_gain: self.current_active_gain.clamp(0.18, 1.0),
                        started_at: Instant::now(),
                        fade_duration: fade_dur,
                        speed_bits: old_speed_bits,
                        bass_cut_bits: old_bass_cut_bits,
                        target_end_speed: target_out_end_speed,
                    });
                    self.active_fade_in = Some((Instant::now(), fade_dur));
                    self.current_active_gain = 0.03;
                    sink.set_volume((effective_volume * 0.03).clamp(0.0, 1.0));
                    did_start_crossfade = true;
                } else {
                    old_sink.stop();
                }
            }
        } else {
            if let Some(old_sink) = self.sink.take() {
                old_sink.stop();
            }
            self.stop_outgoing_decks();
        }

        self.active_speed_bits = new_speed_bits;
        self.active_bass_cut_bits = new_bass_cut_bits;
        self.active_start_speed = initial_in_speed;
        self.active_track_bpm = detected_bpm;

        if !did_start_crossfade {
            self.active_fade_in = None;
            self.current_active_gain = 1.0;
            sink.set_volume(effective_volume);
        }

        if !auto_play {
            sink.pause();
        }

        self.beat_meter = Arc::new(BeatMeter::default());
        sink.append(BeatSource::new(EqualizedSource::new(sync_source, Arc::clone(&self.equalizer)), Arc::clone(&self.beat_meter)));
        self.accumulated_secs = effective_start_offset.max(0.0);
        self.playing_since = if auto_play { Some(Instant::now()) } else { None };
        self.auto_crossfade_triggered_track_id = None;
        self.sink = Some(sink);
        Ok((decoded_duration, detected_bpm))
    }
}

fn peek_has_next_track(snap: &PlayerSnapshot) -> bool {
    if snap.queue.is_empty() {
        return false;
    }
    if snap.repeat_mode == RepeatMode::One || snap.repeat_mode == RepeatMode::All {
        return true;
    }
    if snap.shuffle && snap.queue.len() > 1 {
        return true;
    }
    let cur_idx = snap.current_queue_index.unwrap_or(0);
    cur_idx + 1 < snap.queue.len()
}

fn emit_snapshot(app: &AppHandle, snapshot: &PlayerSnapshot) {
    let _ = app.emit("isla://playback-state", snapshot);
}

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn continuous_commands_cannot_postpone_playback_ticks() {
        let start=Instant::now();let period=Duration::from_millis(30);
        let mut ticker=PlaybackTicker::new(start);let mut ticks=0;
        for millisecond in 1..=300 {
            let now=start+Duration::from_millis(millisecond);
            // A command arrives each millisecond, faster than any timeout.
            assert!(ticker.wait(now,period)<=period);
            if ticker.take_due(now,period){ticks+=1;}
        }
        assert_eq!(ticks,10);
        let late=start+Duration::from_secs(5);
        assert!(ticker.take_due(late,period));
        assert!(!ticker.take_due(late,period),"a stall must not cause an unbounded catch-up burst");
    }
    #[test]
    fn progress_payload_contains_timing_without_queue_or_artwork() {
        let snap: PlayerSnapshot = serde_json::from_value(serde_json::json!({
            "isPlaying": true, "currentTrack": null, "positionSecs": 12.5,
            "durationSecs": 240.0, "volume": 0.7, "isMuted": false,
            "shuffle": false, "repeatMode": "off", "queue": [],
            "currentQueueIndex": null, "outputDevice": null, "lastError": null
        })).unwrap();
        let json = serde_json::to_value(PlayerProgress::from(&snap)).unwrap();
        assert_eq!(json["positionSecs"], 12.5);
        assert!(json.get("queue").is_none());
        assert!(json.get("currentTrack").is_none());
        assert!(serde_json::to_string(&json).unwrap().len() < 200);
    }
}

fn persist_queue(db: &Database, snap: &PlayerSnapshot) {
    let ids: Vec<i64> = snap.queue.iter().map(|t| t.id).collect();
    let _ = db.save_queue_state(&ids, snap.current_queue_index, snap.position_secs);
}

fn record_track_play(
    db: &Database,
    snap: &mut PlayerSnapshot,
    mut track: Track,
    detected_bpm: Option<f32>,
) -> Track {
    if let Some(bpm) = detected_bpm {
        if track.bpm.is_none() {
            track.bpm = Some(bpm);
            let _ = db.update_track_bpm(track.id, bpm);
        }
    }
    if let Ok(new_count) = db.increment_play_count(track.id) {
        track.play_count = new_count;
    } else {
        track.play_count = track.play_count.saturating_add(1);
    }
    if let Ok(Some(fresh)) = db.get_track_by_id(track.id) {
        track.is_favorite = fresh.is_favorite;
        track.play_count = fresh.play_count;
        if fresh.bpm.is_some() {
            track.bpm = fresh.bpm;
        }
    }
    for item in snap.queue.iter_mut() {
        if item.id == track.id {
            item.play_count = track.play_count;
            item.is_favorite = track.is_favorite;
            if track.bpm.is_some() {
                item.bpm = track.bpm;
            }
        }
    }
    track
}

struct PlaybackTicker { last:Instant }
impl PlaybackTicker {
    fn new(now:Instant)->Self{Self{last:now}}
    fn wait(&self,now:Instant,period:Duration)->Duration{period.saturating_sub(now.saturating_duration_since(self.last))}
    fn take_due(&mut self,now:Instant,period:Duration)->bool{
        if self.wait(now,period).is_zero(){self.last=now;true}else{false}
    }
}

fn run_audio_thread(
    rx: Receiver<AudioCommand>,
    snapshot_arc: Arc<Mutex<PlayerSnapshot>>,
    db: Arc<Database>,
    app: AppHandle,
    initial_device: String,
) {
    let mut rt = EngineRuntime {
        active_output_name: None,
        beat_meter: Arc::new(BeatMeter::default()),
        beat_pulse_enabled: db.load_settings().unwrap_or_default().beat_pulse,
        equalizer: Arc::new(EqControl::new(&db.load_settings().unwrap_or_default().equalizer)),
        stream: None,
        stream_handle: None,
        sink: None,
        active_speed_bits: Arc::new(AtomicU32::new(1.0f32.to_bits())),
        active_bass_cut_bits: Arc::new(AtomicU32::new(0.0f32.to_bits())),
        active_start_speed: 1.0,
        active_track_bpm: {
            let s = snapshot_arc.lock().unwrap();
            s.current_track.as_ref().and_then(|t| t.bpm)
        },
        outgoing_decks: Vec::new(),
        active_fade_in: None,
        current_active_gain: 1.0,
        auto_crossfade_triggered_track_id: None,
        device_name: initial_device,
        accumulated_secs: {
            let s = snapshot_arc.lock().unwrap();
            s.position_secs
        },
        playing_since: None,
    };

    let mut engine_tick = PlaybackTicker::new(Instant::now());
    let mut last_tick_emit = Instant::now();
    let mut last_beat_emit = Instant::now();
    let mut last_persist = Instant::now();

    loop {
        let wait_ms = if rt.beat_pulse_enabled && rt.sink.as_ref().map(|s| !s.is_paused()).unwrap_or(false) {
            30
        } else if !rt.outgoing_decks.is_empty() || rt.active_fade_in.is_some() {
            35
        } else {
            80
        };

        let tick_interval=Duration::from_millis(wait_ms);
        // Slider/volume commands must not restart the fade/progress deadline.
        match rx.recv_timeout(engine_tick.wait(Instant::now(),tick_interval)) {
            Ok(cmd) => {
                handle_command(cmd, &mut rt, &snapshot_arc, &db, &app);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {},
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
        if engine_tick.take_due(Instant::now(),tick_interval) {
                let mut should_advance = false;
                let mut emit_now = false;
                let mut snap_copy: Option<PlayerProgress> = None;

                {
                    let mut snap = snapshot_arc.lock().unwrap();
                    let eff_vol = if snap.is_muted { 0.0 } else { snap.volume };
                    let cf_changed = rt.tick_crossfade_envelopes(eff_vol, &mut snap);

                    if snap.is_playing {
                        let pos = rt.current_position(snap.duration_secs);
                        snap.position_secs = pos;

                        let sink_finished = rt.sink.as_ref().map(|s| s.empty()).unwrap_or(true);
                        let cur_track_id = snap.current_track.as_ref().map(|t| t.id);

                        // Check if we reached the Apple Music / Spotify End-of-Track Crossfade window
                        let can_auto_crossfade = snap.crossfade_enabled
                            && snap.crossfade_secs >= 0.8
                            && snap.duration_secs > (snap.crossfade_secs as f64 + 3.5)
                            && pos >= (snap.duration_secs - snap.crossfade_secs as f64)
                            && rt.auto_crossfade_triggered_track_id != cur_track_id
                            && peek_has_next_track(&snap);

                        if can_auto_crossfade {
                            rt.auto_crossfade_triggered_track_id = cur_track_id;
                            should_advance = true;
                        } else if sink_finished
                            || (snap.duration_secs > 0.5 && pos >= snap.duration_secs - 0.08)
                        {
                            should_advance = true;
                        } else if cf_changed || last_tick_emit.elapsed() >= Duration::from_millis(90)
                        {
                            emit_now = true;
                            snap_copy = Some(PlayerProgress::from(&*snap));
                            last_tick_emit = Instant::now();
                        }

                        if last_persist.elapsed() >= Duration::from_secs(5) {
                            persist_queue(&db, &snap);
                            last_persist = Instant::now();
                        }
                    } else if cf_changed {
                        emit_now = true;
                        snap_copy = Some(PlayerProgress::from(&*snap));
                    }
                }

                if should_advance {
                    handle_command(
                        AudioCommand::Next {
                            user_initiated: false,
                        },
                        &mut rt,
                        &snapshot_arc,
                        &db,
                        &app,
                    );
                } else if emit_now {
                    if let Some(sc) = snap_copy {
                        let _ = app.emit("isla://playback-progress", &sc);
                    }
                }
        }
        if last_beat_emit.elapsed() >= Duration::from_millis(30) {
            last_beat_emit = Instant::now();
            let mut strength = rt.beat_meter.take() * rt.sink.as_ref().map(|s| s.volume().clamp(0.0,1.0).sqrt()).unwrap_or(0.0);
            for deck in &rt.outgoing_decks {
                strength = strength.max(deck.beat_meter.take()*deck.sink.volume().clamp(0.0,1.0).sqrt());
            }
            // Only small transient events cross IPC, never samples, artwork or a queue.
            if rt.beat_pulse_enabled && strength > 0.0 {
                let snap = snapshot_arc.lock().unwrap();
                if snap.is_playing && !snap.is_muted && snap.volume > 0.001 {
                    let _ = app.emit("isla://audio-beat", serde_json::json!({
                        "trackId": snap.current_track.as_ref().map(|t| t.id), "strength": strength.clamp(0.0,1.0)
                    }));
                }
            }
        }
    }
}

fn manual_mix_fade_secs(snap: &PlayerSnapshot) -> f32 {
    if snap.crossfade_enabled && snap.is_playing && snap.crossfade_secs > 0.2 {
        (snap.crossfade_secs * 0.42).clamp(1.8, 3.4)
    } else {
        0.0
    }
}

fn handle_command(
    cmd: AudioCommand,
    rt: &mut EngineRuntime,
    snapshot_arc: &Arc<Mutex<PlayerSnapshot>>,
    db: &Arc<Database>,
    app: &AppHandle,
) {
    let mut snap = snapshot_arc.lock().unwrap();
    snap.last_error = None;
    let eff_vol = if snap.is_muted { 0.0 } else { snap.volume };

    match cmd {
        AudioCommand::OutputDevicesChanged { devices } => {
            match route_action(&rt.device_name,rt.active_output_name.as_deref(),&devices) {
                RouteAction::Keep => return,
                RouteAction::FollowDefault => {
                    // Release snapshot before dispatching the ordinary route handoff.
                    drop(snap);
                    handle_command(AudioCommand::SetOutputDevice { device_name: String::new() },rt,snapshot_arc,db,app);
                    return;
                }
                RouteAction::Unavailable => {
                    let pos = rt.current_position(snap.duration_secs);
                    rt.cancel_crossfade(eff_vol,&mut snap);
                    rt.sink = None;
                    rt.stream_handle = None;
                    rt.stream = None;
                    rt.active_output_name = None;
                    rt.accumulated_secs = pos;
                    rt.playing_since = None;
                    snap.position_secs = pos;
                    snap.is_playing = false;
                    let error = "Audio output disconnected. Choose an available output in Settings.".to_string();
                    snap.last_error = Some(error.clone());
                    let _ = app.emit("isla://playback-error",error);
                }
            }
        }
        AudioCommand::SetBeatPulse { enabled } => {
            rt.beat_pulse_enabled = enabled;
            rt.beat_meter.take();
            for deck in &rt.outgoing_decks { deck.beat_meter.take(); }
            return;
        }
        AudioCommand::PlayTrack { track, new_queue } => {
            if let Some(q) = new_queue {
                snap.queue = q;
            } else if snap.queue.is_empty() {
                snap.queue = vec![track.clone()];
            }
            let idx = snap
                .queue
                .iter()
                .position(|t| t.id == track.id || t.normalized_path == track.normalized_path)
                .unwrap_or_else(|| {
                    snap.queue.push(track.clone());
                    snap.queue.len() - 1
                });

            let outgoing = snap.current_track.clone();
            let fade_secs = if outgoing.as_ref().map(|t| t.id) != Some(track.id) {
                manual_mix_fade_secs(&snap)
            } else {
                0.0
            };

            snap.current_queue_index = Some(idx);
            match rt.load_and_start_track(&track, 0.0, eff_vol, true, fade_secs, outgoing) {
                Ok((dur, detected_bpm)) => {
                    let updated = record_track_play(db, &mut snap, track, detected_bpm);
                    snap.current_track = Some(updated);
                    snap.duration_secs = dur;
                    snap.position_secs = 0.0;
                    snap.is_playing = true;
                    rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                }
                Err(err) => {
                    if !std::path::Path::new(&track.file_path).is_file() {
                        let _ = db.set_track_missing(track.id, true);
                    }
                    snap.current_track = Some(track);
                    snap.is_playing = false;
                    snap.last_error = Some(err.clone());
                    let _ = app.emit("isla://playback-error", err);
                }
            }
            persist_queue(db, &snap);
        }

        AudioCommand::PlayQueueIndex { index } => {
            if let Some(track) = snap.queue.get(index).cloned() {
                let outgoing = snap.current_track.clone();
                let fade_secs = if outgoing.as_ref().map(|t| t.id) != Some(track.id) {
                    manual_mix_fade_secs(&snap)
                } else {
                    0.0
                };

                snap.current_queue_index = Some(index);
                match rt.load_and_start_track(&track, 0.0, eff_vol, true, fade_secs, outgoing) {
                    Ok((dur, detected_bpm)) => {
                        let updated = record_track_play(db, &mut snap, track, detected_bpm);
                        snap.current_track = Some(updated);
                        snap.duration_secs = dur;
                        snap.position_secs = 0.0;
                        snap.is_playing = true;
                        rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                    }
                    Err(err) => {
                        if !std::path::Path::new(&track.file_path).is_file() {
                            let _ = db.set_track_missing(track.id, true);
                        }
                        snap.current_track = Some(track);
                        snap.is_playing = false;
                        snap.last_error = Some(err.clone());
                        let _ = app.emit("isla://playback-error", err);
                    }
                }
                persist_queue(db, &snap);
            }
        }

        AudioCommand::TogglePlayPause => {
            if snap.is_playing {
                rt.cancel_crossfade(eff_vol, &mut snap);
                if let Some(sink) = rt.sink.as_ref() {
                    sink.pause();
                }
                rt.accumulated_secs = rt.current_position(snap.duration_secs);
                rt.playing_since = None;
                snap.position_secs = rt.accumulated_secs;
                snap.is_playing = false;
            } else if rt.sink.is_some() && !rt.sink.as_ref().unwrap().empty() {
                if let Some(sink) = rt.sink.as_ref() {
                    sink.set_volume(eff_vol);
                    sink.play();
                }
                rt.playing_since = Some(Instant::now());
                snap.is_playing = true;
            } else if let Some(mut track) = snap
                .current_track
                .clone()
                .or_else(|| snap.queue.first().cloned())
            {
                if snap.current_queue_index.is_none() && !snap.queue.is_empty() {
                    snap.current_queue_index = Some(0);
                }
                let start_at = if snap.position_secs < snap.duration_secs - 0.5 {
                    snap.position_secs
                } else {
                    0.0
                };
                match rt.load_and_start_track(&track, start_at, eff_vol, true, 0.0, None) {
                    Ok((dur, detected_bpm)) => {
                        if track.bpm.is_none() {
                            if let Some(b) = detected_bpm {
                                track.bpm = Some(b);
                                let _ = db.update_track_bpm(track.id, b);
                            }
                        }
                        snap.live_mix_bpm = track.bpm;
                        snap.current_track = Some(track);
                        snap.duration_secs = dur;
                        snap.position_secs = start_at;
                        snap.is_playing = true;
                    }
                    Err(err) => {
                        snap.is_playing = false;
                        snap.last_error = Some(err.clone());
                        let _ = app.emit("isla://playback-error", err);
                    }
                }
            }
            persist_queue(db, &snap);
        }

        AudioCommand::Play => {
            if !snap.is_playing {
                drop(snap);
                handle_command(AudioCommand::TogglePlayPause, rt, snapshot_arc, db, app);
                return;
            }
        }

        AudioCommand::Pause => {
            if snap.is_playing {
                rt.cancel_crossfade(eff_vol, &mut snap);
                if let Some(sink) = rt.sink.as_ref() {
                    sink.pause();
                }
                rt.accumulated_secs = rt.current_position(snap.duration_secs);
                rt.playing_since = None;
                snap.position_secs = rt.accumulated_secs;
                snap.is_playing = false;
                persist_queue(db, &snap);
            }
        }

        AudioCommand::Stop => {
            rt.cancel_crossfade(eff_vol, &mut snap);
            if let Some(sink) = rt.sink.take() {
                sink.stop();
            }
            rt.accumulated_secs = 0.0;
            rt.playing_since = None;
            snap.position_secs = 0.0;
            snap.is_playing = false;
            persist_queue(db, &snap);
        }

        AudioCommand::Next { user_initiated } => {
            if snap.queue.is_empty() {
                snap.is_playing = false;
                emit_snapshot(app, &snap);
                return;
            }

            let cur_idx = snap.current_queue_index.unwrap_or(0);
            let next_idx: Option<usize> =
                if !user_initiated && snap.repeat_mode == RepeatMode::One {
                    Some(cur_idx)
                } else if snap.shuffle && snap.queue.len() > 1 {
                    let mut candidates: Vec<usize> =
                        (0..snap.queue.len()).filter(|&i| i != cur_idx).collect();
                    candidates.shuffle(&mut rand::thread_rng());
                    candidates.first().copied()
                } else if cur_idx + 1 < snap.queue.len() {
                    Some(cur_idx + 1)
                } else if snap.repeat_mode == RepeatMode::All || user_initiated {
                    Some(0)
                } else {
                    None
                };

            if let Some(idx) = next_idx {
                if let Some(track) = snap.queue.get(idx).cloned() {
                    let outgoing = snap.current_track.clone();
                    let fade_secs = if !snap.crossfade_enabled || !snap.is_playing {
                        0.0
                    } else if !user_initiated {
                        // Full Apple Music / Spotify End-of-Track Crossfade
                        snap.crossfade_secs.clamp(1.0, 15.0)
                    } else {
                        // Smooth DJ Automix Crossfade on manual Next
                        manual_mix_fade_secs(&snap)
                    };

                    snap.current_queue_index = Some(idx);
                    match rt.load_and_start_track(&track, 0.0, eff_vol, true, fade_secs, outgoing)
                    {
                        Ok((dur, detected_bpm)) => {
                            let updated = record_track_play(db, &mut snap, track, detected_bpm);
                            snap.current_track = Some(updated);
                            snap.duration_secs = dur;
                            snap.position_secs = 0.0;
                            snap.is_playing = true;
                            rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                        }
                        Err(err) => {
                            snap.current_track = Some(track);
                            snap.is_playing = false;
                            snap.last_error = Some(err.clone());
                            let _ = app.emit("isla://playback-error", err);
                        }
                    }
                }
            } else {
                rt.cancel_crossfade(eff_vol, &mut snap);
                if let Some(sink) = rt.sink.take() {
                    sink.stop();
                }
                rt.accumulated_secs = 0.0;
                rt.playing_since = None;
                snap.position_secs = 0.0;
                snap.is_playing = false;
            }
            persist_queue(db, &snap);
        }

        AudioCommand::Previous => {
            if snap.queue.is_empty() {
                return;
            }
            let pos = rt.current_position(snap.duration_secs);
            if pos > 3.0 {
                drop(snap);
                handle_command(
                    AudioCommand::Seek { position_secs: 0.0 },
                    rt,
                    snapshot_arc,
                    db,
                    app,
                );
                return;
            }

            let cur_idx = snap.current_queue_index.unwrap_or(0);
            let prev_idx = if cur_idx > 0 {
                cur_idx - 1
            } else {
                snap.queue.len() - 1
            };

            if let Some(track) = snap.queue.get(prev_idx).cloned() {
                let outgoing = snap.current_track.clone();
                let should_play = snap.is_playing;
                let fade_secs = if should_play {
                    manual_mix_fade_secs(&snap)
                } else {
                    0.0
                };
                snap.current_queue_index = Some(prev_idx);
                match rt.load_and_start_track(
                    &track,
                    0.0,
                    eff_vol,
                    should_play,
                    fade_secs,
                    outgoing,
                ) {
                    Ok((dur, detected_bpm)) => {
                        let updated = if should_play {
                            record_track_play(db, &mut snap, track, detected_bpm)
                        } else {
                            let mut t = track;
                            if t.bpm.is_none() {
                                t.bpm = detected_bpm;
                            }
                            t
                        };
                        snap.current_track = Some(updated);
                        snap.duration_secs = dur;
                        snap.position_secs = 0.0;
                        snap.is_playing = should_play;
                        rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                    }
                    Err(err) => {
                        snap.is_playing = false;
                        snap.last_error = Some(err.clone());
                    }
                }
            }
            persist_queue(db, &snap);
        }

        AudioCommand::Seek { position_secs } => {
            let clamped = if snap.duration_secs > 0.0 {
                position_secs.clamp(0.0, snap.duration_secs)
            } else {
                position_secs.max(0.0)
            };

            if let Some(track) = snap.current_track.clone() {
                let was_playing = snap.is_playing;
                // Micro 0.14s crossfade on seek so scrubbing never clicks
                let seek_fade = if was_playing { 0.14 } else { 0.0 };
                if let Ok((dur, _)) =
                    rt.load_and_start_track(&track, clamped, eff_vol, was_playing, seek_fade, None)
                {
                    snap.duration_secs = dur;
                    snap.position_secs = clamped;
                }
            }
            persist_queue(db, &snap);
        }

        AudioCommand::SetVolume { volume } => {
            snap.volume = volume.clamp(0.0, 1.0);
            if snap.volume > 0.0 && snap.is_muted {
                snap.is_muted = false;
            }
            let v = if snap.is_muted { 0.0 } else { snap.volume };
            if !rt.tick_crossfade_envelopes(v, &mut snap) {
                if let Some(sink) = rt.sink.as_ref() {
                    sink.set_volume(v);
                }
            }
            let _ = db.update_playback_defaults(snap.volume, snap.shuffle, snap.repeat_mode);
        }

        AudioCommand::ToggleMute => {
            snap.is_muted = !snap.is_muted;
            let v = if snap.is_muted { 0.0 } else { snap.volume };
            if !rt.tick_crossfade_envelopes(v, &mut snap) {
                if let Some(sink) = rt.sink.as_ref() {
                    sink.set_volume(v);
                }
            }
        }

        AudioCommand::SetShuffle { shuffle } => {
            snap.shuffle = shuffle;
            let _ = db.update_playback_defaults(snap.volume, snap.shuffle, snap.repeat_mode);
        }

        AudioCommand::SetRepeatMode { mode } => {
            snap.repeat_mode = mode;
            let _ = db.update_playback_defaults(snap.volume, snap.shuffle, snap.repeat_mode);
        }

        AudioCommand::SetEqualizer { settings } => {
            rt.equalizer.set(&settings);
            return; // Preview changes do not need a full queue/artwork snapshot.
        }
        AudioCommand::SetCrossfade {
            enabled,
            duration_secs,
        } => {
            let clamped = duration_secs.clamp(0.0, 15.0);
            snap.crossfade_enabled = enabled && clamped > 0.2;
            if clamped > 0.2 {
                snap.crossfade_secs = clamped;
            }
            if !snap.crossfade_enabled {
                rt.cancel_crossfade(eff_vol, &mut snap);
            }
        }

        AudioCommand::SetQueue {
            tracks,
            start_index,
            auto_play,
        } => {
            snap.queue = tracks;
            let idx = start_index.unwrap_or(0);
            if let Some(track) = snap.queue.get(idx).cloned() {
                let outgoing = snap.current_track.clone();
                let fade_secs = if auto_play {
                    manual_mix_fade_secs(&snap)
                } else {
                    0.0
                };
                snap.current_queue_index = Some(idx);
                if auto_play {
                    match rt.load_and_start_track(&track, 0.0, eff_vol, true, fade_secs, outgoing)
                    {
                        Ok((dur, detected_bpm)) => {
                            let updated = record_track_play(db, &mut snap, track, detected_bpm);
                            snap.current_track = Some(updated);
                            snap.duration_secs = dur;
                            snap.position_secs = 0.0;
                            snap.is_playing = true;
                            rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                        }
                        Err(err) => {
                            snap.current_track = Some(track);
                            snap.is_playing = false;
                            snap.last_error = Some(err.clone());
                        }
                    }
                } else {
                    snap.current_track = Some(track.clone());
                    snap.duration_secs = track.duration_secs;
                    snap.position_secs = 0.0;
                    snap.is_playing = false;
                }
            } else {
                snap.current_queue_index = None;
                snap.current_track = None;
                snap.position_secs = 0.0;
                snap.duration_secs = 0.0;
                snap.is_playing = false;
            }
            persist_queue(db, &snap);
        }

        AudioCommand::AddToQueue { track, play_next } => {
            if snap.queue.is_empty() {
                snap.queue.push(track.clone());
                snap.current_queue_index = Some(0);
                snap.current_track = Some(track.clone());
                snap.duration_secs = track.duration_secs;
            } else if play_next {
                let insert_at = snap
                    .current_queue_index
                    .map(|i| (i + 1).min(snap.queue.len()))
                    .unwrap_or(snap.queue.len());
                snap.queue.insert(insert_at, track);
            } else {
                snap.queue.push(track);
            }
            persist_queue(db, &snap);
        }

        AudioCommand::RemoveFromQueue { index } => {
            if index < snap.queue.len() {
                snap.queue.remove(index);
                if snap.queue.is_empty() {
                    rt.cancel_crossfade(eff_vol, &mut snap);
                    if let Some(sink) = rt.sink.take() {
                        sink.stop();
                    }
                    snap.current_queue_index = None;
                    snap.current_track = None;
                    snap.position_secs = 0.0;
                    snap.duration_secs = 0.0;
                    snap.is_playing = false;
                } else if let Some(cur) = snap.current_queue_index {
                    if index < cur {
                        snap.current_queue_index = Some(cur - 1);
                    } else if index == cur {
                        let next_idx = cur.min(snap.queue.len() - 1);
                        snap.current_queue_index = Some(next_idx);
                        if let Some(next_track) = snap.queue.get(next_idx).cloned() {
                            let was_playing = snap.is_playing;
                            let outgoing = snap.current_track.clone();
                            let fade_secs = if was_playing {
                                manual_mix_fade_secs(&snap)
                            } else {
                                0.0
                            };
                            if let Ok((dur, detected_bpm)) = rt.load_and_start_track(
                                &next_track,
                                0.0,
                                eff_vol,
                                was_playing,
                                fade_secs,
                                outgoing,
                            ) {
                                let mut updated = next_track;
                                if updated.bpm.is_none() {
                                    updated.bpm = detected_bpm;
                                }
                                snap.current_track = Some(updated);
                                snap.duration_secs = dur;
                                snap.position_secs = 0.0;
                                rt.tick_crossfade_envelopes(eff_vol, &mut snap);
                            }
                        }
                    }
                }
                persist_queue(db, &snap);
            }
        }

        AudioCommand::ReorderQueue {
            from_index,
            to_index,
        } => {
            if from_index < snap.queue.len() && to_index < snap.queue.len() && from_index != to_index
            {
                let item = snap.queue.remove(from_index);
                snap.queue.insert(to_index, item);
                if let Some(cur) = snap.current_queue_index {
                    if cur == from_index {
                        snap.current_queue_index = Some(to_index);
                    } else if from_index < cur && to_index >= cur {
                        snap.current_queue_index = Some(cur - 1);
                    } else if from_index > cur && to_index <= cur {
                        snap.current_queue_index = Some(cur + 1);
                    }
                }
                persist_queue(db, &snap);
            }
        }

        AudioCommand::ClearQueue => {
            rt.cancel_crossfade(eff_vol, &mut snap);
            if let Some(sink) = rt.sink.take() {
                sink.stop();
            }
            rt.accumulated_secs = 0.0;
            rt.playing_since = None;
            snap.queue.clear();
            snap.current_queue_index = None;
            snap.current_track = None;
            snap.position_secs = 0.0;
            snap.duration_secs = 0.0;
            snap.is_playing = false;
            persist_queue(db, &snap);
        }

        AudioCommand::SetOutputDevice { device_name } => {
            let pos = rt.current_position(snap.duration_secs);
            let was_playing = snap.is_playing;
            rt.cancel_crossfade(eff_vol, &mut snap);
            rt.device_name = device_name.clone();
            rt.sink = None;
            rt.stream_handle = None;
            rt.stream = None;
            rt.active_output_name = None;
            rt.accumulated_secs = pos;
            rt.playing_since = None;
            snap.output_device = if device_name.trim().is_empty() {
                None
            } else {
                Some(device_name)
            };

            if let Some(track) = snap.current_track.clone() {
                if let Err(err) =
                    rt.load_and_start_track(&track, pos, eff_vol, was_playing, 0.0, None)
                {
                    snap.is_playing = false;
                    snap.last_error = Some(err.clone());
                    let _ = app.emit("isla://playback-error", err);
                }
            }
        }

        AudioCommand::SyncTrackMetadata { track } => {
            if let Some(cur) = snap.current_track.as_mut() {
                if cur.id == track.id {
                    *cur = track.clone();
                }
            }
            for item in snap.queue.iter_mut() {
                if item.id == track.id {
                    *item = track.clone();
                }
            }
        }
    }

    emit_snapshot(app, &snap);
}
