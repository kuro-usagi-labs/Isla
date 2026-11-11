use rodio::Source;
use std::fs::File;
use std::path::Path;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use std::time::Duration;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder as SymphDecoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphError;
use symphonia::core::formats::{FormatOptions, FormatReader, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::Time;

/// Custom Symphonia audio source that passes `std::fs::File` directly as `MediaSource`
/// so `byte_len()` is preserved (fixing `rodio 0.19`'s `ReadSeekSource` bug on MP4/M4A/DASH containers).
pub struct SymphoniaSource {
    format: Box<dyn FormatReader>,
    decoder: Box<dyn SymphDecoder>,
    track_id: u32,
    sample_rate: u32,
    channels: u16,
    total_duration: Option<Duration>,
    buffer: SampleBuffer<f32>,
    buffer_pos: usize,
}

impl SymphoniaSource {
    pub fn try_open(path: &Path, start_offset_secs: f64) -> Result<Self, String> {
        let file = File::open(path).map_err(|e| format!("Cannot open audio file: {e}"))?;
        let file_len = file.metadata().ok().map(|m| m.len()).unwrap_or(0);
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            hint.with_extension(ext);
        }

        let format_opts = FormatOptions {
            enable_gapless: true,
            ..Default::default()
        };
        let metadata_opts = MetadataOptions::default();

        let probed = symphonia::default::get_probe()
            .format(&hint, mss, &format_opts, &metadata_opts)
            .map_err(|e| format!("Unsupported or corrupted audio stream: {e}"))?;

        let mut format = probed.format;

        let track = format
            .tracks()
            .iter()
            .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
            .ok_or_else(|| "No supported audio track found in file".to_string())?;

        let track_id = track.id;
        let codec_params = track.codec_params.clone();

        let mut total_duration =
            codec_params
                .time_base
                .zip(codec_params.n_frames)
                .map(|(tb, frames)| {
                    let t = tb.calc_time(frames);
                    Duration::from_secs_f64(t.seconds as f64 + t.frac)
                });

        let mut decoder = symphonia::default::get_codecs()
            .make(&codec_params, &DecoderOptions::default())
            .map_err(|e| format!("Unsupported audio codec: {e}"))?;

        // Decode the first valid packet to confirm actual sample rate & channels
        let mut decode_retries = 0usize;
        let (sample_rate, channels, first_samples) = loop {
            match format.next_packet() {
                Ok(packet) => {
                    if packet.track_id() != track_id {
                        continue;
                    }
                    match decoder.decode(&packet) {
                        Ok(decoded) => {
                            let spec = *decoded.spec();
                            let sr = spec.rate;
                            let ch = (spec.channels.count() as u16).max(1);
                            let mut sbuf =
                                SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                            sbuf.copy_interleaved_ref(decoded);
                            break (sr, ch, sbuf);
                        }
                        Err(SymphError::DecodeError(_)) if decode_retries < 5 => {
                            decode_retries += 1;
                            continue;
                        }
                        Err(e) => return Err(format!("Audio decode error: {e}")),
                    }
                }
                Err(e) => return Err(format!("No decodable audio frames: {e}")),
            }
        };

        // If container did not specify n_frames in header (e.g., fragmented DASH M4A),
        // estimate duration from file size & typical compressed bitrate if needed
        if total_duration.is_none() && file_len > 0 {
            // Will be refined by Lofty or fallback estimate (~160 kbps)
            let est_secs = (file_len as f64 * 8.0) / 160_000.0;
            if est_secs > 1.0 {
                total_duration = Some(Duration::from_secs_f64(est_secs));
            }
        }

        let mut src = Self {
            format,
            decoder,
            track_id,
            sample_rate,
            channels,
            total_duration,
            buffer: first_samples,
            buffer_pos: 0,
        };

        if start_offset_secs > 0.05 {
            src.seek_to_seconds(start_offset_secs);
        }

        Ok(src)
    }

    pub fn seek_to_seconds(&mut self, position_secs: f64) {
        let target_time = Time::from(position_secs.max(0.0));
        if self
            .format
            .seek(
                SeekMode::Accurate,
                SeekTo::Time {
                    time: target_time,
                    track_id: Some(self.track_id),
                },
            )
            .is_ok()
        {
            self.decoder.reset();
            self.buffer.clear();
            self.buffer_pos = 0;
        } else {
            // Fallback for fragmented streams: skip packets up to target timestamp
            let samples_to_skip =
                (position_secs * self.sample_rate as f64 * self.channels as f64) as usize;
            let mut skipped = 0usize;
            while skipped < samples_to_skip {
                let remaining_in_buf = self.buffer.len().saturating_sub(self.buffer_pos);
                if remaining_in_buf > 0 {
                    let take = remaining_in_buf.min(samples_to_skip - skipped);
                    self.buffer_pos += take;
                    skipped += take;
                } else if !self.fill_next_buffer() {
                    break;
                }
            }
        }
    }

    fn fill_next_buffer(&mut self) -> bool {
        let mut retries = 0usize;
        loop {
            match self.format.next_packet() {
                Ok(packet) => {
                    if packet.track_id() != self.track_id {
                        continue;
                    }
                    match self.decoder.decode(&packet) {
                        Ok(decoded) => {
                            let spec = *decoded.spec();
                            if self.buffer.capacity() < decoded.capacity() * spec.channels.count() {
                                self.buffer =
                                    SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                            }
                            self.buffer.copy_interleaved_ref(decoded);
                            self.buffer_pos = 0;
                            if !self.buffer.is_empty() {
                                return true;
                            }
                        }
                        Err(SymphError::DecodeError(_)) if retries < 6 => {
                            retries += 1;
                            continue;
                        }
                        Err(_) => return false,
                    }
                }
                Err(_) => return false,
            }
        }
    }
}

impl Iterator for SymphoniaSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.buffer_pos >= self.buffer.len() {
            if !self.fill_next_buffer() {
                return None;
            }
        }
        let sample = self.buffer.samples()[self.buffer_pos];
        self.buffer_pos += 1;
        Some(sample)
    }
}

impl Source for SymphoniaSource {
    fn current_frame_len(&self) -> Option<usize> {
        let rem = self.buffer.len().saturating_sub(self.buffer_pos);
        if rem > 0 {
            Some(rem)
        } else {
            None
        }
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.total_duration
    }
}

/// Probes duration and sample rate safely using `SymphoniaSource`
pub fn probe_audio_stream(path: &Path) -> Option<(f64, u32)> {
    let src = SymphoniaSource::try_open(path, 0.0).ok()?;
    let dur = src.total_duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
    Some((dur, src.sample_rate()))
}

/// Real-time variable-speed resampler & DJ low-shelf bass-swap filter (`< 150 Hz`)
/// driven lock-free via `AtomicU32` (`f32::to_bits`) for beat-matched & tempo-synced Automix.
pub struct BpmSyncSource {
    inner: crate::read_ahead::ReadAheadSource,
    channels: usize,
    sample_rate: u32,
    speed_bits: Arc<AtomicU32>,
    bass_cut_bits: Arc<AtomicU32>,
    prev_frame: [f32; 2],
    curr_frame: [f32; 2],
    has_frames: bool,
    frac_pos: f64,
    out_channel_idx: usize,
    lp_state: [f32; 2],
    lp_alpha: f32,
    exhausted: bool,
}

impl BpmSyncSource {
    pub fn new(
        inner: crate::read_ahead::ReadAheadSource,
        speed_bits: Arc<AtomicU32>,
        bass_cut_bits: Arc<AtomicU32>,
    ) -> Self {
        let channels = (inner.channels() as usize).clamp(1, 2);
        let sample_rate = inner.sample_rate().max(8_000);
        // 1-pole low-pass cutoff at ~145 Hz for clean DJ kick/bass swap
        let lp_alpha = (2.0 * std::f32::consts::PI * 145.0 / sample_rate as f32).clamp(0.004, 0.22);
        Self {
            inner,
            channels,
            sample_rate,
            speed_bits,
            bass_cut_bits,
            prev_frame: [0.0; 2],
            curr_frame: [0.0; 2],
            has_frames: false,
            frac_pos: 0.0,
            out_channel_idx: 0,
            lp_state: [0.0; 2],
            lp_alpha,
            exhausted: false,
        }
    }

    fn pull_raw_frame(&mut self) -> Option<[f32; 2]> {
        let ch = self.inner.channels() as usize;
        let first = self.inner.next()?;
        let mut frame = [first, first];
        for c in 1..ch {
            let s = self.inner.next().unwrap_or(0.0);
            if c == 1 {
                frame[1] = s;
            }
        }
        Some(frame)
    }
}

impl Iterator for BpmSyncSource {
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.exhausted {
            return None;
        }

        if !self.has_frames {
            let f0 = self.pull_raw_frame()?;
            let f1 = self.pull_raw_frame().unwrap_or(f0);
            self.prev_frame = f0;
            self.curr_frame = f1;
            self.has_frames = true;
            self.frac_pos = 0.0;
            self.out_channel_idx = 0;
        }

        let ch_idx = self.out_channel_idx.min(1);
        let t = self.frac_pos as f32;
        let raw_sample =
            self.prev_frame[ch_idx] + (self.curr_frame[ch_idx] - self.prev_frame[ch_idx]) * t;

        // Update 1-pole low-frequency tracker (< 145 Hz) for click-free DJ bass swap
        self.lp_state[ch_idx] += self.lp_alpha * (raw_sample - self.lp_state[ch_idx]);
        let bass_cut = f32::from_bits(self.bass_cut_bits.load(Ordering::Relaxed)).clamp(0.0, 0.92);
        let processed = raw_sample - self.lp_state[ch_idx] * bass_cut;

        self.out_channel_idx += 1;
        if self.out_channel_idx >= self.channels {
            self.out_channel_idx = 0;
            let speed =
                f32::from_bits(self.speed_bits.load(Ordering::Relaxed)).clamp(0.85, 1.18) as f64;
            self.frac_pos += speed;
            while self.frac_pos >= 1.0 {
                self.frac_pos -= 1.0;
                self.prev_frame = self.curr_frame;
                match self.pull_raw_frame() {
                    Some(next_f) => {
                        self.curr_frame = next_f;
                    }
                    None => {
                        self.exhausted = true;
                        break;
                    }
                }
            }
        }

        Some(processed)
    }
}

impl Source for BpmSyncSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels as u16
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}
