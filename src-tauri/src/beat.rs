use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Duration;
use rodio::Source;

#[derive(Default)]
pub struct BeatMeter { peak: AtomicU32 }
impl BeatMeter {
    pub fn take(&self) -> f32 { f32::from_bits(self.peak.swap(0, Ordering::Relaxed)) }
    fn publish(&self, strength: f32) { self.peak.fetch_max(strength.to_bits(), Ordering::Relaxed); }
}

// 10ms bass-energy windows. Independent channel filters avoid stereo cancellation.
// No allocation, lock or UI work occurs after construction in the audio callback.
pub struct BeatDetector {
    low: Vec<f32>, sub: Vec<f32>, channel: usize,
    low_alpha: f32, sub_alpha: f32, window_frames: u32, frames: u32,
    energy: f32, baseline: f32, previous: f32, refractory: u32,
}
impl BeatDetector {
    pub fn new(rate: u32, channels: u16) -> Self {
        let rate = rate.max(8000) as f32;
        Self { low: vec![0.0;channels.max(1) as usize], sub: vec![0.0;channels.max(1) as usize], channel: 0,
            low_alpha: 1.0-(-std::f32::consts::TAU*220.0/rate).exp(),
            sub_alpha: 1.0-(-std::f32::consts::TAU*35.0/rate).exp(),
            window_frames: (rate/100.0).round() as u32, frames: 0, energy: 0.0, baseline: 0.0, previous: 0.0, refractory: 0 }
    }
    pub fn process(&mut self, sample: f32) -> f32 {
        let sample = if sample.is_finite() { sample } else { 0.0 };
        let ch = self.channel;
        self.low[ch] += self.low_alpha*(sample-self.low[ch]);
        self.sub[ch] += self.sub_alpha*(sample-self.sub[ch]);
        self.energy += (self.low[ch]-self.sub[ch]).powi(2);
        self.channel = (ch+1)%self.low.len();
        if self.channel != 0 { return 0.0; }
        self.frames += 1;
        if self.frames < self.window_frames { return 0.0; }
        let energy = (self.energy/(self.frames as usize*self.low.len()) as f32).sqrt();
        self.energy = 0.0;
        self.frames = 0;
        self.refractory = self.refractory.saturating_sub(1);
        let onset = energy > 0.008 && energy > self.baseline*1.5
            && energy-self.previous > self.baseline*0.20+0.001 && self.refractory == 0;
        let strength = if onset {
            self.refractory = 16;
            ((energy/(self.baseline+0.006)-1.0)*0.3).clamp(0.25,1.0)
        } else { 0.0 };
        self.baseline += 0.08*(energy-self.baseline);
        self.previous = energy;
        strength
    }
}

pub struct BeatSource<S: Source<Item=f32>> { inner: S, detector: BeatDetector, meter: Arc<BeatMeter> }
impl<S: Source<Item=f32>> BeatSource<S> {
    pub fn new(inner: S, meter: Arc<BeatMeter>) -> Self {
        let detector = BeatDetector::new(inner.sample_rate(),inner.channels());
        Self { inner, detector, meter }
    }
}
impl<S: Source<Item=f32>> Iterator for BeatSource<S> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let sample = self.inner.next()?;
        let strength = self.detector.process(sample);
        if strength > 0.0 { self.meter.publish(strength); }
        Some(sample)
    }
}
impl<S: Source<Item=f32>> Source for BeatSource<S> {
    fn current_frame_len(&self) -> Option<usize> { self.inner.current_frame_len() }
    fn channels(&self) -> u16 { self.inner.channels() }
    fn sample_rate(&self) -> u32 { self.inner.sample_rate() }
    fn total_duration(&self) -> Option<Duration> { self.inner.total_duration() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn detect(rate: u32, channels: u16, kicks: bool, tone: bool) -> Vec<f64> {
        let mut detector = BeatDetector::new(rate, channels);
        let mut hits = Vec::new();
        for n in 0..rate*2 {
            let t = n as f64/rate as f64;
            let age = t-0.3-((t-0.3)/0.5).floor()*0.5;
            let kick = if kicks && t >= 0.3 && age < 0.12 { (t*70.0*std::f64::consts::TAU).sin() * 0.7 * (-age*35.0).exp() } else { 0.0 };
            let sample = if tone { (t*120.0*std::f64::consts::TAU).sin()*0.25 } else { kick } as f32;
            for ch in 0..channels {
                let strength = detector.process(if ch == 0 { sample } else { -sample });
                if strength > 0.0 { assert!(strength.is_finite() && strength <= 1.0); hits.push(t); }
            }
        }
        hits
    }
    #[test]
    fn follows_actual_kick_onsets_at_multiple_rates_and_stereo_polarities() {
        for rate in [8_000,44_100,48_000,96_000] {
            for channels in [1,2] {
                let hits = detect(rate,channels,true,false);
                for expected in [0.3,0.8,1.3,1.8] {
                    assert!(hits.iter().any(|t| *t >= expected && *t < expected+0.06), "rate {rate} ch {channels}: missing {expected}, hits {hits:?}");
                }
                assert_eq!(hits.len(),4,"one pulse per kick: {hits:?}");
            }
        }
    }
    #[test]
    fn silence_and_sustained_tone_do_not_create_a_fake_beat_clock() {
        assert!(detect(48_000,2,false,false).is_empty());
        assert!(detect(48_000,2,false,true).iter().all(|t| *t < 0.1));
    }
    #[test]
    fn metering_preserves_samples_and_hands_off_the_strongest_onset_once() {
        let input = rodio::buffer::SamplesBuffer::new(2,48_000,vec![0.1,-0.2,0.3,-0.4]);
        let meter = Arc::new(BeatMeter::default());
        let source = BeatSource::new(input,Arc::clone(&meter));
        assert_eq!(source.channels(),2);
        assert_eq!(source.sample_rate(),48_000);
        assert_eq!(source.collect::<Vec<_>>(),vec![0.1,-0.2,0.3,-0.4]);
        meter.publish(0.8); meter.publish(0.3);
        assert_eq!(meter.take(),0.8);
        assert_eq!(meter.take(),0.0);
    }
    #[test]
    fn beat_pulse_migrates_old_settings_and_persists_off() {
        let mut old = serde_json::to_value(crate::models::AppSettings::default()).unwrap();
        old.as_object_mut().unwrap().remove("beatPulse");
        let mut restored: crate::models::AppSettings = serde_json::from_value(old).unwrap();
        assert!(restored.beat_pulse);
        restored.beat_pulse = false;
        let json = serde_json::to_string(&restored).unwrap();
        assert!(!serde_json::from_str::<crate::models::AppSettings>(&json).unwrap().beat_pulse);
    }
    #[test]
    fn decoded_music_has_real_onsets_when_local_fixture_is_available() {
        let path = std::path::Path::new(r"D:\Lang\Music\Mencintai Dengan Ngeyel 2.mp3");
        if !path.is_file() { return; }
        let source = crate::audio::SymphoniaSource::try_open(path,20.0).unwrap();
        let count = source.sample_rate() as usize*source.channels() as usize*20;
        let mut detector = BeatDetector::new(source.sample_rate(),source.channels());
        let hits = source.take(count).filter(|sample| detector.process(*sample) > 0.0).count();
        println!("BEAT_AUDIT: {hits} audio onsets in 20 seconds of decoded music");
        assert!(hits >= 5 && hits <= 125,"music should produce plausible onsets, got {hits}");
    }
}
