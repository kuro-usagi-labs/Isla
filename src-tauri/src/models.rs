use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub file_path: String,
    pub normalized_path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub album_artist: String,
    pub genre: String,
    pub track_number: Option<u32>,
    pub year: Option<u32>,
    pub duration_secs: f64,
    pub format: String,
    pub bitrate_kbps: Option<u32>,
    pub sample_rate_hz: Option<u32>,
    pub file_size_bytes: u64,
    pub artwork_data_url: Option<String>,
    pub dominant_color: Option<String>,
    pub is_favorite: bool,
    #[serde(default)]
    pub play_count: u32,
    #[serde(default)]
    pub bpm: Option<f32>,
    pub date_added: i64,
    pub file_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlbumSummary {
    pub name: String,
    pub artist: String,
    pub year: Option<u32>,
    pub track_count: usize,
    pub total_duration_secs: f64,
    pub artwork_data_url: Option<String>,
    pub dominant_color: Option<String>,
    pub track_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistSummary {
    pub name: String,
    pub album_count: usize,
    pub track_count: usize,
    pub total_duration_secs: f64,
    pub artwork_data_url: Option<String>,
    pub track_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub description: String,
    pub track_count: usize,
    pub total_duration_secs: f64,
    pub cover_data_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistDetail {
    pub playlist: Playlist,
    pub tracks: Vec<Track>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

impl RepeatMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            RepeatMode::Off => "off",
            RepeatMode::All => "all",
            RepeatMode::One => "one",
        }
    }

    pub fn from_str(val: &str) -> Self {
        match val.trim().to_lowercase().as_str() {
            "all" => RepeatMode::All,
            "one" => RepeatMode::One,
            _ => RepeatMode::Off,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub is_playing: bool,
    pub current_track: Option<Track>,
    #[serde(default)]
    pub outgoing_track: Option<Track>,
    pub position_secs: f64,
    pub duration_secs: f64,
    pub volume: f32,
    pub is_muted: bool,
    pub shuffle: bool,
    pub repeat_mode: RepeatMode,
    #[serde(default = "default_crossfade_enabled")]
    pub crossfade_enabled: bool,
    #[serde(default = "default_crossfade_secs")]
    pub crossfade_secs: f32,
    #[serde(default)]
    pub is_crossfading: bool,
    #[serde(default)]
    pub crossfade_progress: f32,
    #[serde(default)]
    pub live_mix_bpm: Option<f32>,
    pub queue: Vec<Track>,
    pub current_queue_index: Option<usize>,
    pub output_device: Option<String>,
    pub last_error: Option<String>,
}

fn default_crossfade_enabled() -> bool {
    true
}

/// High-frequency ticks deliberately omit queue, cover art and full track metadata.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerProgress {
    pub track_id: Option<i64>,
    pub position_secs: f64,
    pub is_crossfading: bool,
    pub crossfade_progress: f32,
    pub live_mix_bpm: Option<f32>,
}

impl From<&PlayerSnapshot> for PlayerProgress {
    fn from(snap: &PlayerSnapshot) -> Self {
        Self { track_id: snap.current_track.as_ref().map(|t| t.id), position_secs: snap.position_secs,
            is_crossfading: snap.is_crossfading, crossfade_progress: snap.crossfade_progress,
            live_mix_bpm: snap.live_mix_bpm }
    }
}

fn default_crossfade_secs() -> f32 {
    6.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFolder {
    pub id: i64,
    pub path: String,
    pub track_count: usize,
    pub last_scanned: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total_tracks: usize,
    pub total_albums: usize,
    pub total_artists: usize,
    pub total_playlists: usize,
    pub total_favorites: usize,
    pub total_duration_secs: f64,
    pub total_size_bytes: u64,
    pub missing_tracks: usize,
    pub folder_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub folder_path: String,
    pub scanned_files: usize,
    pub total_files: usize,
    pub current_file: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    pub added_or_updated: usize,
    pub skipped_or_invalid: usize,
    pub missing_marked: usize,
    pub total_library_tracks: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub equalizer: crate::equalizer::EqualizerSettings,
    // Appearance
    pub theme: String,            // "light" | "dark" | "system"
    pub glass_intensity: String,  // "subtle" | "balanced" | "luminous"
    pub accent_color: String,     // hex e.g. "#5B7CFA"
    pub dynamic_artwork_accent: bool,
    pub reduced_motion: bool,

    // Floating Player
    pub always_on_top: bool,
    pub pill_size: String,        // "compact" | "default" | "large"
    pub start_expanded: bool,
    pub remember_position: bool,
    pub collapse_on_blur: bool,
    pub show_pill_waveform: bool,
    #[serde(default = "default_crossfade_enabled")]
    pub beat_pulse: bool,

    // Playback
    pub output_device: String,    // "" for system default
    pub default_volume: f32,
    pub default_shuffle: bool,
    pub default_repeat: RepeatMode,
    #[serde(default = "default_crossfade_enabled")]
    pub crossfade_enabled: bool,
    #[serde(default = "default_crossfade_secs")]
    pub crossfade_secs: f32,

    // Application
    pub launch_at_startup: bool,
    pub minimize_to_tray: bool,
    pub global_shortcuts_enabled: bool,

    // Persisted window coordinates
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            equalizer: crate::equalizer::EqualizerSettings::default(),
            theme: "light".to_string(),
            glass_intensity: "balanced".to_string(),
            accent_color: "#5B7CFA".to_string(),
            dynamic_artwork_accent: true,
            reduced_motion: false,
            always_on_top: true,
            pill_size: "default".to_string(),
            start_expanded: false,
            remember_position: true,
            collapse_on_blur: false,
            show_pill_waveform: true,
            beat_pulse: true,
            output_device: String::new(),
            default_volume: 0.72,
            default_shuffle: false,
            default_repeat: RepeatMode::Off,
            crossfade_enabled: true,
            crossfade_secs: 6.0,
            launch_at_startup: false,
            minimize_to_tray: true,
            global_shortcuts_enabled: true,
            window_x: Some(96),
            window_y: Some(72),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowGeometryResult {
    pub expanded: bool,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub anchor_offset_x: i32,
    pub anchor_offset_y: i32,
    pub is_dragging: bool,
}
