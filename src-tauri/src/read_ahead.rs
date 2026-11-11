//! File IO/decoding runs ahead on a worker, never on the device's render callback.
use rodio::Source;
use rtrb::{Consumer, PushError, RingBuffer};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    mpsc, Arc,
};
use std::time::Duration;

const BLOCK_SAMPLES: usize = 2048;
const BUFFER_SECONDS: f64 = 0.25;
struct Block {
    samples: [f32; BLOCK_SAMPLES],
    len: usize,
}

#[derive(Default)]
pub struct ReadAheadStats {
    starvation_frames: AtomicU64,
    starvation_events: AtomicU64,
}
impl ReadAheadStats {
    pub fn starvation_frames(&self) -> u64 {
        self.starvation_frames.load(Ordering::Relaxed)
    }
    pub fn starvation_events(&self) -> u64 {
        self.starvation_events.load(Ordering::Relaxed)
    }
}

pub struct ReadAheadSource {
    consumer: Consumer<Block>,
    current: Block,
    position: usize,
    channels: u16,
    rate: u32,
    duration: Option<Duration>,
    silence_remaining: usize,
    starving: bool,
    stats: Arc<ReadAheadStats>,
}
impl ReadAheadSource {
    pub fn new<S: Source<Item = f32> + Send + 'static>(mut source: S) -> Result<Self, String> {
        let channels = source.channels().max(1);
        let rate = source.sample_rate();
        let duration = source.total_duration();
        let block_len = BLOCK_SAMPLES / channels as usize * channels as usize;
        if block_len == 0 {
            return Err("Unsupported audio channel count".into());
        }
        let capacity = ((rate as f64 * channels as f64 * BUFFER_SECONDS / block_len as f64).ceil()
            as usize)
            .clamp(2, 256);
        let (mut producer, consumer) = RingBuffer::new(capacity);
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        std::thread::Builder::new()
            .name("isla-audio-decode".into())
            .spawn(move || {
                let mut ready = Some(ready_tx);
                let mut queued = 0;
                loop {
                    if producer.is_abandoned() {
                        return;
                    }
                    let mut block = Block {
                        samples: [0.0; BLOCK_SAMPLES],
                        len: 0,
                    };
                    for sample in &mut block.samples[..block_len] {
                        match source.next() {
                            Some(value) => {
                                *sample = value;
                                block.len += 1;
                            }
                            None => break,
                        }
                    }
                    if block.len == 0 {
                        break;
                    }
                    let last = block.len < block_len;
                    loop {
                        if producer.is_abandoned() {
                            return;
                        }
                        match producer.push(block) {
                            Ok(()) => break,
                            Err(PushError::Full(value)) => {
                                block = value;
                                std::thread::sleep(Duration::from_millis(1));
                            }
                        }
                    }
                    queued += 1;
                    if queued == capacity {
                        if let Some(tx) = ready.take() {
                            let _ = tx.send(());
                        }
                    }
                    if last {
                        break;
                    }
                }
                // Finite and very short files must also release the priming wait.
                if let Some(tx) = ready.take() {
                    drop(producer);
                    let _ = tx.send(());
                }
            })
            .map_err(|error| format!("Cannot start audio decoder: {error}"))?;
        // Only the engine/load thread waits. The device callback never waits for IO.
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .map_err(|error| format!("Cannot prime audio buffer: {error}"))?;
        Ok(Self {
            consumer,
            current: Block {
                samples: [0.0; BLOCK_SAMPLES],
                len: 0,
            },
            position: 0,
            channels,
            rate,
            duration,
            silence_remaining: 0,
            starving: false,
            stats: Arc::new(ReadAheadStats::default()),
        })
    }
    pub fn stats(&self) -> Arc<ReadAheadStats> {
        Arc::clone(&self.stats)
    }
}
impl Iterator for ReadAheadSource {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        if self.silence_remaining > 0 {
            self.silence_remaining -= 1;
            return Some(0.0);
        }
        if self.position == self.current.len {
            // Observe completion before pop: a producer finishing after a failed pop
            // must not cause the final queued block to be mistaken for EOF.
            let finished = self.consumer.is_abandoned();
            match self.consumer.pop() {
                Ok(block) => {
                    self.current = block;
                    self.position = 0;
                    self.starving = false;
                }
                Err(_) if finished => return None,
                Err(_) => {
                    if !self.starving {
                        self.stats.starvation_events.fetch_add(1, Ordering::Relaxed);
                        self.starving = true;
                    }
                    self.stats.starvation_frames.fetch_add(1, Ordering::Relaxed);
                    self.silence_remaining = self.channels as usize - 1;
                    return Some(0.0);
                }
            }
        }
        let value = self.current.samples[self.position];
        self.position += 1;
        Some(value)
    }
}
impl Source for ReadAheadSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        self.channels
    }
    fn sample_rate(&self) -> u32 {
        self.rate
    }
    fn total_duration(&self) -> Option<Duration> {
        self.duration
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_samples_channels_partial_blocks_and_end_of_stream() {
        for channels in [1, 2, 6] {
            for frames in [0, 1, 1024, 1351] {
                let input: Vec<_> = (0..frames * channels as usize)
                    .map(|n| n as f32 / 10000.0)
                    .collect();
                let source = ReadAheadSource::new(rodio::buffer::SamplesBuffer::new(
                    channels,
                    48000,
                    input.clone(),
                ))
                .unwrap();
                assert_eq!(source.channels(), channels);
                assert_eq!(source.sample_rate(), 48000);
                let stats = source.stats();
                assert_eq!(source.collect::<Vec<_>>(), input);
                assert_eq!(stats.starvation_frames(), 0);
            }
        }
    }
    struct PausedDecoder {
        remaining: usize,
        gate: mpsc::Receiver<()>,
        reached: mpsc::Sender<()>,
    }
    impl Iterator for PausedDecoder {
        type Item = f32;
        fn next(&mut self) -> Option<f32> {
            if self.remaining == 0 {
                let _ = self.reached.send(());
                if self.gate.recv().is_err() {
                    return None;
                }
                self.remaining = BLOCK_SAMPLES;
            }
            self.remaining -= 1;
            Some(if self.remaining % 2 == 0 { -0.25 } else { 0.5 })
        }
    }
    impl Source for PausedDecoder {
        fn current_frame_len(&self) -> Option<usize> {
            None
        }
        fn channels(&self) -> u16 {
            2
        }
        fn sample_rate(&self) -> u32 {
            8000
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
    }
    #[test]
    fn stalled_decoder_cannot_block_callback_and_recovers_in_channel_order() {
        // 8kHz stereo uses two prefilled blocks; hold the worker beyond that.
        let (tx, gate) = mpsc::channel();
        let (reached, rx) = mpsc::channel();
        let mut source = ReadAheadSource::new(PausedDecoder {
            remaining: BLOCK_SAMPLES * 2,
            gate,
            reached,
        })
        .unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        for _ in 0..BLOCK_SAMPLES * 2 {
            assert!(source.next().unwrap() != 0.0);
        }
        for _ in 0..256 {
            assert_eq!(source.next(), Some(0.0));
        }
        assert_eq!(source.stats.starvation_events(), 1);
        assert_eq!(source.stats.starvation_frames(), 128);
        tx.send(()).unwrap();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(source.next(), Some(0.5));
        assert_eq!(source.next(), Some(-0.25));
        drop(source);
        drop(tx);
    }
}
