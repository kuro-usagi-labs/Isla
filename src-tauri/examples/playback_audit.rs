//! Native playback timing audit. Uses the production decoder, EQ and beat meter.
//! cargo run --release --example playback_audit -- path/to/music.mp3
#![allow(dead_code)]
#![cfg(not(test))]
#[path = "../src/beat.rs"]
mod beat;
#[path = "../src/decoder.rs"]
mod decoder;
#[path = "../src/equalizer.rs"]
mod equalizer;
#[path = "../src/read_ahead.rs"]
mod read_ahead;
use rodio::Source;
use std::{
    path::Path,
    sync::{atomic::AtomicU32, Arc},
    time::{Duration, Instant},
};

struct AuditDeck {
    source: Box<dyn Source<Item = f32> + Send>,
    stats: Arc<read_ahead::ReadAheadStats>,
    speed: Arc<AtomicU32>,
    bass: Arc<AtomicU32>,
}
fn deck(path: &Path, controls: Arc<equalizer::EqControl>) -> AuditDeck {
    let source = decoder::SymphoniaSource::try_open(path, 10.0).unwrap();
    let buffered = read_ahead::ReadAheadSource::new(source).unwrap();
    let stats = buffered.stats();
    let speed = Arc::new(AtomicU32::new(1.0f32.to_bits()));
    let bass = Arc::new(AtomicU32::new(0.0f32.to_bits()));
    let sync = decoder::BpmSyncSource::new(buffered, Arc::clone(&speed), Arc::clone(&bass));
    AuditDeck {
        source: Box::new(beat::BeatSource::new(
            equalizer::EqualizedSource::new(sync, controls),
            Arc::new(beat::BeatMeter::default()),
        )),
        stats,
        speed,
        bass,
    }
}
fn main() {
    let path = std::env::args().nth(1).expect("Supply a local audio file");
    if std::env::args().any(|arg| arg == "--timed-device") {
        timed_device_audit(Path::new(&path));
        return;
    }
    if std::env::args().any(|arg| arg == "--device") {
        device_audit(Path::new(&path));
        return;
    }
    for (name, enabled, live, decks) in [
        ("bypass+beat", false, false, 1),
        ("eq+beat", true, false, 1),
        ("live-eq+beat", true, true, 1),
        ("crossfade+live-eq+beat", true, true, 2),
    ] {
        let mut settings = equalizer::EqualizerSettings {
            enabled,
            bands_db: [6.0, 4.0, 2.0, 0.0, -2.0, -1.0, 1.0, 3.0, 4.0, 5.0],
            ..Default::default()
        };
        let controls = Arc::new(equalizer::EqControl::new(&settings));
        let mut sources: Vec<_> = (0..decks)
            .map(|_| deck(Path::new(&path), Arc::clone(&controls)))
            .collect();
        let rate = sources[0].source.sample_rate();
        let channels = sources[0].source.channels();
        let frames = 256usize;
        let budget = frames as f64 / rate as f64;
        let count = (3.0 / budget).ceil() as usize;
        let start = Instant::now();
        let mut timings = Vec::with_capacity(count);
        let mut peak = 0.0f32;
        for block in 0..count {
            if live && block % 16 == 0 {
                settings.bands_db[0] = if block % 32 == 0 { 12.0 } else { -6.0 };
                controls.set(&settings);
            }
            let now = Instant::now();
            for _ in 0..frames * channels as usize {
                for source in &mut sources {
                    peak =
                        peak.max(std::hint::black_box(source.source.next().unwrap_or(0.0)).abs());
                }
            }
            timings.push(now.elapsed().as_secs_f64());
            let deadline = start + Duration::from_secs_f64((block + 1) as f64 * budget);
            if let Some(wait) = deadline.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
        }
        timings.sort_by(f64::total_cmp);
        println!(
            "{}",
            serde_json::json!({"scenario":name,"sampleRate":rate,"channels":channels,"blocks":count,"budgetMs":budget*1000.0,"p50Ms":timings[count/2]*1000.0,"p99Ms":timings[count*99/100]*1000.0,"maxMs":timings[count-1]*1000.0,"overBudget":timings.iter().filter(|t|**t>budget).count(),"starvationFrames":sources.iter().map(|s|s.stats.starvation_frames()).sum::<u64>(),"peak":peak})
        );
    }
}

struct CallbackStats {
    calls: std::sync::atomic::AtomicU64,
    max_ns: std::sync::atomic::AtomicU64,
    over_budget: std::sync::atomic::AtomicU64,
    errors: std::sync::atomic::AtomicU64,
    min_budget_ns: std::sync::atomic::AtomicU64,
    bins: [std::sync::atomic::AtomicU64; 256],
}
impl CallbackStats {
    fn new() -> Self {
        use std::sync::atomic::AtomicU64;
        Self {
            calls: AtomicU64::new(0),
            max_ns: AtomicU64::new(0),
            over_budget: AtomicU64::new(0),
            errors: AtomicU64::new(0),
            min_budget_ns: AtomicU64::new(u64::MAX),
            bins: std::array::from_fn(|_| AtomicU64::new(0)),
        }
    }
}
fn timed_stream<T: rodio::cpal::SizedSample + rodio::cpal::FromSample<f32>>(
    device: &rodio::cpal::Device,
    config: &rodio::cpal::StreamConfig,
    a: AuditDeck,
    b: AuditDeck,
    stats: Arc<CallbackStats>,
) -> rodio::cpal::Stream {
    use rodio::cpal::traits::DeviceTrait;
    use std::sync::atomic::Ordering::Relaxed;
    let mut a = rodio::source::UniformSourceIterator::<_, f32>::new(
        a.source,
        config.channels,
        config.sample_rate.0,
    );
    let mut b = rodio::source::UniformSourceIterator::<_, f32>::new(
        b.source,
        config.channels,
        config.sample_rate.0,
    );
    let channels = config.channels as f64;
    let rate = config.sample_rate.0 as f64;
    let errors = Arc::clone(&stats);
    device
        .build_output_stream(
            config,
            move |data: &mut [T], _| {
                let begin = Instant::now();
                for value in data.iter_mut() {
                    std::hint::black_box(a.next().unwrap_or(0.0) + b.next().unwrap_or(0.0));
                    *value = T::from_sample(0.0);
                }
                let ns = begin.elapsed().as_nanos() as u64;
                let budget = (data.len() as f64 / channels / rate * 1e9) as u64;
                stats.max_ns.fetch_max(ns, Relaxed);
                stats.min_budget_ns.fetch_min(budget, Relaxed);
                stats.calls.fetch_add(1, Relaxed);
                stats.bins[(ns / 50_000).min(255) as usize].fetch_add(1, Relaxed);
                if ns > budget {
                    stats.over_budget.fetch_add(1, Relaxed);
                }
            },
            move |_| {
                errors.errors.fetch_add(1, Relaxed);
            },
            None,
        )
        .unwrap()
}
fn timed_device_audit(path: &Path) {
    use rodio::cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::atomic::Ordering::Relaxed;
    let seconds = std::env::args()
        .find_map(|a| {
            a.strip_prefix("--seconds=")
                .and_then(|v| v.parse::<u64>().ok())
        })
        .filter(|v| (1..=600).contains(v))
        .unwrap_or(12);
    let device = rodio::cpal::default_host()
        .default_output_device()
        .expect("No default output");
    let supported = device.default_output_config().unwrap();
    let config = supported.config();
    let mut settings = equalizer::EqualizerSettings {
        enabled: true,
        ..Default::default()
    };
    let controls = Arc::new(equalizer::EqControl::new(&settings));
    let a = deck(path, Arc::clone(&controls));
    let b = deck(path, Arc::clone(&controls));
    let starvation = [Arc::clone(&a.stats), Arc::clone(&b.stats)];
    let stats = Arc::new(CallbackStats::new());
    let stream = match supported.sample_format() {
        rodio::cpal::SampleFormat::F32 => {
            timed_stream::<f32>(&device, &config, a, b, Arc::clone(&stats))
        }
        rodio::cpal::SampleFormat::I16 => {
            timed_stream::<i16>(&device, &config, a, b, Arc::clone(&stats))
        }
        rodio::cpal::SampleFormat::U16 => {
            timed_stream::<u16>(&device, &config, a, b, Arc::clone(&stats))
        }
        other => panic!("Unsupported audit output format {other:?}"),
    };
    stream.play().unwrap();
    let workers: Vec<_> = (0..2)
        .map(|_| {
            std::thread::spawn(move || {
                let start = Instant::now();
                let mut value = 0.12f64;
                while start.elapsed() < Duration::from_secs(seconds) {
                    for _ in 0..1000 {
                        value = std::hint::black_box(value.sin() + 0.1234);
                    }
                }
            })
        })
        .collect();
    for n in 0..seconds * 20 {
        settings.bands_db[0] = if n % 2 == 0 { 12.0 } else { -6.0 };
        controls.set(&settings);
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(stream);
    for worker in workers {
        worker.join().unwrap();
    }
    let count = stats.calls.load(Relaxed);
    let mut total = 0;
    let mut p99 = None;
    for (i, bin) in stats.bins.iter().enumerate() {
        total += bin.load(Relaxed);
        if total >= count * 99 / 100 {
            p99 = (i < 255).then_some((i + 1) as f64 * 0.05);
            break;
        }
    }
    println!(
        "{}",
        serde_json::json!({"scenario":"timed-cpal-callback-two-production-decks-eq20hz-cpu2","seconds":seconds,"sampleRate":config.sample_rate.0,"channels":config.channels,"callbacks":count,"minBudgetMs":stats.min_budget_ns.load(Relaxed) as f64/1e6,"p99UpperMs":p99,"maxMs":stats.max_ns.load(Relaxed) as f64/1e6,"overBudget":stats.over_budget.load(Relaxed),"streamErrors":stats.errors.load(Relaxed),"starvationFrames":starvation.iter().map(|s|s.starvation_frames()).sum::<u64>()})
    );
}

fn device_audit(path: &Path) {
    let (_stream, handle) =
        rodio::OutputStream::try_default().expect("Default audio output unavailable");
    let mut settings = equalizer::EqualizerSettings {
        enabled: true,
        ..Default::default()
    };
    let controls = Arc::new(equalizer::EqControl::new(&settings));
    let a = deck(path, Arc::clone(&controls));
    let b = deck(path, Arc::clone(&controls));
    let stats = [Arc::clone(&a.stats), Arc::clone(&b.stats)];
    let speed = [Arc::clone(&a.speed), Arc::clone(&b.speed)];
    let bass = [Arc::clone(&a.bass), Arc::clone(&b.bass)];
    let sink_a = rodio::Sink::try_new(&handle).unwrap();
    let sink_b = rodio::Sink::try_new(&handle).unwrap();
    // Gain zero keeps the probe quiet while the real device callback consumes both decks.
    sink_a.set_volume(0.0);
    sink_b.set_volume(0.0);
    sink_a.append(a.source.take_duration(Duration::from_secs(12)));
    sink_b.append(b.source.take_duration(Duration::from_secs(12)));
    let workers: Vec<_> = (0..2)
        .map(|_| {
            std::thread::spawn(|| {
                let start = Instant::now();
                let mut value = 0.1234f64;
                while start.elapsed() < Duration::from_secs(12) {
                    for _ in 0..1000 {
                        value = std::hint::black_box(value.sin() + 0.1234);
                    }
                }
            })
        })
        .collect();
    let presets: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../src/data/equalizer-presets.json")).unwrap();
    for n in 0..240 {
        let gains = presets[n % presets.len()]["bandsDb"].as_array().unwrap();
        settings.bands_db = std::array::from_fn(|i| gains[i].as_f64().unwrap() as f32);
        controls.set(&settings);
        for (i, control) in speed.iter().enumerate() {
            control.store(
                (if (n + i) % 2 == 0 { 1.08f32 } else { 0.94f32 }).to_bits(),
                std::sync::atomic::Ordering::Relaxed,
            );
        }
        for control in &bass {
            control.store(
                (if n % 2 == 0 { 0.75f32 } else { 0.0f32 }).to_bits(),
                std::sync::atomic::Ordering::Relaxed,
            );
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    sink_a.stop();
    sink_b.stop();
    for worker in workers {
        worker.join().unwrap();
    }
    println!(
        "{}",
        serde_json::json!({"scenario":"real-device-two-decks-eq20hz-tempo-bass-beat-cpu-load","seconds":12,"cpuWorkers":2,"starvationFrames":stats.iter().map(|s|s.starvation_frames()).sum::<u64>(),"starvationEvents":stats.iter().map(|s|s.starvation_events()).sum::<u64>()})
    );
}
