//! RBJ peaking biquads: https://www.w3.org/TR/audio-eq-cookbook/.
//! Coefficients/headroom are prepared on the control thread. The render path only
//! reads a bounded atomic snapshot and crossfades already prepared filter banks.
use rodio::Source;
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU32, AtomicU64, Ordering},
    Arc, Mutex, Weak,
};
use std::time::Duration;

const FREQUENCIES: [f64; 10] = [
    31.0, 63.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];
const PRESETS: &[&str] = &[
    "flat",
    "bass-boost",
    "bass-reducer",
    "treble-boost",
    "vocal",
    "acoustic",
    "electronic",
    "rock",
    "jazz",
    "classical",
    "late-night",
    "custom",
];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct EqualizerSettings {
    pub enabled: bool,
    pub preset: String,
    pub preamp_db: f32,
    pub bands_db: [f32; 10],
}
impl Default for EqualizerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preset: "flat".into(),
            preamp_db: 0.0,
            bands_db: [0.0; 10],
        }
    }
}
impl EqualizerSettings {
    pub fn sanitized(&self) -> Self {
        let bound = |value: f32, min, max| {
            if value.is_finite() {
                value.clamp(min, max)
            } else {
                0.0
            }
        };
        Self {
            enabled: self.enabled,
            preset: if PRESETS.contains(&self.preset.as_str()) {
                self.preset.clone()
            } else {
                "custom".into()
            },
            preamp_db: bound(self.preamp_db, -12.0, 6.0),
            bands_db: self.bands_db.map(|value| bound(value, -12.0, 12.0)),
        }
    }
}

#[derive(Clone, Copy)]
struct Parameters {
    enabled: bool,
    preamp: f64,
    bands: [f64; 10],
}
struct EqReaders {
    settings: EqualizerSettings,
    readers: Vec<Weak<PreparedControl>>,
}
pub struct EqControl {
    state: Mutex<EqReaders>,
}
impl EqControl {
    pub fn new(settings: &EqualizerSettings) -> Self {
        Self {
            state: Mutex::new(EqReaders {
                settings: settings.sanitized(),
                readers: Vec::new(),
            }),
        }
    }
    // Called only by the audio-engine command thread (one writer).
    pub fn set(&self, settings: &EqualizerSettings) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.settings = settings.sanitized();
        let p = parameters(&state.settings);
        state.readers.retain(|reader| {
            if let Some(reader) = reader.upgrade() {
                reader.publish(p);
                true
            } else {
                false
            }
        });
    }
    fn register(&self, rate: f64) -> (Arc<PreparedControl>, (u32, bool, FilterBank)) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let reader = Arc::new(PreparedControl {
            rate,
            revision: AtomicU32::new(0),
            values: std::array::from_fn(|_| AtomicU64::new(0)),
        });
        reader.publish(parameters(&state.settings));
        let initial = reader
            .snapshot()
            .expect("Writer is held during reader registration");
        state.readers.retain(|reader| reader.strong_count() > 0);
        state.readers.push(Arc::downgrade(&reader));
        (reader, initial)
    }
}
fn parameters(s: &EqualizerSettings) -> Parameters {
    Parameters {
        enabled: s.enabled,
        preamp: s.preamp_db as f64,
        bands: s.bands_db.map(f64::from),
    }
}
struct PreparedControl {
    rate: f64,
    revision: AtomicU32,
    values: [AtomicU64; 63],
}
impl PreparedControl {
    fn publish(&self, p: Parameters) {
        let bank = FilterBank::new(self.rate, p);
        let values: [f64; 63] = std::array::from_fn(|i| match i {
            0 => {
                if p.enabled {
                    1.0
                } else {
                    0.0
                }
            }
            1 => p.preamp,
            2 => bank.gain,
            3..=12 => p.bands[i - 3],
            _ => bank.coefficients[(i - 13) / 5].0[(i - 13) % 5],
        });
        self.revision.fetch_add(1, Ordering::AcqRel);
        for (slot, value) in self.values.iter().zip(values) {
            slot.store(value.to_bits(), Ordering::Relaxed);
        }
        self.revision.fetch_add(1, Ordering::Release);
    }
    fn snapshot(&self) -> Option<(u32, bool, FilterBank)> {
        let revision = self.revision.load(Ordering::Acquire);
        if revision & 1 != 0 {
            return None;
        }
        let read = |i: usize| f64::from_bits(self.values[i].load(Ordering::Relaxed));
        let bands = std::array::from_fn(|i| read(i + 3));
        let preamp = read(1);
        let bank = FilterBank {
            coefficients: std::array::from_fn(|i| {
                Coefficients(std::array::from_fn(|j| read(13 + i * 5 + j)))
            }),
            states: [[[0.0; 2]; 10]; 2],
            gain: read(2),
            bands,
            preamp,
            identity: bands.iter().all(|db| db.abs() < 1e-8) && preamp.abs() < 1e-8,
        };
        let enabled = read(0) != 0.0;
        std::sync::atomic::fence(Ordering::Acquire);
        (self.revision.load(Ordering::Relaxed) == revision).then_some((revision, enabled, bank))
    }
}

#[derive(Clone, Copy)]
struct Coefficients([f64; 5]);
impl Coefficients {
    const UNITY: Self = Self([1.0, 0.0, 0.0, 0.0, 0.0]);
    fn peak(hz: f64, db: f64, rate: f64) -> Self {
        if hz >= rate * 0.45 || db.abs() < 1e-8 {
            return Self::UNITY;
        }
        let w = std::f64::consts::TAU * hz / rate;
        let a = 10.0f64.powf(db / 40.0);
        let alpha = w.sin() / (2.0 * 1.4);
        let a0 = 1.0 + alpha / a;
        Self([
            (1.0 + alpha * a) / a0,
            -2.0 * w.cos() / a0,
            (1.0 - alpha * a) / a0,
            -2.0 * w.cos() / a0,
            (1.0 - alpha / a) / a0,
        ])
    }
    fn power(&self, hz: f64, rate: f64) -> f64 {
        let [b0, b1, b2, a1, a2] = self.0;
        let w = std::f64::consts::TAU * hz / rate;
        let numerator = (b0 + b1 * w.cos() + b2 * (2.0 * w).cos()).powi(2)
            + (b1 * w.sin() + b2 * (2.0 * w).sin()).powi(2);
        let denominator = (1.0 + a1 * w.cos() + a2 * (2.0 * w).cos()).powi(2)
            + (a1 * w.sin() + a2 * (2.0 * w).sin()).powi(2);
        numerator / denominator.max(1e-24)
    }
}

#[derive(Clone, Copy)]
struct FilterBank {
    coefficients: [Coefficients; 10],
    states: [[[f64; 2]; 10]; 2],
    gain: f64,
    bands: [f64; 10],
    preamp: f64,
    identity: bool,
}
impl FilterBank {
    fn new(rate: f64, p: Parameters) -> Self {
        let coefficients =
            std::array::from_fn(|i| Coefficients::peak(FREQUENCIES[i], p.bands[i], rate));
        let mut peak = 1.0f64;
        for i in 0..138 {
            let hz = if i < 128 {
                20.0 * ((rate * 0.45).min(20000.0) / 20.0).powf(i as f64 / 127.0)
            } else {
                FREQUENCIES[i - 128].min(rate * 0.45)
            };
            peak = peak.max(
                coefficients
                    .iter()
                    .map(|c| c.power(hz, rate))
                    .product::<f64>(),
            );
        }
        // Compensate the EQ curve, then apply the user's output gain. Including preamp here cancelled positive settings.
        let correction = (10.0 * peak.log10()).max(0.0);
        let gain = 10.0f64
            .powf((p.preamp - correction - if correction > 0.001 { 0.25 } else { 0.0 }) / 20.0);
        Self {
            coefficients,
            states: [[[0.0; 2]; 10]; 2],
            gain,
            bands: p.bands,
            preamp: p.preamp,
            identity: p.bands.iter().all(|db| db.abs() < 1e-8) && p.preamp.abs() < 1e-8,
        }
    }
    fn process(&mut self, input: f64, channel: usize) -> f64 {
        if self.identity {
            return input;
        }
        let mut sample = input;
        for (coefficients, state) in self
            .coefficients
            .iter()
            .zip(self.states[channel].iter_mut())
        {
            let [b0, b1, b2, a1, a2] = coefficients.0;
            let out = b0 * sample + state[0];
            state[0] = b1 * sample - a1 * out + state[1];
            state[1] = b2 * sample - a2 * out;
            for value in state.iter_mut() {
                if value.abs() < 1e-24 {
                    *value = 0.0;
                }
            }
            sample = out;
        }
        sample *= self.gain;
        if !sample.is_finite() {
            self.states[channel] = [[0.0; 2]; 10];
            return 0.0;
        }
        // Catch rare filter-start transients without hard-clipping. Flat/bypass never passes this stage.
        if sample.abs() > 0.98 {
            sample.signum() * (0.98 + 0.02 * ((sample.abs() - 0.98) / 0.02).tanh())
        } else {
            sample
        }
    }
}

pub struct EqProcessor {
    controls: Arc<PreparedControl>,
    revision: u32,
    rate: f64,
    frames: u32,
    banks: [FilterBank; 2],
    active: usize,
    fading: bool,
    fade: f64,
    pending: Option<FilterBank>,
    wet: f64,
    target_wet: f64,
    smoothing: f64,
}
impl EqProcessor {
    pub fn new(rate: u32, controls: Arc<EqControl>) -> Self {
        let rate = rate.max(8000) as f64;
        let (controls, (revision, enabled, bank)) = controls.register(rate);
        let wet = if enabled { 1.0 } else { 0.0 };
        Self {
            controls,
            revision,
            rate,
            frames: 0,
            banks: [bank; 2],
            active: 0,
            fading: false,
            fade: 0.0,
            pending: None,
            wet,
            target_wet: wet,
            smoothing: 1.0 - (-1.0 / (0.02 * rate)).exp(),
        }
    }
    fn refresh(&mut self) {
        if self.controls.revision.load(Ordering::Acquire) == self.revision {
            return;
        }
        if let Some((revision, enabled, bank)) = self.controls.snapshot() {
            self.revision = revision;
            self.target_wet = if enabled { 1.0 } else { 0.0 };
            self.pending = Some(bank);
        }
    }
    pub fn process(&mut self, input: f32, channel: usize) -> f32 {
        let channel = channel.min(1);
        if !input.is_finite() {
            for bank in &mut self.banks {
                bank.states[channel] = [[0.0; 2]; 10];
            }
            return 0.0;
        }
        if channel == 0 {
            if self.frames % 64 == 0 {
                self.refresh();
            }
            self.frames = self.frames.wrapping_add(1);
            if !self.fading {
                if let Some(p) = self.pending.take() {
                    if p.bands != self.banks[self.active].bands
                        || p.preamp != self.banks[self.active].preamp
                    {
                        self.banks[1 - self.active] = p;
                        self.fade = 0.0;
                        self.fading = true;
                    }
                }
            }
            if self.fading {
                self.fade = (self.fade + 1.0 / (0.03 * self.rate)).min(1.0);
                if self.fade >= 1.0 {
                    self.active = 1 - self.active;
                    self.fading = false;
                }
            }
            self.wet += self.smoothing * (self.target_wet - self.wet);
        }
        if self.wet < 1e-7 && self.target_wet == 0.0 {
            for bank in &mut self.banks {
                bank.states[channel] = [[0.0; 2]; 10];
            }
            return input;
        }
        let mut colored = self.banks[self.active].process(input as f64, channel);
        if self.fading {
            let next = self.banks[1 - self.active].process(input as f64, channel);
            let t = self.fade * self.fade * (3.0 - 2.0 * self.fade);
            colored += t * (next - colored);
        }
        (input as f64 + self.wet * (colored - input as f64)) as f32
    }
}

pub struct EqualizedSource<S: Source<Item = f32>> {
    inner: S,
    processor: EqProcessor,
    channel: usize,
}
impl<S: Source<Item = f32>> EqualizedSource<S> {
    pub fn new(inner: S, controls: Arc<EqControl>) -> Self {
        let processor = EqProcessor::new(inner.sample_rate(), controls);
        Self {
            inner,
            processor,
            channel: 0,
        }
    }
}
impl<S: Source<Item = f32>> Iterator for EqualizedSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        let output = self.processor.process(sample, self.channel);
        self.channel = (self.channel + 1) % self.inner.channels().max(1) as usize;
        Some(output)
    }
}
impl<S: Source<Item = f32>> Source for EqualizedSource<S> {
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }
    fn channels(&self) -> u16 {
        self.inner.channels()
    }
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn paused_control_writer_never_spins_or_blocks_the_audio_reader() {
        let controls = Arc::new(EqControl::new(&EqualizerSettings {
            enabled: true,
            bands_db: [3.0; 10],
            ..Default::default()
        }));
        let mut processor = EqProcessor::new(48_000, Arc::clone(&controls));
        // Simulate a writer preempted halfway through its atomic publication.
        processor.controls.revision.fetch_add(1, Ordering::AcqRel);
        let _control_lock = controls.state.lock().unwrap();
        for _ in 0..4096 {
            assert!(processor.process(0.1, 0).is_finite());
            assert!(processor.process(-0.1, 1).is_finite());
        }
        // Keeping the previous bank is preferable to waiting for the writer.
        assert!(processor.controls.snapshot().is_none());
    }

    #[test]
    fn live_controls_prepare_independent_banks_for_different_stream_rates() {
        let controls = Arc::new(EqControl::new(&EqualizerSettings::default()));
        let low = EqProcessor::new(8_000, Arc::clone(&controls));
        let high = EqProcessor::new(96_000, Arc::clone(&controls));
        controls.set(&EqualizerSettings {
            enabled: true,
            bands_db: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 6.0],
            ..Default::default()
        });
        let (_, _, low_bank) = low.controls.snapshot().unwrap();
        let (_, _, high_bank) = high.controls.snapshot().unwrap();
        assert!(low_bank.coefficients[9].0 == Coefficients::UNITY.0);
        assert!(high_bank.coefficients[9].0 != Coefficients::UNITY.0);
    }

    #[test]
    fn bypass_and_flat_preserve_samples_and_stereo_channels() {
        let controls = Arc::new(EqControl::new(&EqualizerSettings::default()));
        let mut eq = EqProcessor::new(48_000, controls);
        for sample in [0.0, 0.125, -0.52, 0.99] {
            assert_eq!(eq.process(sample, 0), sample);
            assert_eq!(eq.process(0.0, 1), 0.0);
        }
        let flat = EqualizerSettings {
            enabled: true,
            ..Default::default()
        };
        let mut eq = EqProcessor::new(48_000, Arc::new(EqControl::new(&flat)));
        for sample in [0.125, -0.52, 0.99] {
            assert!((eq.process(sample, 0) - sample).abs() < 1e-6);
        }
    }

    fn tone_gain(settings: &EqualizerSettings, hz: f64) -> f64 {
        let mut eq = EqProcessor::new(48_000, Arc::new(EqControl::new(settings)));
        let mut sum = 0.0;
        for n in 0..48_000 {
            let input = (n as f64 * hz * std::f64::consts::TAU / 48_000.0).sin() as f32 * 0.1;
            let out = eq.process(input, 0);
            assert_eq!(
                eq.process(0.0, 1),
                0.0,
                "left channel must not bleed into right"
            );
            if n >= 24_000 {
                sum += (out as f64).powi(2);
            }
        }
        (sum / 24_000.0).sqrt() / (0.1 / 2.0f64.sqrt())
    }

    #[test]
    fn bass_boost_changes_frequency_response_with_headroom() {
        let mut settings = EqualizerSettings {
            enabled: true,
            ..Default::default()
        };
        settings.bands_db[1] = 9.0;
        let low = tone_gain(&settings, 63.0);
        let high = tone_gain(&settings, 4000.0);
        assert!(
            low / high > 2.0,
            "bass must be audibly boosted relative to treble"
        );
        assert!(
            low <= 1.05,
            "automatic headroom must compensate positive gain"
        );
    }

    #[test]
    fn preamp_has_measurable_positive_and_negative_gain() {
        for requested in [-6.0, 0.0, 6.0] {
            let settings = EqualizerSettings {
                enabled: true,
                preamp_db: requested,
                ..Default::default()
            };
            let measured = 20.0 * tone_gain(&settings, 1000.0).log10();
            assert!(
                (measured - requested as f64).abs() < 0.05,
                "preamp {requested}dB measured {measured}dB"
            );
        }
    }

    #[test]
    fn every_band_boosts_and_cuts_its_own_frequency() {
        for (index, hz) in FREQUENCIES.iter().enumerate() {
            for requested in [-6.0, 6.0] {
                let mut settings = EqualizerSettings {
                    enabled: true,
                    ..Default::default()
                };
                settings.bands_db[index] = requested;
                let reference = if index < 6 { 12000.0 } else { 125.0 };
                let measured =
                    20.0 * (tone_gain(&settings, *hz) / tone_gain(&settings, reference)).log10();
                assert!(
                    (measured - requested as f64).abs() < 0.35,
                    "band {hz}Hz {requested}dB measured {measured}dB relative to reference"
                );
            }
        }
    }

    #[test]
    fn all_ui_presets_produce_distinct_measured_audio_responses() {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Preset {
            id: String,
            bands_db: [f32; 10],
        }
        let presets: Vec<Preset> =
            serde_json::from_str(include_str!("../../src/data/equalizer-presets.json")).unwrap();
        assert_eq!(presets.len(), 11);
        let mut measured: Vec<(String, Vec<f64>)> = Vec::new();
        for preset in presets {
            let settings = EqualizerSettings {
                enabled: true,
                preset: preset.id.clone(),
                bands_db: preset.bands_db,
                ..Default::default()
            };
            let curve: Vec<f64> = FREQUENCIES
                .iter()
                .map(|hz| 20.0 * tone_gain(&settings, *hz).log10())
                .collect();
            if preset.id == "flat" {
                assert!(curve.iter().all(|db| db.abs() < 0.02));
            } else {
                assert!(
                    curve.iter().any(|db| db.abs() > 0.5),
                    "{} has no measurable audio effect",
                    preset.id
                );
            }
            for (other_id, other) in &measured {
                let difference = curve
                    .iter()
                    .zip(other)
                    .map(|(a, b)| (a - b).abs())
                    .fold(0.0, f64::max);
                assert!(
                    difference > 0.15,
                    "{} and {other_id} unexpectedly sound identical",
                    preset.id
                );
            }
            println!(
                "EQ_AUDIT {} {:?}",
                preset.id,
                curve
                    .iter()
                    .map(|db| (db * 100.0).round() / 100.0)
                    .collect::<Vec<_>>()
            );
            measured.push((preset.id, curve));
        }
    }

    #[test]
    fn full_level_live_preset_changes_do_not_clip() {
        for hz in [31.0, 63.0, 1000.0, 8000.0] {
            let flat = EqualizerSettings {
                enabled: true,
                ..Default::default()
            };
            let controls = Arc::new(EqControl::new(&flat));
            let mut eq = EqProcessor::new(48_000, Arc::clone(&controls));
            let boost = EqualizerSettings {
                enabled: true,
                bands_db: [12.0; 10],
                ..Default::default()
            };
            let mut saturated = 0;
            for n in 0..96_000 {
                if n == 24_000 {
                    controls.set(&boost);
                }
                if n == 60_000 {
                    controls.set(&flat);
                }
                let input = 0.99 * (std::f64::consts::TAU * hz * n as f64 / 48_000.0).sin();
                let sample = eq.process(input as f32, 0);
                assert!(
                    sample.is_finite() && sample.abs() <= 1.0001,
                    "live {hz}Hz preset transition clipped: {sample}"
                );
                if sample.abs() > 0.999 {
                    saturated += 1;
                }
            }
            assert!(
                saturated < 960,
                "transition must not simply saturate a loud signal"
            );
        }
    }

    #[test]
    fn live_settings_changes_and_low_sample_rates_remain_finite() {
        let controls = Arc::new(EqControl::new(&EqualizerSettings::default()));
        let mut eq = EqProcessor::new(8_000, Arc::clone(&controls));
        let settings = EqualizerSettings {
            enabled: true,
            bands_db: [12.0; 10],
            ..Default::default()
        };
        controls.set(&settings);
        let mut previous = 0.1;
        for _ in 0..8_000 {
            let sample = eq.process(0.1, 0);
            assert!(sample.is_finite());
            assert!((sample - previous).abs() < 0.15);
            previous = sample;
        }
        controls.set(&EqualizerSettings::default());
        for _ in 0..8_000 {
            assert!(eq.process(0.1, 0).is_finite());
        }
        assert!((eq.process(0.1, 0) - 0.1).abs() < 1e-4);
    }

    #[test]
    fn old_settings_default_and_invalid_values_are_sanitized() {
        let settings: EqualizerSettings = serde_json::from_str("{}").unwrap();
        assert!(!settings.enabled);
        let bad = EqualizerSettings {
            enabled: true,
            preamp_db: f32::NAN,
            bands_db: [99.0; 10],
            preset: "unknown".into(),
        }
        .sanitized();
        assert_eq!(bad.preamp_db, 0.0);
        assert_eq!(bad.bands_db, [12.0; 10]);
        assert_eq!(bad.preset, "custom");
        let mut legacy = serde_json::to_value(crate::models::AppSettings::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("equalizer");
        let restored: crate::models::AppSettings = serde_json::from_value(legacy).unwrap();
        assert_eq!(restored.equalizer, EqualizerSettings::default());
    }

    #[test]
    fn equalizer_settings_survive_reopen_and_other_playback_updates() {
        let path = std::env::temp_dir().join(format!(
            "isla-eq-{}-{}.sqlite3",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let settings = EqualizerSettings {
            enabled: true,
            preset: "custom".into(),
            preamp_db: -3.0,
            bands_db: [2.0; 10],
        };
        {
            let db = crate::db::Database::open(&path).unwrap();
            let mut stale_appearance = db.load_settings().unwrap();
            db.update_equalizer(&settings).unwrap();
            stale_appearance.theme = "dark".into();
            db.save_settings(&stale_appearance).unwrap();
            db.update_playback_defaults(0.42, true, crate::models::RepeatMode::All)
                .unwrap();
            db.update_window_position(123, 234).unwrap();
        }
        {
            let db = crate::db::Database::open(&path).unwrap();
            let saved = db.load_settings().unwrap();
            assert_eq!(saved.equalizer, settings);
            assert_eq!(saved.default_volume, 0.42);
            assert_eq!(saved.window_x, Some(123));
            assert_eq!(saved.theme, "dark");
        }
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn source_wrapper_filters_interleaved_audio_without_dropping_samples() {
        let settings = EqualizerSettings {
            enabled: true,
            bands_db: [0.0, 9.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ..Default::default()
        };
        let input: Vec<f32> = (0..4800)
            .flat_map(|n| {
                [
                    0.1 * (std::f64::consts::TAU * 4000.0 * n as f64 / 48000.0).sin() as f32,
                    0.0,
                ]
            })
            .collect();
        let source = rodio::buffer::SamplesBuffer::new(2, 48000, input);
        let equalized = EqualizedSource::new(source, Arc::new(EqControl::new(&settings)));
        assert_eq!(equalized.channels(), 2);
        assert_eq!(equalized.sample_rate(), 48000);
        let output: Vec<f32> = equalized.collect();
        assert_eq!(output.len(), 9600);
        assert!(output.iter().skip(1).step_by(2).all(|s| *s == 0.0));
        assert!(output.iter().step_by(2).skip(2000).all(|s| s.abs() < 0.05));
    }
}
