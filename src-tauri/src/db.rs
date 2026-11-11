use crate::models::{
    AlbumSummary, AppSettings, ArtistSummary, LibraryFolder, LibraryStats, Playlist,
    PlaylistDetail, RepeatMode, Track,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Database {
    conn: Mutex<Connection>,
}

pub fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn normalize_file_path(path: &Path) -> String {
    let raw = path.to_string_lossy().to_string();
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    stripped.replace('/', "\\").to_lowercase()
}

impl Database {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create DB dir: {e}"))?;
        }
        let conn = Connection::open(db_path).map_err(|e| format!("Failed to open SQLite DB: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             PRAGMA synchronous = NORMAL;",
        )
        .map_err(|e| format!("Failed to configure SQLite pragmas: {e}"))?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.run_migrations()?;
        Ok(db)
    }

    fn run_migrations(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL UNIQUE,
                normalized_path TEXT NOT NULL UNIQUE,
                last_scanned INTEGER
            );

            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                normalized_path TEXT NOT NULL UNIQUE,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT NOT NULL,
                album_artist TEXT NOT NULL DEFAULT '',
                genre TEXT NOT NULL DEFAULT '',
                track_number INTEGER,
                year INTEGER,
                duration_secs REAL NOT NULL DEFAULT 0,
                format TEXT NOT NULL DEFAULT 'MP3',
                bitrate_kbps INTEGER,
                sample_rate_hz INTEGER,
                file_size_bytes INTEGER NOT NULL DEFAULT 0,
                artwork_data_url TEXT,
                dominant_color TEXT,
                is_favorite INTEGER NOT NULL DEFAULT 0,
                play_count INTEGER NOT NULL DEFAULT 0,
                bpm REAL,
                date_added INTEGER NOT NULL,
                file_missing INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_tracks_favorite ON tracks(is_favorite);

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                position INTEGER NOT NULL,
                added_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist
                ON playlist_tracks(playlist_id, position);

            CREATE TABLE IF NOT EXISTS queue_items (
                position INTEGER PRIMARY KEY,
                track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );",
        )
        .map_err(|e| format!("Database migration failed: {e}"))?;

        conn.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            params![now_unix()],
        )
        .map_err(|e| format!("Failed to record schema version: {e}"))?;

        // Safe migration for existing databases created before play_count / bpm columns existed
        let _ = conn.execute(
            "ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0",
            [],
        );
        let _ = conn.execute("ALTER TABLE tracks ADD COLUMN bpm REAL", []);

        Ok(())
    }

    fn row_to_track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
        Ok(Track {
            id: row.get(0)?,
            file_path: row.get(1)?,
            normalized_path: row.get(2)?,
            title: row.get(3)?,
            artist: row.get(4)?,
            album: row.get(5)?,
            album_artist: row.get(6)?,
            genre: row.get(7)?,
            track_number: row.get(8)?,
            year: row.get(9)?,
            duration_secs: row.get(10)?,
            format: row.get(11)?,
            bitrate_kbps: row.get(12)?,
            sample_rate_hz: row.get(13)?,
            file_size_bytes: row.get::<_, i64>(14)?.max(0) as u64,
            artwork_data_url: row.get(15)?,
            dominant_color: row.get(16)?,
            is_favorite: row.get::<_, i64>(17)? != 0,
            date_added: row.get(18)?,
            file_missing: row.get::<_, i64>(19)? != 0,
            play_count: row.get::<_, i64>(20).unwrap_or(0).max(0) as u32,
            bpm: row.get::<_, Option<f64>>(21).unwrap_or(None).map(|v| v as f32),
        })
    }

    pub fn upsert_track(&self, track: &Track) -> Result<Track, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let now = now_unix();
        conn.execute(
            "INSERT INTO tracks (
                file_path, normalized_path, title, artist, album, album_artist, genre,
                track_number, year, duration_secs, format, bitrate_kbps, sample_rate_hz,
                file_size_bytes, artwork_data_url, dominant_color, is_favorite, date_added, file_missing, bpm
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13,
                ?14, ?15, ?16, ?17, ?18, 0, ?19
            )
            ON CONFLICT(normalized_path) DO UPDATE SET
                file_path = excluded.file_path,
                title = excluded.title,
                artist = excluded.artist,
                album = excluded.album,
                album_artist = excluded.album_artist,
                genre = excluded.genre,
                track_number = excluded.track_number,
                year = excluded.year,
                duration_secs = excluded.duration_secs,
                format = excluded.format,
                bitrate_kbps = excluded.bitrate_kbps,
                sample_rate_hz = excluded.sample_rate_hz,
                file_size_bytes = excluded.file_size_bytes,
                artwork_data_url = COALESCE(excluded.artwork_data_url, tracks.artwork_data_url),
                dominant_color = COALESCE(excluded.dominant_color, tracks.dominant_color),
                bpm = COALESCE(excluded.bpm, tracks.bpm),
                file_missing = 0",
            params![
                track.file_path,
                track.normalized_path,
                track.title,
                track.artist,
                track.album,
                track.album_artist,
                track.genre,
                track.track_number,
                track.year,
                track.duration_secs,
                track.format,
                track.bitrate_kbps,
                track.sample_rate_hz,
                track.file_size_bytes as i64,
                track.artwork_data_url,
                track.dominant_color,
                if track.is_favorite { 1 } else { 0 },
                if track.date_added > 0 { track.date_added } else { now },
                track.bpm.map(|b| b as f64),
            ],
        )
        .map_err(|e| format!("Failed to upsert track: {e}"))?;

        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, normalized_path, title, artist, album, album_artist, genre,
                        track_number, year, duration_secs, format, bitrate_kbps, sample_rate_hz,
                        file_size_bytes, artwork_data_url, dominant_color, is_favorite, date_added, file_missing, play_count, bpm
                 FROM tracks WHERE normalized_path = ?1",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![track.normalized_path], Self::row_to_track)
            .map_err(|e| format!("Failed to fetch upserted track: {e}"))
    }

    pub fn get_all_tracks(&self) -> Result<Vec<Track>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, normalized_path, title, artist, album, album_artist, genre,
                        track_number, year, duration_secs, format, bitrate_kbps, sample_rate_hz,
                        file_size_bytes, artwork_data_url, dominant_color, is_favorite, date_added, file_missing, play_count, bpm
                 FROM tracks
                 ORDER BY title COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], Self::row_to_track)
            .map_err(|e| e.to_string())?;

        let mut tracks = Vec::new();
        for r in rows {
            tracks.push(r.map_err(|e| e.to_string())?);
        }
        Ok(tracks)
    }

    pub fn get_track_by_id(&self, track_id: i64) -> Result<Option<Track>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT id, file_path, normalized_path, title, artist, album, album_artist, genre,
                        track_number, year, duration_secs, format, bitrate_kbps, sample_rate_hz,
                        file_size_bytes, artwork_data_url, dominant_color, is_favorite, date_added, file_missing, play_count, bpm
                 FROM tracks WHERE id = ?1",
            )
            .map_err(|e| e.to_string())?;

        stmt.query_row(params![track_id], Self::row_to_track)
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn update_track_bpm(&self, track_id: i64, bpm: f32) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "UPDATE tracks SET bpm = ?1 WHERE id = ?2",
            params![bpm as f64, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn increment_play_count(&self, track_id: i64) -> Result<u32, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "UPDATE tracks SET play_count = COALESCE(play_count, 0) + 1 WHERE id = ?1",
            params![track_id],
        )
        .map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row(
                "SELECT COALESCE(play_count, 0) FROM tracks WHERE id = ?1",
                params![track_id],
                |r| r.get(0),
            )
            .unwrap_or(1);
        Ok(count.max(0) as u32)
    }

    pub fn set_track_missing(&self, track_id: i64, missing: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "UPDATE tracks SET file_missing = ?1 WHERE id = ?2",
            params![if missing { 1 } else { 0 }, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn verify_missing_files(&self) -> Result<usize, String> {
        let tracks = self.get_all_tracks()?;
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut missing_count = 0usize;
        for t in tracks {
            let exists = PathBuf::from(&t.file_path).is_file();
            let missing = !exists;
            if missing {
                missing_count += 1;
            }
            if missing != t.file_missing {
                let _ = conn.execute(
                    "UPDATE tracks SET file_missing = ?1 WHERE id = ?2",
                    params![if missing { 1 } else { 0 }, t.id],
                );
            }
        }
        Ok(missing_count)
    }

    pub fn remove_missing_tracks(&self) -> Result<usize, String> {
        let _ = self.verify_missing_files()?;
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let deleted = conn
            .execute("DELETE FROM tracks WHERE file_missing = 1", [])
            .map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    pub fn toggle_favorite(&self, track_id: i64) -> Result<bool, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let current: i64 = conn
            .query_row(
                "SELECT is_favorite FROM tracks WHERE id = ?1",
                params![track_id],
                |r| r.get(0),
            )
            .map_err(|e| format!("Track not found: {e}"))?;
        let next = if current == 0 { 1 } else { 0 };
        conn.execute(
            "UPDATE tracks SET is_favorite = ?1 WHERE id = ?2",
            params![next, track_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(next != 0)
    }

    pub fn get_albums(&self) -> Result<Vec<AlbumSummary>, String> {
        let mut tracks = self.get_all_tracks()?;
        tracks.sort_by(|a, b| {
            a.album
                .to_lowercase()
                .cmp(&b.album.to_lowercase())
                .then_with(|| a.track_number.unwrap_or(999).cmp(&b.track_number.unwrap_or(999)))
                .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });

        let mut map: BTreeMap<String, AlbumSummary> = BTreeMap::new();
        for t in tracks {
            let key = t.album.trim().to_lowercase();
            let entry = map.entry(key).or_insert_with(|| AlbumSummary {
                name: t.album.clone(),
                artist: if !t.album_artist.trim().is_empty() {
                    t.album_artist.clone()
                } else {
                    t.artist.clone()
                },
                year: t.year,
                track_count: 0,
                total_duration_secs: 0.0,
                artwork_data_url: t.artwork_data_url.clone(),
                dominant_color: t.dominant_color.clone(),
                track_ids: Vec::new(),
            });
            entry.track_count += 1;
            entry.total_duration_secs += t.duration_secs;
            if entry.artwork_data_url.is_none() && t.artwork_data_url.is_some() {
                entry.artwork_data_url = t.artwork_data_url.clone();
                entry.dominant_color = t.dominant_color.clone();
            }
            if entry.year.is_none() && t.year.is_some() {
                entry.year = t.year;
            }
            entry.track_ids.push(t.id);
        }

        Ok(map.into_values().collect())
    }

    pub fn get_artists(&self) -> Result<Vec<ArtistSummary>, String> {
        let tracks = self.get_all_tracks()?;
        let mut map: BTreeMap<String, (ArtistSummary, HashSet<String>)> = BTreeMap::new();
        for t in tracks {
            let key = t.artist.trim().to_lowercase();
            let (entry, albums) = map.entry(key).or_insert_with(|| {
                (
                    ArtistSummary {
                        name: t.artist.clone(),
                        album_count: 0,
                        track_count: 0,
                        total_duration_secs: 0.0,
                        artwork_data_url: t.artwork_data_url.clone(),
                        track_ids: Vec::new(),
                    },
                    HashSet::new(),
                )
            });
            albums.insert(t.album.trim().to_lowercase());
            entry.album_count = albums.len();
            entry.track_count += 1;
            entry.total_duration_secs += t.duration_secs;
            if entry.artwork_data_url.is_none() && t.artwork_data_url.is_some() {
                entry.artwork_data_url = t.artwork_data_url.clone();
            }
            entry.track_ids.push(t.id);
        }

        Ok(map.into_values().map(|(a, _)| a).collect())
    }

    // --- Library Folders ---
    pub fn add_library_folder(&self, folder_path: &Path) -> Result<LibraryFolder, String> {
        let raw = folder_path.to_string_lossy().to_string();
        let norm = normalize_file_path(folder_path);
        let now = now_unix();
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "INSERT INTO library_folders (path, normalized_path, last_scanned)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(normalized_path) DO UPDATE SET
                path = excluded.path,
                last_scanned = excluded.last_scanned",
            params![raw, norm, now],
        )
        .map_err(|e| format!("Failed to save library folder: {e}"))?;

        drop(conn);
        let folders = self.get_library_folders()?;
        folders
            .into_iter()
            .find(|f| normalize_file_path(Path::new(&f.path)) == norm)
            .ok_or_else(|| "Failed to load saved folder".to_string())
    }

    pub fn remove_library_folder(&self, folder_id: i64, remove_tracks: bool) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let folder_norm: Option<String> = conn
            .query_row(
                "SELECT normalized_path FROM library_folders WHERE id = ?1",
                params![folder_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        conn.execute("DELETE FROM library_folders WHERE id = ?1", params![folder_id])
            .map_err(|e| e.to_string())?;

        if remove_tracks {
            if let Some(prefix) = folder_norm {
                let like_pattern = format!("{}\\%", prefix.trim_end_matches('\\'));
                conn.execute(
                    "DELETE FROM tracks WHERE normalized_path LIKE ?1",
                    params![like_pattern],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn get_library_folders(&self) -> Result<Vec<LibraryFolder>, String> {
        let tracks = self.get_all_tracks()?;
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare("SELECT id, path, normalized_path, last_scanned FROM library_folders ORDER BY path COLLATE NOCASE ASC")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut list = Vec::new();
        for r in rows {
            let (id, path, norm, last_scanned) = r.map_err(|e| e.to_string())?;
            let prefix = format!("{}\\", norm.trim_end_matches('\\'));
            let count = tracks
                .iter()
                .filter(|t| t.normalized_path.starts_with(&prefix))
                .count();
            list.push(LibraryFolder {
                id,
                path,
                track_count: count,
                last_scanned,
            });
        }
        Ok(list)
    }

    // --- Playlists ---
    pub fn get_playlists(&self) -> Result<Vec<Playlist>, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT p.id, p.name, p.description, p.created_at, p.updated_at,
                        COUNT(pt.track_id) as track_count,
                        COALESCE(SUM(t.duration_secs), 0.0) as total_duration,
                        (SELECT t2.artwork_data_url
                         FROM playlist_tracks pt2
                         JOIN tracks t2 ON t2.id = pt2.track_id
                         WHERE pt2.playlist_id = p.id AND t2.artwork_data_url IS NOT NULL
                         ORDER BY pt2.position ASC LIMIT 1) as cover_url
                 FROM playlists p
                 LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
                 LEFT JOIN tracks t ON t.id = pt.track_id
                 GROUP BY p.id
                 ORDER BY p.updated_at DESC, p.name COLLATE NOCASE ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Playlist {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                    track_count: row.get::<_, i64>(5)?.max(0) as usize,
                    total_duration_secs: row.get(6)?,
                    cover_data_url: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
        Ok(out)
    }

    pub fn get_playlist_detail(&self, playlist_id: i64) -> Result<PlaylistDetail, String> {
        let playlists = self.get_playlists()?;
        let playlist = playlists
            .into_iter()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| "Playlist not found".to_string())?;

        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.file_path, t.normalized_path, t.title, t.artist, t.album, t.album_artist, t.genre,
                        t.track_number, t.year, t.duration_secs, t.format, t.bitrate_kbps, t.sample_rate_hz,
                        t.file_size_bytes, t.artwork_data_url, t.dominant_color, t.is_favorite, t.date_added, t.file_missing, t.play_count, t.bpm
                 FROM playlist_tracks pt
                 JOIN tracks t ON t.id = pt.track_id
                 WHERE pt.playlist_id = ?1
                 ORDER BY pt.position ASC, pt.id ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![playlist_id], Self::row_to_track)
            .map_err(|e| e.to_string())?;

        let mut tracks = Vec::new();
        for r in rows {
            tracks.push(r.map_err(|e| e.to_string())?);
        }

        Ok(PlaylistDetail { playlist, tracks })
    }

    pub fn create_playlist(&self, name: &str, description: &str) -> Result<Playlist, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Playlist name cannot be empty".to_string());
        }
        let now = now_unix();
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![trimmed, description.trim(), now, now],
        )
        .map_err(|e| format!("Failed to create playlist: {e}"))?;
        let id = conn.last_insert_rowid();
        drop(conn);
        self.get_playlists()?
            .into_iter()
            .find(|p| p.id == id)
            .ok_or_else(|| "Created playlist not found".to_string())
    }

    pub fn rename_playlist(
        &self,
        playlist_id: i64,
        name: &str,
        description: &str,
    ) -> Result<Playlist, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Playlist name cannot be empty".to_string());
        }
        let now = now_unix();
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute(
            "UPDATE playlists SET name = ?1, description = ?2, updated_at = ?3 WHERE id = ?4",
            params![trimmed, description.trim(), now, playlist_id],
        )
        .map_err(|e| format!("Failed to rename playlist: {e}"))?;
        drop(conn);
        self.get_playlists()?
            .into_iter()
            .find(|p| p.id == playlist_id)
            .ok_or_else(|| "Playlist not found".to_string())
    }

    pub fn delete_playlist(&self, playlist_id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
            .map_err(|e| format!("Failed to delete playlist: {e}"))?;
        Ok(())
    }

    pub fn add_track_to_playlist(&self, playlist_id: i64, track_id: i64) -> Result<PlaylistDetail, String> {
        let now = now_unix();
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let max_pos: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = ?1",
                params![playlist_id],
                |r| r.get(0),
            )
            .unwrap_or(-1);

        conn.execute(
            "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![playlist_id, track_id, max_pos + 1, now],
        )
        .map_err(|e| format!("Failed to add track to playlist: {e}"))?;

        conn.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;
        drop(conn);
        self.get_playlist_detail(playlist_id)
    }

    pub fn remove_track_from_playlist(
        &self,
        playlist_id: i64,
        position_index: usize,
    ) -> Result<PlaylistDetail, String> {
        let detail = self.get_playlist_detail(playlist_id)?;
        let mut ids: Vec<i64> = detail.tracks.iter().map(|t| t.id).collect();
        if position_index < ids.len() {
            ids.remove(position_index);
        }
        self.replace_playlist_tracks(playlist_id, &ids)
    }

    pub fn reorder_playlist_tracks(
        &self,
        playlist_id: i64,
        from_index: usize,
        to_index: usize,
    ) -> Result<PlaylistDetail, String> {
        let detail = self.get_playlist_detail(playlist_id)?;
        let mut ids: Vec<i64> = detail.tracks.iter().map(|t| t.id).collect();
        if from_index >= ids.len() || to_index >= ids.len() {
            return Ok(detail);
        }
        let item = ids.remove(from_index);
        ids.insert(to_index, item);
        self.replace_playlist_tracks(playlist_id, &ids)
    }

    fn replace_playlist_tracks(
        &self,
        playlist_id: i64,
        track_ids: &[i64],
    ) -> Result<PlaylistDetail, String> {
        let now = now_unix();
        let mut conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|e| e.to_string())?;
        for (idx, tid) in track_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![playlist_id, tid, idx as i64, now],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "UPDATE playlists SET updated_at = ?1 WHERE id = ?2",
            params![now, playlist_id],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        self.get_playlist_detail(playlist_id)
    }

    // --- Queue Persistence ---
    pub fn save_queue_state(
        &self,
        track_ids: &[i64],
        current_index: Option<usize>,
        position_secs: f64,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM queue_items", [])
            .map_err(|e| e.to_string())?;
        for (pos, tid) in track_ids.iter().enumerate() {
            let _ = tx.execute(
                "INSERT INTO queue_items (position, track_id) VALUES (?1, ?2)",
                params![pos as i64, tid],
            );
        }
        let idx_str = current_index
            .map(|i| i.to_string())
            .unwrap_or_else(|| "none".to_string());
        tx.execute(
            "INSERT INTO settings (key, value) VALUES ('queue_current_index', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![idx_str],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO settings (key, value) VALUES ('queue_position_secs', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![format!("{position_secs:.3}")],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_queue_state(&self) -> Result<(Vec<Track>, Option<usize>, f64), String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT t.id, t.file_path, t.normalized_path, t.title, t.artist, t.album, t.album_artist, t.genre,
                        t.track_number, t.year, t.duration_secs, t.format, t.bitrate_kbps, t.sample_rate_hz,
                        t.file_size_bytes, t.artwork_data_url, t.dominant_color, t.is_favorite, t.date_added, t.file_missing, t.play_count, t.bpm
                 FROM queue_items q
                 JOIN tracks t ON t.id = q.track_id
                 ORDER BY q.position ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], Self::row_to_track)
            .map_err(|e| e.to_string())?;
        let mut tracks = Vec::new();
        for r in rows {
            tracks.push(r.map_err(|e| e.to_string())?);
        }

        let idx_str: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'queue_current_index'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let pos_str: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'queue_position_secs'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let current_index = idx_str
            .and_then(|s| s.parse::<usize>().ok())
            .filter(|&i| i < tracks.len());
        let position_secs = pos_str.and_then(|s| s.parse::<f64>().ok()).unwrap_or(0.0);

        Ok((tracks, current_index, position_secs))
    }

    // --- Library Statistics ---
    pub fn get_library_stats(&self) -> Result<LibraryStats, String> {
        let tracks = self.get_all_tracks()?;
        let albums = self.get_albums()?;
        let artists = self.get_artists()?;
        let playlists = self.get_playlists()?;
        let folders = self.get_library_folders()?;

        let total_favorites = tracks.iter().filter(|t| t.is_favorite).count();
        let total_duration_secs: f64 = tracks.iter().map(|t| t.duration_secs).sum();
        let total_size_bytes: u64 = tracks.iter().map(|t| t.file_size_bytes).sum();
        let missing_tracks = tracks.iter().filter(|t| t.file_missing).count();

        Ok(LibraryStats {
            total_tracks: tracks.len(),
            total_albums: albums.len(),
            total_artists: artists.len(),
            total_playlists: playlists.len(),
            total_favorites,
            total_duration_secs,
            total_size_bytes,
            missing_tracks,
            folder_count: folders.len(),
        })
    }

    // --- Settings Persistence ---
    pub fn load_settings(&self) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app_settings_json'",
                [],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        if let Some(json_str) = raw {
            if let Ok(parsed) = serde_json::from_str::<AppSettings>(&json_str) {
                return Ok(parsed);
            }
        }
        Ok(AppSettings::default())
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let mut settings = settings.clone();
        // EQ has its own realtime/persistence path. Appearance saves may carry an older EQ snapshot.
        let raw: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'app_settings_json'", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        if let Some(saved) = raw.and_then(|value| serde_json::from_str::<AppSettings>(&value).ok()) {
            settings.equalizer = saved.equalizer;
        }
        let json_str =
            serde_json::to_string(&settings).map_err(|e| format!("Serialize error: {e}"))?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app_settings_json', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![json_str],
        )
        .map_err(|e| format!("Failed to persist settings: {e}"))?;
        Ok(settings)
    }

    pub fn update_window_position(&self, x: i32, y: i32) -> Result<(), String> {
        self.patch_settings(|s| { s.window_x = Some(x); s.window_y = Some(y); })?;
        Ok(())
    }

    // Merge small updates while holding the connection lock so EQ/volume/position saves cannot overwrite each other.
    fn patch_settings(&self, patch: impl FnOnce(&mut AppSettings)) -> Result<AppSettings, String> {
        let conn = self.conn.lock().map_err(|_| "DB lock poisoned")?;
        let raw: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'app_settings_json'", [], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
        let mut settings: AppSettings = raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        patch(&mut settings);
        let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
        conn.execute("INSERT INTO settings (key,value) VALUES ('app_settings_json',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![json]).map_err(|e| e.to_string())?;
        Ok(settings)
    }

    pub fn update_equalizer(&self, value: &crate::equalizer::EqualizerSettings) -> Result<AppSettings, String> {
        self.patch_settings(|settings| settings.equalizer = value.sanitized())
    }

    pub fn update_playback_defaults(
        &self,
        volume: f32,
        shuffle: bool,
        repeat: RepeatMode,
    ) -> Result<(), String> {
        self.patch_settings(|settings| { settings.default_volume = volume; settings.default_shuffle = shuffle; settings.default_repeat = repeat; })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_sample_track(path: &str, title: &str, artist: &str, album: &str) -> Track {
        Track {
            id: 0,
            file_path: path.to_string(),
            normalized_path: normalize_file_path(Path::new(path)),
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.to_string(),
            album_artist: artist.to_string(),
            genre: "Pop".to_string(),
            track_number: Some(1),
            year: Some(2025),
            duration_secs: 215.5,
            format: "MP3".to_string(),
            bitrate_kbps: Some(320),
            sample_rate_hz: Some(44100),
            file_size_bytes: 5_400_000,
            artwork_data_url: None,
            dominant_color: Some("#5B7CFA".to_string()),
            is_favorite: false,
            play_count: 0,
            bpm: Some(120.0),
            date_added: 1700000000,
            file_missing: false,
        }
    }

    #[test]
    fn deduplicates_normalized_paths_and_manages_playlists() {
        let tmp_path = std::env::temp_dir().join(format!("isla_test_{}.sqlite3", now_unix()));
        let _ = std::fs::remove_file(&tmp_path);
        let db = Database::open(&tmp_path).expect("open db");

        let t1 = make_sample_track(r"D:\Music\Give A Little.mp3", "Give A Little", "Maggie Rogers", "Heard It In A Past Life");
        let saved1 = db.upsert_track(&t1).expect("insert track 1");
        assert!(saved1.id > 0);

        // Upsert same path with different casing and forward slashes -> must update in-place, not duplicate
        let t1_dup = make_sample_track("d:/music/give a little.mp3", "Give A Little (Remastered)", "Maggie Rogers", "Heard It In A Past Life");
        let saved1_dup = db.upsert_track(&t1_dup).expect("upsert duplicate");
        assert_eq!(saved1.id, saved1_dup.id);
        assert_eq!(saved1_dup.title, "Give A Little (Remastered)");

        let t2 = make_sample_track(r"D:\Music\Blue.mp3", "Blue", "Kamal.", "Single");
        let saved2 = db.upsert_track(&t2).expect("insert track 2");

        let all = db.get_all_tracks().expect("get all");
        assert_eq!(all.len(), 2);

        // Favorite toggle
        let fav = db.toggle_favorite(saved1.id).expect("toggle fav");
        assert!(fav);

        // Playlist creation, adding, reordering, removing
        let pl = db.create_playlist("Late Night Glass", "Floating vibes").expect("create playlist");
        db.add_track_to_playlist(pl.id, saved1.id).expect("add t1");
        let detail = db.add_track_to_playlist(pl.id, saved2.id).expect("add t2");
        assert_eq!(detail.tracks.len(), 2);
        assert_eq!(detail.tracks[0].id, saved1.id);
        assert_eq!(detail.tracks[1].id, saved2.id);

        let reordered = db.reorder_playlist_tracks(pl.id, 0, 1).expect("reorder");
        assert_eq!(reordered.tracks[0].id, saved2.id);
        assert_eq!(reordered.tracks[1].id, saved1.id);

        let after_remove = db.remove_track_from_playlist(pl.id, 0).expect("remove first");
        assert_eq!(after_remove.tracks.len(), 1);
        assert_eq!(after_remove.tracks[0].id, saved1.id);

        let _ = std::fs::remove_file(&tmp_path);
    }
}
