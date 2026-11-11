#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio;
mod audio_devices;
mod decoder;
mod read_ahead;
mod beat;
mod equalizer;
mod db;
mod models;
mod scanner;
mod window_manager;

use audio::{list_output_devices, AudioCommand, AudioController};
use db::Database;
use models::{
    AlbumSummary, AppSettings, ArtistSummary, AudioDeviceInfo, LibraryFolder, LibraryStats,
    PlayerSnapshot, Playlist, PlaylistDetail, RepeatMode, ScanSummary, Track, WindowGeometryResult,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window_manager::{
    apply_window_mode, begin_interactive_drag, persist_current_window_position,
    restore_initial_window_bounds, set_context_menu_open_state, set_windows_startup,
    spawn_window_interaction_loop, WindowController,
};

pub struct AppState {
    pub db: Arc<Database>,
    pub audio: Arc<AudioController>,
    pub window_ctrl: Arc<WindowController>,
    pub is_quitting: Arc<AtomicBool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialBootstrapPayload {
    pub settings: AppSettings,
    pub player: PlayerSnapshot,
    pub tracks: Vec<Track>,
    pub albums: Vec<AlbumSummary>,
    pub artists: Vec<ArtistSummary>,
    pub playlists: Vec<Playlist>,
    pub folders: Vec<LibraryFolder>,
    pub stats: LibraryStats,
    pub expanded: bool,
    pub anchor_offset_x: i32,
    pub anchor_offset_y: i32,
}

#[tauri::command]
fn get_initial_app_state(state: State<'_, AppState>) -> Result<InitialBootstrapPayload, String> {
    let settings = state.db.load_settings()?;
    let player = state.audio.get_snapshot();
    let tracks = state.db.get_all_tracks()?;
    let albums = state.db.get_albums()?;
    let artists = state.db.get_artists()?;
    let playlists = state.db.get_playlists()?;
    let folders = state.db.get_library_folders()?;
    let stats = state.db.get_library_stats()?;
    let expanded = state.window_ctrl.is_expanded();
    let (anchor_offset_x, anchor_offset_y) = state.window_ctrl.get_anchor_offsets();

    Ok(InitialBootstrapPayload {
        settings,
        player,
        tracks,
        albums,
        artists,
        playlists,
        folders,
        stats,
        expanded,
        anchor_offset_x,
        anchor_offset_y,
    })
}

// --- Window Commands ---

#[tauri::command]
async fn set_island_bounds(state: State<'_, AppState>, bounds: window_manager::IslandBounds, regions: Option<Vec<window_manager::IslandBounds>>, expanded: bool) -> Result<(), String> {
    let regions=regions.unwrap_or_default();
    if !bounds.valid() || regions.len()>2 || regions.iter().any(|r|!r.valid()) { return Err("Invalid island bounds".into()); }
    let mut window = state.window_ctrl.state.lock().map_err(|_| "Window state lock poisoned")?;
    window.update_hit_geometry(bounds,regions,expanded);
    Ok(())
}

#[tauri::command]
fn set_island_pointer_pressed(state:State<'_,AppState>,pressed:bool)->Result<(),String>{
    state.window_ctrl.state.lock().map_err(|_|"Window state lock poisoned")?.owns_pointer_press=pressed;
    Ok(())
}

#[tauri::command]
async fn set_window_expanded(
    app: AppHandle,
    state: State<'_, AppState>,
    expanded: bool,
    custom_height: Option<u32>,
) -> Result<WindowGeometryResult, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    let settings = state.db.load_settings().unwrap_or_default();
    let res = apply_window_mode(
        &window,
        &state.window_ctrl,
        &state.db,
        expanded,
        &settings.pill_size,
        custom_height,
    )?;
    let _ = app.emit("isla://window-mode", &res);
    Ok(res)
}

#[tauri::command]
async fn start_interactive_drag(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    begin_interactive_drag(&window, &state.window_ctrl)
}

#[tauri::command]
async fn set_context_menu_open(
    app: AppHandle,
    state: State<'_, AppState>,
    open: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        set_context_menu_open_state(&window, &state.window_ctrl, open);
    }
    Ok(())
}

#[tauri::command]
async fn save_current_window_position(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(i32, i32), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;
    persist_current_window_position(&window, &state.window_ctrl, &state.db)
}

#[tauri::command]
async fn set_always_on_top(
    app: AppHandle,
    state: State<'_, AppState>,
    always_on_top: bool,
) -> Result<AppSettings, String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(always_on_top);
    }
    let mut settings = state.db.load_settings()?;
    settings.always_on_top = always_on_top;
    state.db.save_settings(&settings)
}

#[tauri::command]
fn minimize_to_tray_command(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_application(app: AppHandle, state: State<'_, AppState>) {
    state.is_quitting.store(true, Ordering::SeqCst);
    let _ = state.audio.send(AudioCommand::Pause);
    if let Some(window) = app.get_webview_window("main") {
        let _ = persist_current_window_position(&window, &state.window_ctrl, &state.db);
    }
    app.exit(0);
}

// --- Playback Commands ---

#[tauri::command]
fn get_player_snapshot(state: State<'_, AppState>) -> PlayerSnapshot {
    state.audio.get_snapshot()
}

#[tauri::command]
fn play_track(
    state: State<'_, AppState>,
    track_id: i64,
    queue_track_ids: Option<Vec<i64>>,
) -> Result<(), String> {
    let track = state
        .db
        .get_track_by_id(track_id)?
        .ok_or_else(|| "Track not found in library".to_string())?;

    let new_queue = if let Some(ids) = queue_track_ids {
        let all = state.db.get_all_tracks()?;
        let mut q = Vec::with_capacity(ids.len());
        for id in ids {
            if let Some(t) = all.iter().find(|t| t.id == id) {
                q.push(t.clone());
            }
        }
        if q.is_empty() {
            Some(vec![track.clone()])
        } else {
            Some(q)
        }
    } else {
        None
    };

    state.audio.send(AudioCommand::PlayTrack { track, new_queue })
}

#[tauri::command]
fn play_queue_index(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    state.audio.send(AudioCommand::PlayQueueIndex { index })
}

#[tauri::command]
fn toggle_play_pause(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::TogglePlayPause)
}

#[tauri::command]
fn play(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::Play)
}

#[tauri::command]
fn pause(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::Pause)
}

#[tauri::command]
fn stop(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::Stop)
}

#[tauri::command]
fn next_track(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::Next {
        user_initiated: true,
    })
}

#[tauri::command]
fn previous_track(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::Previous)
}

#[tauri::command]
fn seek_playback(state: State<'_, AppState>, position_secs: f64) -> Result<(), String> {
    state.audio.send(AudioCommand::Seek { position_secs })
}

#[tauri::command]
fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state.audio.send(AudioCommand::SetVolume { volume })
}

#[tauri::command]
fn toggle_mute(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::ToggleMute)
}

#[tauri::command]
fn set_shuffle(state: State<'_, AppState>, shuffle: bool) -> Result<(), String> {
    state.audio.send(AudioCommand::SetShuffle { shuffle })
}

#[tauri::command]
fn set_repeat_mode(state: State<'_, AppState>, mode: String) -> Result<(), String> {
    let repeat_mode = RepeatMode::from_str(&mode);
    state.audio.send(AudioCommand::SetRepeatMode { mode: repeat_mode })
}

#[tauri::command]
fn set_crossfade(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
    duration_secs: f32,
) -> Result<AppSettings, String> {
    let clamped = duration_secs.clamp(0.0, 15.0);
    let mut settings = state.db.load_settings().unwrap_or_default();
    settings.crossfade_enabled = enabled && clamped > 0.2;
    if clamped > 0.2 {
        settings.crossfade_secs = clamped;
    }
    let saved = state.db.save_settings(&settings)?;
    state.audio.send(AudioCommand::SetCrossfade {
        enabled: saved.crossfade_enabled,
        duration_secs: saved.crossfade_secs,
    })?;
    let _ = app.emit("isla://settings-updated", &saved);
    Ok(saved)
}

#[tauri::command]
fn set_queue(
    state: State<'_, AppState>,
    track_ids: Vec<i64>,
    start_index: Option<usize>,
    auto_play: bool,
) -> Result<(), String> {
    let all = state.db.get_all_tracks()?;
    let mut tracks = Vec::with_capacity(track_ids.len());
    for id in track_ids {
        if let Some(t) = all.iter().find(|t| t.id == id) {
            tracks.push(t.clone());
        }
    }
    state.audio.send(AudioCommand::SetQueue {
        tracks,
        start_index,
        auto_play,
    })
}

#[tauri::command]
fn add_to_queue(
    state: State<'_, AppState>,
    track_id: i64,
    play_next: bool,
) -> Result<(), String> {
    let track = state
        .db
        .get_track_by_id(track_id)?
        .ok_or_else(|| "Track not found".to_string())?;
    state.audio.send(AudioCommand::AddToQueue { track, play_next })
}

#[tauri::command]
fn remove_from_queue(state: State<'_, AppState>, index: usize) -> Result<(), String> {
    state.audio.send(AudioCommand::RemoveFromQueue { index })
}

#[tauri::command]
fn reorder_queue(
    state: State<'_, AppState>,
    from_index: usize,
    to_index: usize,
) -> Result<(), String> {
    state.audio.send(AudioCommand::ReorderQueue {
        from_index,
        to_index,
    })
}

#[tauri::command]
fn clear_queue(state: State<'_, AppState>) -> Result<(), String> {
    state.audio.send(AudioCommand::ClearQueue)
}

#[tauri::command]
async fn get_audio_output_devices() -> Result<Vec<AudioDeviceInfo>,String> {
    tauri::async_runtime::spawn_blocking(list_output_devices).await.map_err(|error| error.to_string())?
}

#[tauri::command]
fn set_audio_output_device(
    state: State<'_, AppState>,
    device_name: String,
) -> Result<AppSettings, String> {
    let mut settings = state.db.load_settings()?;
    settings.output_device = device_name.clone();
    let saved = state.db.save_settings(&settings)?;
    state.audio.send(AudioCommand::SetOutputDevice { device_name })?;
    Ok(saved)
}

// --- Library & Scanning Commands ---

#[tauri::command]
fn get_library_tracks(state: State<'_, AppState>) -> Result<Vec<Track>, String> {
    state.db.get_all_tracks()
}

#[tauri::command]
fn get_albums(state: State<'_, AppState>) -> Result<Vec<AlbumSummary>, String> {
    state.db.get_albums()
}

#[tauri::command]
fn get_artists(state: State<'_, AppState>) -> Result<Vec<ArtistSummary>, String> {
    state.db.get_artists()
}

#[tauri::command]
fn get_library_folders(state: State<'_, AppState>) -> Result<Vec<LibraryFolder>, String> {
    state.db.get_library_folders()
}

#[tauri::command]
fn get_library_stats(state: State<'_, AppState>) -> Result<LibraryStats, String> {
    state.db.get_library_stats()
}

#[tauri::command]
async fn add_and_scan_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<ScanSummary, String> {
    let path = PathBuf::from(&folder_path);
    if !path.is_dir() {
        return Err(format!("Selected folder does not exist: {folder_path}"));
    }

    let db = Arc::clone(&state.db);
    let audio = Arc::clone(&state.audio);
    let app_clone = app.clone();

    let summary = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_paths_into_db(&db, &[path], Some(&app_clone))
    })
    .await
    .map_err(|e| format!("Scan task failed: {e}"))??;

    // If queue was empty and tracks were imported, prime the queue with imported tracks
    let snap = audio.get_snapshot();
    if snap.queue.is_empty() {
        if let Ok(tracks) = state.db.get_all_tracks() {
            if !tracks.is_empty() {
                let _ = audio.send(AudioCommand::SetQueue {
                    tracks,
                    start_index: Some(0),
                    auto_play: false,
                });
            }
        }
    }

    Ok(summary)
}

#[tauri::command]
async fn import_dropped_paths(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
    auto_play: bool,
) -> Result<ScanSummary, String> {
    let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    if path_bufs.is_empty() {
        return Err("No paths provided".to_string());
    }

    let db = Arc::clone(&state.db);
    let audio = Arc::clone(&state.audio);
    let app_clone = app.clone();

    let summary = tauri::async_runtime::spawn_blocking(move || {
        scanner::scan_paths_into_db(&db, &path_bufs, Some(&app_clone))
    })
    .await
    .map_err(|e| format!("Drop import task failed: {e}"))??;

    if let Ok(all_tracks) = state.db.get_all_tracks() {
        if !all_tracks.is_empty() {
            let snap = audio.get_snapshot();
            if auto_play || snap.queue.is_empty() {
                let _ = audio.send(AudioCommand::SetQueue {
                    tracks: all_tracks,
                    start_index: Some(0),
                    auto_play,
                });
            }
        }
    }

    Ok(summary)
}

#[tauri::command]
async fn rescan_library(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ScanSummary, String> {
    let folders = state.db.get_library_folders()?;
    let paths: Vec<PathBuf> = folders.into_iter().map(|f| PathBuf::from(f.path)).collect();
    let db = Arc::clone(&state.db);
    let app_clone = app.clone();

    tauri::async_runtime::spawn_blocking(move || {
        if paths.is_empty() {
            let missing_marked = db.verify_missing_files().unwrap_or(0);
            let total_library_tracks = db.get_all_tracks().map(|t| t.len()).unwrap_or(0);
            Ok(ScanSummary {
                added_or_updated: 0,
                skipped_or_invalid: 0,
                missing_marked,
                total_library_tracks,
            })
        } else {
            scanner::scan_paths_into_db(&db, &paths, Some(&app_clone))
        }
    })
    .await
    .map_err(|e| format!("Rescan task failed: {e}"))?
}

#[tauri::command]
fn remove_library_folder(
    state: State<'_, AppState>,
    folder_id: i64,
    remove_tracks: bool,
) -> Result<Vec<LibraryFolder>, String> {
    state.db.remove_library_folder(folder_id, remove_tracks)?;
    state.db.get_library_folders()
}

#[tauri::command]
fn remove_missing_tracks(state: State<'_, AppState>) -> Result<usize, String> {
    state.db.remove_missing_tracks()
}

#[tauri::command]
fn toggle_favorite(state: State<'_, AppState>, track_id: i64) -> Result<Track, String> {
    state.db.toggle_favorite(track_id)?;
    let updated = state
        .db
        .get_track_by_id(track_id)?
        .ok_or_else(|| "Track not found".to_string())?;
    let _ = state.audio.send(AudioCommand::SyncTrackMetadata {
        track: updated.clone(),
    });
    Ok(updated)
}

// --- Playlist Commands ---

#[tauri::command]
fn get_playlists(state: State<'_, AppState>) -> Result<Vec<Playlist>, String> {
    state.db.get_playlists()
}

#[tauri::command]
fn get_playlist_detail(state: State<'_, AppState>, playlist_id: i64) -> Result<PlaylistDetail, String> {
    state.db.get_playlist_detail(playlist_id)
}

#[tauri::command]
fn create_playlist(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
) -> Result<Playlist, String> {
    state
        .db
        .create_playlist(&name, description.as_deref().unwrap_or(""))
}

#[tauri::command]
fn rename_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    name: String,
    description: Option<String>,
) -> Result<Playlist, String> {
    state.db.rename_playlist(
        playlist_id,
        &name,
        description.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
fn delete_playlist(state: State<'_, AppState>, playlist_id: i64) -> Result<Vec<Playlist>, String> {
    state.db.delete_playlist(playlist_id)?;
    state.db.get_playlists()
}

#[tauri::command]
fn add_track_to_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    track_id: i64,
) -> Result<PlaylistDetail, String> {
    state.db.add_track_to_playlist(playlist_id, track_id)
}

#[tauri::command]
fn remove_track_from_playlist(
    state: State<'_, AppState>,
    playlist_id: i64,
    position_index: usize,
) -> Result<PlaylistDetail, String> {
    state
        .db
        .remove_track_from_playlist(playlist_id, position_index)
}

#[tauri::command]
fn reorder_playlist_tracks(
    state: State<'_, AppState>,
    playlist_id: i64,
    from_index: usize,
    to_index: usize,
) -> Result<PlaylistDetail, String> {
    state
        .db
        .reorder_playlist_tracks(playlist_id, from_index, to_index)
}

// --- Settings Commands ---

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.db.load_settings()
}

#[tauri::command]
fn preview_equalizer(state: State<'_, AppState>, settings: equalizer::EqualizerSettings) -> Result<(), String> {
    state.audio.send(AudioCommand::SetEqualizer { settings: settings.sanitized() })
}

#[tauri::command]
fn save_equalizer(app: AppHandle, state: State<'_, AppState>, settings: equalizer::EqualizerSettings) -> Result<AppSettings, String> {
    let settings = settings.sanitized();
    let saved = state.db.update_equalizer(&settings)?;
    // Live preview already applied this value. A delayed save must not revert newer audio controls.
    let _ = app.emit("isla://settings-updated", &saved);
    Ok(saved)
}

#[tauri::command]
async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    mut settings: AppSettings,
) -> Result<AppSettings, String> {
    settings.equalizer = settings.equalizer.sanitized();
    let previous = state.db.load_settings().unwrap_or_default();
    // Equalizer changes use preview_equalizer/save_equalizer; other settings cannot revert live edits.
    settings.equalizer = previous.equalizer.clone();

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_always_on_top(settings.always_on_top);
        if previous.pill_size != settings.pill_size {
            let is_expanded = state.window_ctrl.is_expanded();
            if !is_expanded {
                let _ = apply_window_mode(
                    &window,
                    &state.window_ctrl,
                    &state.db,
                    false,
                    &settings.pill_size,
                    None,
                );
            }
        }
    }

    if previous.launch_at_startup != settings.launch_at_startup {
        let _ = set_windows_startup(settings.launch_at_startup);
    }

    if previous.output_device != settings.output_device {
        let _ = state.audio.send(AudioCommand::SetOutputDevice {
            device_name: settings.output_device.clone(),
        });
    }

    if previous.beat_pulse != settings.beat_pulse {
        state.audio.send(AudioCommand::SetBeatPulse { enabled: settings.beat_pulse })?;
    }

    if previous.crossfade_enabled != settings.crossfade_enabled
        || (previous.crossfade_secs - settings.crossfade_secs).abs() > 0.05
    {
        let _ = state.audio.send(AudioCommand::SetCrossfade {
            enabled: settings.crossfade_enabled,
            duration_secs: settings.crossfade_secs,
        });
    }

    if previous.global_shortcuts_enabled != settings.global_shortcuts_enabled {
        configure_global_shortcuts(&app, settings.global_shortcuts_enabled);
    }

    let saved = state.db.save_settings(&settings)?;
    let _ = app.emit("isla://settings-updated", &saved);
    Ok(saved)
}

fn configure_global_shortcuts(app: &AppHandle, enabled: bool) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !enabled {
        return;
    }

    let shortcuts = [
        Shortcut::new(None, Code::MediaPlayPause),
        Shortcut::new(None, Code::MediaTrackNext),
        Shortcut::new(None, Code::MediaTrackPrevious),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyP),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Period),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::Comma),
        Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyI),
    ];

    for sc in shortcuts {
        let _ = gs.register(sc);
    }
}

fn setup_system_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show_item = MenuItem::with_id(app, "show", "Show Isla", true, None::<&str>)?;
    let toggle_expand =
        MenuItem::with_id(app, "toggle_expand", "Expand / Collapse Pill", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let play_pause = MenuItem::with_id(app, "play_pause", "Play / Pause", true, None::<&str>)?;
    let next_item = MenuItem::with_id(app, "next", "Next Track", true, None::<&str>)?;
    let prev_item = MenuItem::with_id(app, "prev", "Previous Track", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let pin_item = MenuItem::with_id(app, "toggle_pin", "Toggle Always on Top", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit Isla", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &show_item,
            &toggle_expand,
            &sep1,
            &play_pause,
            &next_item,
            &prev_item,
            &sep2,
            &pin_item,
            &quit_item,
        ],
    )?;

    let mut tray_builder = TrayIconBuilder::with_id("isla-tray")
        .tooltip("Isla — Floating Music Player")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let state = app.state::<AppState>();
            match event.id.as_ref() {
                "show" => {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
                "toggle_expand" => {
                    let app_clone = app.clone();
                    tauri::async_runtime::spawn_blocking(move || {
                        let state = app_clone.state::<AppState>();
                        if let Some(w) = app_clone.get_webview_window("main") {
                            let _ = w.show();
                            let cur_expanded = state.window_ctrl.is_expanded();
                            let settings = state.db.load_settings().unwrap_or_default();
                            if let Ok(res) = apply_window_mode(
                                &w,
                                &state.window_ctrl,
                                &state.db,
                                !cur_expanded,
                                &settings.pill_size,
                                None,
                            ) {
                                let _ = app_clone.emit("isla://window-mode", &res);
                            }
                        }
                    });
                }
                "play_pause" => {
                    let _ = state.audio.send(AudioCommand::TogglePlayPause);
                }
                "next" => {
                    let _ = state.audio.send(AudioCommand::Next {
                        user_initiated: true,
                    });
                }
                "prev" => {
                    let _ = state.audio.send(AudioCommand::Previous);
                }
                "toggle_pin" => {
                    if let Ok(mut settings) = state.db.load_settings() {
                        settings.always_on_top = !settings.always_on_top;
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_always_on_top(settings.always_on_top);
                        }
                        if let Ok(saved) = state.db.save_settings(&settings) {
                            let _ = app.emit("isla://settings-updated", &saved);
                        }
                    }
                }
                "quit" => {
                    state.is_quitting.store(true, Ordering::SeqCst);
                    let _ = state.audio.send(AudioCommand::Pause);
                    if let Some(w) = app.get_webview_window("main") {
                        let _ =
                            persist_current_window_position(&w, &state.window_ctrl, &state.db);
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray_builder = tray_builder.icon(icon);
    }

    tray_builder.build(app)?;
    Ok(())
}

fn main() {
    let mut context = tauri::generate_context!();
    // Enlarged taskbars/docks need a real high-resolution source, not an upscaled system 32px icon.
    context.set_default_window_icon(Some(
        tauri::image::Image::from_bytes(include_bytes!("../icons/256x256.png"))
            .expect("Invalid embedded Isla application icon"),
    ));
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<AppState>();
                    if shortcut.key == Code::MediaPlayPause
                        || shortcut.key == Code::KeyP
                    {
                        let _ = state.audio.send(AudioCommand::TogglePlayPause);
                    } else if shortcut.key == Code::MediaTrackNext
                        || shortcut.key == Code::Period
                    {
                        let _ = state.audio.send(AudioCommand::Next {
                            user_initiated: true,
                        });
                    } else if shortcut.key == Code::MediaTrackPrevious
                        || shortcut.key == Code::Comma
                    {
                        let _ = state.audio.send(AudioCommand::Previous);
                    } else if shortcut.key == Code::KeyI {
                        let app_clone = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let state = app_clone.state::<AppState>();
                            if let Some(w) = app_clone.get_webview_window("main") {
                                let _ = w.show();
                                let cur_expanded = state.window_ctrl.is_expanded();
                                let settings = state.db.load_settings().unwrap_or_default();
                                if let Ok(res) = apply_window_mode(
                                    &w,
                                    &state.window_ctrl,
                                    &state.db,
                                    !cur_expanded,
                                    &settings.pill_size,
                                    None,
                                ) {
                                    let _ = app_clone.emit("isla://window-mode", &res);
                                }
                            }
                        });
                    }
                })
                .build(),
        )
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("isla_library.sqlite3");

            let db = Arc::new(Database::open(&db_path)?);
            let _ = db.verify_missing_files();

            let settings = db.load_settings().unwrap_or_default();
            let (restored_queue, restored_index, restored_pos) =
                db.load_queue_state().unwrap_or_else(|_| (Vec::new(), None, 0.0));

            let audio = Arc::new(AudioController::new(
                Arc::clone(&db),
                settings.default_volume,
                settings.default_shuffle,
                settings.default_repeat,
                settings.crossfade_enabled,
                settings.crossfade_secs,
                settings.output_device.clone(),
                restored_queue,
                restored_index,
                restored_pos,
                app.handle().clone(),
            ));

            let window_ctrl = Arc::new(WindowController::new(
                settings.start_expanded,
                settings.pill_size.clone(),
            ));
            let is_quitting = Arc::new(AtomicBool::new(false));

            if let Some(window) = app.get_webview_window("main") {
                restore_initial_window_bounds(&window, &window_ctrl, &db);
                spawn_window_interaction_loop(
                    app.handle().clone(),
                    window,
                    Arc::clone(&window_ctrl),
                    Arc::clone(&db),
                );
            }

            // Background BPM indexer for existing library tracks that don't have BPM yet
            {
                let db_for_bpm = Arc::clone(&db);
                let audio_for_bpm = Arc::clone(&audio);
                std::thread::Builder::new()
                    .name("isla-bpm-indexer".to_string())
                    .spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(600));
                        if let Ok(tracks) = db_for_bpm.get_all_tracks() {
                            for mut track in tracks {
                                if !track.file_missing {
                                    let path = std::path::Path::new(&track.file_path);
                                    if path.is_file() {
                                        if let Some((bpm, _)) =
                                            audio::analyze_track_bpm_and_beat(path, track.duration_secs)
                                        {
                                            if track.bpm.is_none() && db_for_bpm.update_track_bpm(track.id, bpm).is_ok() {
                                                track.bpm = Some(bpm);
                                                let _ = audio_for_bpm.send(
                                                    AudioCommand::SyncTrackMetadata { track },
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    })
                    .ok();
            }

            app.manage(AppState {
                db,
                audio,
                window_ctrl,
                is_quitting,
            });

            let _ = setup_system_tray(app.handle());
            configure_global_shortcuts(app.handle(), settings.global_shortcuts_enabled);

            Ok(())
        })
        .on_window_event(|window, event| {
            let app = window.app_handle();
            let state = app.state::<AppState>();

            if let WindowEvent::CloseRequested { api, .. } = event {
                if !state.is_quitting.load(Ordering::SeqCst) {
                    let minimize = state
                        .db
                        .load_settings()
                        .map(|s| s.minimize_to_tray)
                        .unwrap_or(true);
                    if minimize {
                        api.prevent_close();
                        let _ = window.hide();
                        return;
                    }
                }
                let _ = state.audio.send(AudioCommand::Pause);
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_app_state,
            set_island_bounds,
            set_island_pointer_pressed,
            set_window_expanded,
            start_interactive_drag,
            set_context_menu_open,
            save_current_window_position,
            set_always_on_top,
            minimize_to_tray_command,
            quit_application,
            get_player_snapshot,
            play_track,
            play_queue_index,
            toggle_play_pause,
            play,
            pause,
            stop,
            next_track,
            previous_track,
            seek_playback,
            set_volume,
            toggle_mute,
            set_shuffle,
            set_repeat_mode,
            set_crossfade,
            set_queue,
            add_to_queue,
            remove_from_queue,
            reorder_queue,
            clear_queue,
            get_audio_output_devices,
            set_audio_output_device,
            get_library_tracks,
            get_albums,
            get_artists,
            get_library_folders,
            get_library_stats,
            add_and_scan_folder,
            import_dropped_paths,
            rescan_library,
            remove_library_folder,
            remove_missing_tracks,
            toggle_favorite,
            get_playlists,
            get_playlist_detail,
            create_playlist,
            rename_playlist,
            delete_playlist,
            add_track_to_playlist,
            remove_track_from_playlist,
            reorder_playlist_tracks,
            get_settings,
            preview_equalizer,
            save_equalizer,
            update_settings,
        ])
        .run(context)
        .expect("Error while running Isla application");
}
