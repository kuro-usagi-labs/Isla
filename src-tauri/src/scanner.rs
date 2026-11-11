use crate::audio::probe_audio_stream;
use crate::db::{normalize_file_path, now_unix, Database};
use crate::models::{ScanProgressPayload, ScanSummary, Track};
use base64::Engine;
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::MimeType;
use lofty::probe::Probe;
use lofty::tag::{Accessor, ItemKey};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"];

pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn parse_filename_artist_title(stem: &str) -> (String, String) {
    if let Some((left, right)) = stem.split_once(" - ") {
        let artist = left.trim();
        let title = right.trim();
        if !artist.is_empty() && !title.is_empty() {
            return (artist.to_string(), title.to_string());
        }
    }
    ("Unknown Artist".to_string(), stem.trim().to_string())
}

/// Selects a saturated image cluster, ignoring near-white/black borders.
fn accent_from_pixels(pixels: &[[u8; 3]]) -> Option<String> {
    let mut clusters = std::collections::HashMap::<u16, (u64, [u64; 3])>::new();
    for &[r, g, b] in pixels {
        let high = r.max(g).max(b);
        let low = r.min(g).min(b);
        if high < 28 || low > 235 || high - low < 24 { continue; }
        let key = ((r as u16 >> 4) << 8) | ((g as u16 >> 4) << 4) | (b as u16 >> 4);
        let weight = (high - low) as u64;
        let entry = clusters.entry(key).or_insert((0, [0; 3]));
        entry.0 += weight;
        for (sum, c) in entry.1.iter_mut().zip([r, g, b]) { *sum += c as u64 * weight; }
    }
    let (_, (weight, sums)) = clusters.into_iter().max_by_key(|(key, (weight, _))| (*weight, *key))?;
    let mut rgb = sums.map(|sum| sum as f64 / weight as f64);
    // Keep the accent readable on light surfaces while preserving the artwork hue.
    loop {
        let linear = rgb.map(|c| { let v = c / 255.0; if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) } });
        let luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        if luminance <= 0.183 { break; }
        rgb = rgb.map(|c| c * 0.94);
    }
    Some(format!("#{:02X}{:02X}{:02X}", rgb[0].round() as u8, rgb[1].round() as u8, rgb[2].round() as u8))
}

fn artwork_accent(bytes: &[u8]) -> Option<String> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes)).with_guessed_format().ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let thumb = reader.decode().ok()?.thumbnail(48, 48).to_rgba8();
    let pixels: Vec<[u8; 3]> = thumb.pixels().filter(|p| p[3] > 128).map(|p| [p[0], p[1], p[2]]).collect();
    accent_from_pixels(&pixels)
}

/// Decode cover pixels; use a stable metadata palette when a cover has no usable color.
fn derive_accent_color(bytes: Option<&[u8]>, seed_text: &str) -> String {
    if let Some(color) = bytes.and_then(artwork_accent) { return color; }
    let mut hash: u32 = 2166136261;
    if let Some(data) = bytes {
        let step = (data.len() / 256).max(1);
        for &b in data.iter().step_by(step).take(256) {
            hash ^= b as u32;
            hash = hash.wrapping_mul(16777619);
        }
    }
    for b in seed_text.bytes() {
        hash ^= b as u32;
        hash = hash.wrapping_mul(16777619);
    }

    const PALETTE: &[&str] = &[
        "#5B7CFA", // Royal Periwinkle (Default Isla Accent)
        "#4F6EF7", // Cobalt Glass
        "#6E59F7", // Soft Indigo
        "#7C5DFA", // Iris Violet
        "#3B82F6", // Sky Sapphire
        "#0EA5E9", // Cerulean Mist
        "#14B8A6", // Seafoam Teal
        "#EC4899", // Rose Quartz
        "#F43F5E", // Coral Blush
        "#D97706", // Warm Amber
    ];
    PALETTE[(hash as usize) % PALETTE.len()].to_string()
}

pub fn extract_track_metadata(path: &Path) -> Result<Track, String> {
    if !path.is_file() {
        return Err(format!("File does not exist: {}", path.display()));
    }
    if !is_supported_audio_file(path) {
        return Err(format!("Unsupported audio format: {}", path.display()));
    }

    let metadata = std::fs::metadata(path).map_err(|e| format!("Metadata error: {e}"))?;
    let file_size_bytes = metadata.len();

    let ext_upper = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("MP3")
        .to_ascii_uppercase();

    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled Track");
    let (fallback_artist, fallback_title) = parse_filename_artist_title(stem);
    let fallback_album = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("Single")
        .to_string();

    let mut title = fallback_title;
    let mut artist = fallback_artist;
    let mut album = fallback_album;
    let mut album_artist = String::new();
    let mut genre = String::new();
    let mut track_number: Option<u32> = None;
    let mut year: Option<u32> = None;
    let mut duration_secs: f64 = 0.0;
    let mut bitrate_kbps: Option<u32> = None;
    let mut sample_rate_hz: Option<u32> = None;
    let mut bpm: Option<f32> = None;
    let mut artwork_data_url: Option<String> = None;
    let mut pic_bytes_vec: Option<Vec<u8>> = None;

    // Use guess_file_type() so files whose container differs from extension (e.g. M4A named .mp3) are parsed accurately
    let probe_res = Probe::open(path)
        .and_then(|p| Ok(p.guess_file_type()?))
        .or_else(|_| Probe::open(path));

    if let Ok(probe) = probe_res {
        if let Ok(tagged_file) = probe.options(ParseOptions::new()).read() {
            let props = tagged_file.properties();
            duration_secs = props.duration().as_secs_f64();
            bitrate_kbps = props.audio_bitrate();
            sample_rate_hz = props.sample_rate();

            if let Some(tag) = tagged_file
                .primary_tag()
                .or_else(|| tagged_file.first_tag())
            {
                if let Some(t) = tag.title() {
                    let s = t.trim();
                    if !s.is_empty() {
                        title = s.to_string();
                    }
                }
                if let Some(a) = tag.artist() {
                    let s = a.trim();
                    if !s.is_empty() {
                        artist = s.to_string();
                    }
                }
                if let Some(al) = tag.album() {
                    let s = al.trim();
                    if !s.is_empty() {
                        album = s.to_string();
                    }
                }
                if let Some(aa) = tag.get_string(&ItemKey::AlbumArtist) {
                    let s = aa.trim();
                    if !s.is_empty() {
                        album_artist = s.to_string();
                    }
                }
                if let Some(g) = tag.genre() {
                    let s = g.trim();
                    if !s.is_empty() {
                        genre = s.to_string();
                    }
                }
                track_number = tag.track();
                year = tag.year();
                if let Some(bpm_str) = tag
                    .get_string(&ItemKey::Bpm)
                    .or_else(|| tag.get_string(&ItemKey::IntegerBpm))
                {
                    if let Ok(parsed_bpm) = bpm_str.trim().parse::<f32>() {
                        if (55.0..=210.0).contains(&parsed_bpm) {
                            bpm = Some(parsed_bpm.round());
                        }
                    }
                }

                if let Some(pic) = tag.pictures().first() {
                    let data = pic.data();
                    if !data.is_empty() && data.len() <= 1_500_000 {
                        let mime = match pic.mime_type() {
                            Some(MimeType::Png) => "image/png",
                            Some(MimeType::Gif) => "image/gif",
                            Some(MimeType::Bmp) => "image/bmp",
                            _ => "image/jpeg",
                        };
                        let encoded = base64::engine::general_purpose::STANDARD.encode(data);
                        artwork_data_url = Some(format!("data:{mime};base64,{encoded}"));
                        pic_bytes_vec = Some(data.to_vec());
                    }
                }
            }
        }
    }

    if duration_secs <= 0.05 {
        if let Some((probed_dur, probed_sr)) = probe_audio_stream(path) {
            if probed_dur > 0.0 {
                duration_secs = probed_dur;
            }
            if sample_rate_hz.is_none() {
                sample_rate_hz = Some(probed_sr);
            }
        }
    }

    if bpm.is_none() {
        if let Some((detected_bpm, _)) = crate::audio::analyze_track_bpm_and_beat(path, duration_secs)
        {
            bpm = Some(detected_bpm);
        }
    }

    let dominant_color = Some(derive_accent_color(
        pic_bytes_vec.as_deref(),
        &format!("{artist}-{album}-{title}"),
    ));

    Ok(Track {
        id: 0,
        file_path: path.to_string_lossy().to_string(),
        normalized_path: normalize_file_path(path),
        title,
        artist,
        album,
        album_artist,
        genre,
        track_number,
        year,
        duration_secs,
        format: ext_upper,
        bitrate_kbps,
        sample_rate_hz,
        bpm,
        file_size_bytes,
        artwork_data_url,
        dominant_color,
        is_favorite: false,
        play_count: 0,
        date_added: now_unix(),
        file_missing: false,
    })
}

pub fn collect_audio_files_in_folder(folder: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for entry in WalkDir::new(folder)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if p.is_file() && is_supported_audio_file(p) {
            files.push(p.to_path_buf());
        }
    }
    files
}

pub fn scan_paths_into_db(
    db: &Database,
    paths: &[PathBuf],
    app: Option<&AppHandle>,
) -> Result<ScanSummary, String> {
    let mut all_files: Vec<PathBuf> = Vec::new();
    for p in paths {
        if p.is_dir() {
            let _ = db.add_library_folder(p);
            all_files.extend(collect_audio_files_in_folder(p));
        } else if p.is_file() && is_supported_audio_file(p) {
            all_files.push(p.clone());
        }
    }

    let total_files = all_files.len();
    let mut added_or_updated = 0usize;
    let mut skipped_or_invalid = 0usize;
    let folder_label = paths
        .first()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    for (idx, file_path) in all_files.iter().enumerate() {
        let file_name = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        if let Some(handle) = app {
            if idx % 3 == 0 || idx + 1 == total_files {
                let _ = handle.emit(
                    "isla://scan-progress",
                    ScanProgressPayload {
                        folder_path: folder_label.clone(),
                        scanned_files: idx + 1,
                        total_files,
                        current_file: file_name,
                        done: false,
                    },
                );
            }
        }

        match extract_track_metadata(file_path) {
            Ok(track) => {
                if db.upsert_track(&track).is_ok() {
                    added_or_updated += 1;
                } else {
                    skipped_or_invalid += 1;
                }
            }
            Err(_) => {
                skipped_or_invalid += 1;
            }
        }
    }

    let missing_marked = db.verify_missing_files().unwrap_or(0);
    let total_library_tracks = db.get_all_tracks().map(|t| t.len()).unwrap_or(0);

    if let Some(handle) = app {
        let _ = handle.emit(
            "isla://scan-progress",
            ScanProgressPayload {
                folder_path: folder_label,
                scanned_files: total_files,
                total_files,
                current_file: String::new(),
                done: true,
            },
        );
    }

    Ok(ScanSummary {
        added_or_updated,
        skipped_or_invalid,
        missing_marked,
        total_library_tracks,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::SymphoniaSource;

    #[test]
    fn artwork_accent_uses_pixel_color_not_compressed_byte_hash() {
        let color = accent_from_pixels(&[[210, 35, 60], [210, 35, 60], [250, 250, 250]]).unwrap();
        let red = u8::from_str_radix(&color[1..3], 16).unwrap();
        let green = u8::from_str_radix(&color[3..5], 16).unwrap();
        assert!(red > green * 2, "red artwork should produce a red accent: {color}");
        assert_eq!(accent_from_pixels(&[]), None);
    }

    #[test]
    fn scans_and_decodes_real_audio_files_in_workspace() {
        let music_dir = Path::new(r"D:\Lang\Music");
        if music_dir.is_dir() {
            let files = collect_audio_files_in_folder(music_dir);
            assert!(!files.is_empty());
            for file in files.iter().take(3) {
                let track = extract_track_metadata(file).expect("extract metadata");
                assert!(!track.title.is_empty());
                assert!(track.duration_secs > 10.0);

                // Verify SymphoniaSource actually opens and decodes PCM samples from the file
                let mut source = SymphoniaSource::try_open(file, 0.0).expect("open audio decoder");
                let samples: Vec<f32> = source.by_ref().take(4096).collect();
                assert_eq!(samples.len(), 4096);
            }
        }
    }
}
