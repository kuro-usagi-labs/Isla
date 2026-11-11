use crate::db::Database;
use crate::models::WindowGeometryResult;
use std::sync::{Arc, Mutex};
use std::time::{Duration,Instant};
use tauri::{AppHandle, Emitter, LogicalSize, PhysicalPosition, PhysicalSize, WebviewWindow};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IslandBounds {
    pub x: f64, pub y: f64, pub width: f64, pub height: f64, pub radius: f64,
}

impl IslandBounds {
    pub fn valid(&self) -> bool {
        [self.x, self.y, self.width, self.height, self.radius].iter().all(|n| n.is_finite())
            && self.width > 0.0 && self.height > 0.0 && self.radius >= 0.0
            && self.x >= -32.0 && self.y >= -32.0
            && self.x + self.width <= CANVAS_LOGICAL_W as f64+32.0
            && self.y + self.height <= CANVAS_LOGICAL_H as f64+32.0
    }

    pub fn contains(&self, x: f64, y: f64) -> bool {
        if x < self.x || x > self.x + self.width || y < self.y || y > self.y + self.height { return false; }
        let r = self.radius.min(self.width / 2.0).min(self.height / 2.0);
        let nearest_x = x.clamp(self.x + r, self.x + self.width - r);
        let nearest_y = y.clamp(self.y + r, self.y + self.height - r);
        (x - nearest_x).powi(2) + (y - nearest_y).powi(2) <= r * r
    }
}

pub fn island_contains(bounds: &IslandBounds, regions: &[IslandBounds], x:f64, y:f64) -> bool {
    if regions.is_empty() { bounds.contains(x,y) } else { regions.iter().any(|region|region.contains(x,y)) }
}

fn ignore_cursor_for_pointer(inside: bool, already_ignoring: bool, button_down: bool) -> bool {
    // Once a press reaches Isla, retain its mouse-up even if pulse/press morphs
    // move the visual boundary underneath the stationary pointer.
    !inside && (already_ignoring || !button_down)
}

#[derive(Debug, Clone, Copy)]
pub struct MonitorRect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Clone, Copy)]
pub struct DragSession {
    pub start_cursor_x: i32,
    pub start_cursor_y: i32,
    pub start_pill_x: i32,
    pub start_pill_y: i32,
    pub start_win_x: i32,
    pub start_win_y: i32,
    pub dragging_expanded: bool,
}

pub struct WindowStateMemory {
    pub island_bounds: Option<IslandBounds>,
    pub island_regions: Vec<IslandBounds>,
    pub expanded: bool,
    pub pill_size: String,
    /// Physical screen coordinate of the pill frame's top-left (including shadow gutter)
    pub pill_phys_x: i32,
    pub pill_phys_y: i32,
    /// Physical screen coordinate of the native canvas window
    pub win_phys_x: i32,
    pub win_phys_y: i32,
    /// Logical offset of the pill inside the 412×388 content area.
    pub anchor_offset_x: i32,
    pub anchor_offset_y: i32,
    pub ignoring_cursor: bool,
    pub context_menu_open: bool,
    pub drag_session: Option<DragSession>,
}

pub struct WindowController {
    pub state: Mutex<WindowStateMemory>,
}

impl WindowController {
    pub fn new(start_expanded: bool, pill_size: String) -> Self {
        Self {
            state: Mutex::new(WindowStateMemory {
                island_bounds: None,
                island_regions: Vec::new(),
                expanded: start_expanded,
                pill_size,
                pill_phys_x: 96,
                pill_phys_y: 72,
                win_phys_x: 96,
                win_phys_y: 72,
                anchor_offset_x: 88,
                anchor_offset_y: 0,
                ignoring_cursor: false,
                context_menu_open: false,
                drag_session: None,
            }),
        }
    }

    pub fn is_expanded(&self) -> bool {
        self.state.try_lock().map(|s| s.expanded).unwrap_or(false)
    }

    pub fn get_anchor_offsets(&self) -> (i32, i32) {
        self.state
            .try_lock()
            .map(|s| (s.anchor_offset_x, s.anchor_offset_y))
            .unwrap_or((88, 0))
    }

    fn drag_monitor_snapshot(&self, query: impl FnOnce() -> Vec<MonitorRect>) -> Option<Vec<MonitorRect>> {
        let dragging = { self.state.lock().ok()?.drag_session.is_some() };
        // Tauri monitor getters synchronously wait for the UI thread. Never retain this guard.
        dragging.then(query)
    }
}

pub const SHADOW_GUTTER: i32 = 48;
pub const CANVAS_LOGICAL_W: i32 = CARD_LOGICAL_W+SHADOW_GUTTER*2;
pub const CANVAS_LOGICAL_H: i32 = CARD_LOGICAL_H+SHADOW_GUTTER*2;
pub const CARD_LOGICAL_W: i32 = 412;
pub const CARD_LOGICAL_H: i32 = 388;

pub fn get_pill_card_dimensions(pill_size: &str) -> (i32, i32) {
    match pill_size {
        "compact" => (60, 60),
        "large" => (292, 62),
        _ => (260, 58),
    }
}

fn expanded_pill_anchor_x(pill_size: &str, near_left: bool, near_right: bool) -> i32 {
    let max_offset=CARD_LOGICAL_W-get_pill_card_dimensions(pill_size).0;
    if near_left {0} else if near_right {max_offset} else if pill_size=="compact" {0} else {max_offset/2}
}

/// Clamps a window rectangle (x, y, width, height) inside the best-matching monitor bounds.
/// Supports negative coordinates on multi-monitor setups (monitors left/above primary).
pub fn clamp_to_monitors(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    monitors: &[MonitorRect],
    margin: i32,
) -> (i32, i32) {
    if monitors.is_empty() {
        return (x, y);
    }

    let target = find_target_monitor(x, y, width, height, monitors);

    let min_x = target.x + margin;
    let max_x = (target.x + target.width - width - margin).max(min_x);
    let min_y = target.y + margin;
    let max_y = (target.y + target.height - height - margin).max(min_y);

    (x.clamp(min_x, max_x), y.clamp(min_y, max_y))
}

fn find_target_monitor(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    monitors: &[MonitorRect],
) -> MonitorRect {
    let center_x = x + width / 2;
    let center_y = y + height / 2;

    monitors
        .iter()
        .copied()
        .find(|m| {
            center_x >= m.x
                && center_x < m.x + m.width
                && center_y >= m.y
                && center_y < m.y + m.height
        })
        .unwrap_or_else(|| {
            monitors
                .iter()
                .copied()
                .min_by_key(|m| {
                    let mx = m.x + m.width / 2;
                    let my = m.y + m.height / 2;
                    let dx = (center_x - mx) as i64;
                    let dy = (center_y - my) as i64;
                    dx * dx + dy * dy
                })
                .unwrap_or(MonitorRect {
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                })
        })
}

/// Given a desired physical pill position `(raw_pill_x, raw_pill_y)`, computes:
/// 1. Clamped physical pill position `(pill_x, pill_y)` so the pill never leaves the monitor.
/// 2. Clamped native canvas position `(win_x, win_y)` so the expanded player never leaves the monitor.
/// 3. Logical CSS offsets `(anchor_offset_x, anchor_offset_y)` of the pill inside the content area
///    so the pill's screen position is `win_pos + anchor_offset` and expanding grows dynamically
///    away from whichever screen edge/corner the pill is near!
pub fn compute_canvas_and_anchor_for_pill(
    raw_pill_x: i32,
    raw_pill_y: i32,
    scale: f64,
    pill_size: &str,
    monitors: &[MonitorRect],
) -> (i32, i32, i32, i32, i32, i32) {
    let (pill_card_w, pill_card_h) = get_pill_card_dimensions(pill_size);
    let pill_win_logical_w = pill_card_w + SHADOW_GUTTER*2;
    let pill_win_logical_h = pill_card_h + SHADOW_GUTTER*2;

    let pill_phys_w = ((pill_win_logical_w as f64) * scale).round() as i32;
    let pill_phys_h = ((pill_win_logical_h as f64) * scale).round() as i32;

    let exp_phys_w = ((CANVAS_LOGICAL_W as f64) * scale).round() as i32;
    let exp_phys_h = ((CANVAS_LOGICAL_H as f64) * scale).round() as i32;

    let (pill_x, pill_y) = clamp_to_monitors(
        raw_pill_x,
        raw_pill_y,
        pill_phys_w,
        pill_phys_h,
        monitors,
        6,
    );

    let max_offset_x = (CARD_LOGICAL_W - pill_card_w).max(0);
    let max_offset_y = (CARD_LOGICAL_H - pill_card_h).max(0);
    let default_center_offset_x = max_offset_x / 2;
    let default_center_phys_x = ((default_center_offset_x as f64) * scale).round() as i32;
    let max_offset_phys_y = ((max_offset_y as f64) * scale).round() as i32;

    let target_mon = find_target_monitor(pill_x, pill_y, pill_phys_w, pill_phys_h, monitors);
    let margin = 8;

    // Strict Top-or-Bottom Vertical Anchoring:
    // - If there is room below the pill (`pill_y + exp_phys_h <= target_mon.bottom - margin`),
    //   anchor the pill at the TOP of the canvas (`anchor_offset_y = 0`) so it expands 100% DOWNWARD.
    // - If the pill is near the bottom of the screen, align the BOTTOM of the canvas with the
    //   BOTTOM of the pill (`desired_win_y = pill_y - max_offset_phys_y`, `anchor_offset_y = max_offset_y`)
    //   so the pill's bottom edge stays 100% locked and it expands 100% UPWARD!
    let expand_upward = pill_y + exp_phys_h > target_mon.y + target_mon.height - margin;

    // Compact's metadata satellite needs one uninterrupted side of the canvas.
    // Move only the invisible canvas; keep the artwork's screen position fixed.
    let desired_win_x = if pill_size == "compact" {
        if pill_x + exp_phys_w <= target_mon.x + target_mon.width - margin {
            pill_x
        } else {
            pill_x - ((max_offset_x as f64)*scale).round() as i32
        }
    } else { pill_x - default_center_phys_x };
    let desired_win_y = if expand_upward {
        pill_y - max_offset_phys_y
    } else {
        pill_y
    };

    let (win_x, win_y) = clamp_to_monitors(
        desired_win_x,
        desired_win_y,
        exp_phys_w,
        exp_phys_h,
        monitors,
        margin,
    );

    let anchor_offset_x = (((pill_x - win_x) as f64) / scale)
        .round()
        .clamp(0.0, max_offset_x as f64) as i32;
    let anchor_offset_y = if expand_upward { max_offset_y } else { 0 };

    (
        pill_x,
        pill_y,
        win_x,
        win_y,
        anchor_offset_x,
        anchor_offset_y,
    )
}

fn collect_monitor_rects(window: &WebviewWindow) -> Vec<MonitorRect> {
    let mut rects = Vec::new();
    if let Ok(monitors) = window.available_monitors() {
        for m in monitors {
            let pos = m.position();
            let size = m.size();
            rects.push(MonitorRect {
                x: pos.x,
                y: pos.y,
                width: size.width as i32,
                height: size.height as i32,
            });
        }
    }
    if rects.is_empty() {
        if let Ok(Some(m)) = window.current_monitor() {
            let pos = m.position();
            let size = m.size();
            rects.push(MonitorRect {
                x: pos.x,
                y: pos.y,
                width: size.width as i32,
                height: size.height as i32,
            });
        }
    }
    rects
}

#[cfg(target_os = "windows")]
fn set_window_rect_atomic(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hWnd: isize,
            hWndInsertAfter: isize,
            X: i32,
            Y: i32,
            cx: i32,
            cy: i32,
            uFlags: u32,
        ) -> i32;
    }
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;

    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowPos(
                hwnd.0 as isize,
                0,
                x,
                y,
                width,
                height,
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
    } else {
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(width as u32, height as u32));
    }
}

#[cfg(not(target_os = "windows"))]
fn set_window_rect_atomic(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) {
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.set_size(PhysicalSize::new(width as u32, height as u32));
}

#[cfg(target_os = "windows")]
fn get_cursor_pos_win32() -> Option<(i32, i32)> {
    #[repr(C)]
    struct POINT {
        x: i32,
        y: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn GetCursorPos(lpPoint: *mut POINT) -> i32;
    }
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok != 0 {
        Some((pt.x, pt.y))
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
fn get_cursor_pos_win32() -> Option<(i32, i32)> {
    None
}

#[cfg(target_os = "windows")]
fn is_left_mouse_button_down() -> bool {
    #[link(name = "user32")]
    extern "system" {
        fn GetAsyncKeyState(vKey: i32) -> i16;
    }
    const VK_LBUTTON: i32 = 0x01;
    unsafe { (GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0 }
}

#[cfg(not(target_os = "windows"))]
fn is_left_mouse_button_down() -> bool {
    false
}

pub fn apply_window_mode(
    window: &WebviewWindow,
    controller: &WindowController,
    _db: &Database,
    expanded: bool,
    pill_size: &str,
    _custom_expanded_height: Option<u32>,
) -> Result<WindowGeometryResult, String> {
    let (win_x, win_y, anchor_x, anchor_y) = {
        let mut state = controller
            .state
            .lock()
            .map_err(|_| "Window state lock poisoned")?;
        state.expanded = expanded;
        state.pill_size = pill_size.to_string();
        if expanded {
            state.ignoring_cursor = false;
        }
        (
            state.win_phys_x,
            state.win_phys_y,
            state.anchor_offset_x,
            state.anchor_offset_y,
        )
    };

    if expanded {
        let _ = window.set_ignore_cursor_events(false);
    }

    Ok(WindowGeometryResult {
        expanded,
        x: win_x,
        y: win_y,
        width: CANVAS_LOGICAL_W as u32,
        height: CANVAS_LOGICAL_H as u32,
        anchor_offset_x: anchor_x,
        anchor_offset_y: anchor_y,
        is_dragging: false,
    })
}

pub fn set_context_menu_open_state(
    window: &WebviewWindow,
    controller: &WindowController,
    open: bool,
) {
    if let Ok(mut state) = controller.state.lock() {
        state.context_menu_open = open;
        if open {
            state.ignoring_cursor = false;
        }
    }
    if open {
        let _ = window.set_ignore_cursor_events(false);
    }
}

pub fn begin_interactive_drag(
    window: &WebviewWindow,
    controller: &WindowController,
) -> Result<(), String> {
    let Some((cx, cy)) = get_cursor_pos_win32() else {
        let _ = window.start_dragging();
        return Ok(());
    };

    let _ = window.set_ignore_cursor_events(false);

    let geometry = if let Ok(mut state) = controller.state.lock() {
        state.ignoring_cursor = false;
        state.drag_session = Some(DragSession {
            start_cursor_x: cx,
            start_cursor_y: cy,
            start_pill_x: state.pill_phys_x,
            start_pill_y: state.pill_phys_y,
            start_win_x: state.win_phys_x,
            start_win_y: state.win_phys_y,
            dragging_expanded: state.expanded,
        });
        Some(WindowGeometryResult {
            expanded: state.expanded, x: state.win_phys_x, y: state.win_phys_y,
            width: CANVAS_LOGICAL_W as u32, height: CANVAS_LOGICAL_H as u32,
            anchor_offset_x: state.anchor_offset_x, anchor_offset_y: state.anchor_offset_y, is_dragging: true,
        })
    } else { None };
    if let Some(geometry) = geometry { let _ = window.emit("isla://window-mode", geometry); }
    Ok(())
}

pub fn spawn_window_interaction_loop(
    app: AppHandle,
    window: WebviewWindow,
    controller: Arc<WindowController>,
    db: Arc<Database>,
) {
    std::thread::spawn(move || {
        // OS/window requests happen outside the state mutex. Bounds IPC can acquire it at any time.
        let mut monitors = collect_monitor_rects(&window);
        let mut last_monitor_refresh = Instant::now();
        let mut was_dragging = false;
        loop {
            let scale = window.scale_factor().unwrap_or(1.0);
            let cursor = get_cursor_pos_win32();
            let lbutton_down = is_left_mouse_button_down();
            let dragging = controller.state.try_lock().map(|state| state.drag_session.is_some()).unwrap_or(false);
            if dragging && (!was_dragging || last_monitor_refresh.elapsed() >= Duration::from_millis(250)) {
                if let Some(fresh) = controller.drag_monitor_snapshot(|| collect_monitor_rects(&window)) {
                    if !fresh.is_empty() { monitors = fresh; }
                }
                last_monitor_refresh = Instant::now();
            }
            was_dragging = dragging;

            let mut sleep_ms = 12u64;
            let mut move_win_to: Option<(i32, i32, i32, i32)> = None;
            let mut emit_geom: Option<WindowGeometryResult> = None;
            let mut save_pill_pos: Option<(i32, i32)> = None;
            let mut toggle_ignore_cursor: Option<bool> = None;

            if let Ok(mut state) = controller.state.lock() {
                if let Some(session) = state.drag_session {
                    sleep_ms = 8; // ~144Hz tracking during active drag
                    if !lbutton_down {
                        // Mouse button released -> finish drag session
                        state.drag_session = None;
                        save_pill_pos = Some((state.pill_phys_x, state.pill_phys_y));
                        emit_geom = Some(WindowGeometryResult {
                            expanded: state.expanded,
                            x: state.win_phys_x,
                            y: state.win_phys_y,
                            width: CANVAS_LOGICAL_W as u32,
                            height: CANVAS_LOGICAL_H as u32,
                            anchor_offset_x: state.anchor_offset_x,
                            anchor_offset_y: state.anchor_offset_y,
                            is_dragging: false,
                        });
                    } else if let Some((cx, cy)) = cursor {
                        let dx = cx - session.start_cursor_x;
                        let dy = cy - session.start_cursor_y;
                        let exp_phys_w = ((CANVAS_LOGICAL_W as f64) * scale).round() as i32;
                        let exp_phys_h = ((CANVAS_LOGICAL_H as f64) * scale).round() as i32;

                        if !session.dragging_expanded {
                            // Dragging the Compact Pill
                            let desired_pill_x = session.start_pill_x + dx;
                            let desired_pill_y = session.start_pill_y + dy;
                            let (pill_x, pill_y, win_x, win_y, off_x, off_y) =
                                compute_canvas_and_anchor_for_pill(
                                    desired_pill_x,
                                    desired_pill_y,
                                    scale,
                                    &state.pill_size,
                                    &monitors,
                                );

                            let win_changed =
                                win_x != state.win_phys_x || win_y != state.win_phys_y;
                            let off_changed =
                                off_x != state.anchor_offset_x || off_y != state.anchor_offset_y;

                            state.pill_phys_x = pill_x;
                            state.pill_phys_y = pill_y;
                            state.win_phys_x = win_x;
                            state.win_phys_y = win_y;
                            state.anchor_offset_x = off_x;
                            state.anchor_offset_y = off_y;

                            if win_changed {
                                move_win_to = Some((win_x, win_y, exp_phys_w, exp_phys_h));
                            }
                            if off_changed {
                                emit_geom = Some(WindowGeometryResult {
                                    expanded: state.expanded,
                                    x: win_x,
                                    y: win_y,
                                    width: CANVAS_LOGICAL_W as u32,
                                    height: CANVAS_LOGICAL_H as u32,
                                    anchor_offset_x: off_x,
                                    anchor_offset_y: off_y,
                                    is_dragging: true,
                                });
                            }
                        } else {
                            // Dragging the Expanded Player
                            let raw_win_x = session.start_win_x + dx;
                            let raw_win_y = session.start_win_y + dy;
                            let (win_x, win_y) = clamp_to_monitors(
                                raw_win_x,
                                raw_win_y,
                                exp_phys_w,
                                exp_phys_h,
                                &monitors,
                                8,
                            );

                            let mon = find_target_monitor(
                                win_x,
                                win_y,
                                exp_phys_w,
                                exp_phys_h,
                                &monitors,
                            );
                            let (_, pill_card_h) =
                                get_pill_card_dimensions(&state.pill_size);
                            let max_off_y = (CARD_LOGICAL_H - pill_card_h).max(0);

                            // Smart edge awareness when dragging expanded panel:
                            // - Near bottom of screen -> anchor pill at bottom
                            // - Near top/middle of screen -> anchor pill at top
                            let near_bottom =
                                win_y + exp_phys_h >= mon.y + mon.height - (64.0 * scale) as i32;
                            let near_left = win_x <= mon.x + (40.0 * scale) as i32;
                            let near_right =
                                win_x + exp_phys_w >= mon.x + mon.width - (40.0 * scale) as i32;

                            let off_y = if near_bottom { max_off_y } else { 0 };
                            let off_x = expanded_pill_anchor_x(&state.pill_size,near_left,near_right);

                            let win_changed =
                                win_x != state.win_phys_x || win_y != state.win_phys_y;
                            let off_changed =
                                off_x != state.anchor_offset_x || off_y != state.anchor_offset_y;

                            state.win_phys_x = win_x;
                            state.win_phys_y = win_y;
                            state.anchor_offset_x = off_x;
                            state.anchor_offset_y = off_y;
                            state.pill_phys_x =
                                win_x + ((off_x as f64) * scale).round() as i32;
                            state.pill_phys_y =
                                win_y + ((off_y as f64) * scale).round() as i32;

                            if win_changed {
                                move_win_to = Some((win_x, win_y, exp_phys_w, exp_phys_h));
                            }
                            if off_changed {
                                emit_geom = Some(WindowGeometryResult {
                                    expanded: state.expanded,
                                    x: win_x,
                                    y: win_y,
                                    width: CANVAS_LOGICAL_W as u32,
                                    height: CANVAS_LOGICAL_H as u32,
                                    anchor_offset_x: off_x,
                                    anchor_offset_y: off_y,
                                    is_dragging: true,
                                });
                            }
                        }
                    }
                } else {
                    // Not dragging: manage dynamic click-through when in Compact Pill mode
                    if state.context_menu_open {
                        if state.ignoring_cursor {
                            state.ignoring_cursor = false;
                            toggle_ignore_cursor = Some(false);
                        }
                    } else if let Some((cx, cy)) = cursor {
                        let (w, h) = get_pill_card_dimensions(&state.pill_size);
                        let bounds = state.island_bounds.unwrap_or(IslandBounds {
                            x: SHADOW_GUTTER as f64 + if state.expanded { 0.0 } else { state.anchor_offset_x as f64 },
                            y: SHADOW_GUTTER as f64 + if state.expanded { 0.0 } else { state.anchor_offset_y as f64 },
                            width: if state.expanded { 412.0 } else { w as f64 },
                            height: if state.expanded { 388.0 } else { h as f64 },
                            radius: if state.expanded { 26.0 } else { h as f64 / 2.0 },
                        });
                        let local_x = (cx - state.win_phys_x) as f64 / scale;
                        let local_y = (cy - state.win_phys_y) as f64 / scale;
                        let should_ignore = ignore_cursor_for_pointer(island_contains(&bounds,&state.island_regions,local_x,local_y),state.ignoring_cursor,lbutton_down);
                        if should_ignore != state.ignoring_cursor {
                            state.ignoring_cursor = should_ignore;
                            toggle_ignore_cursor = Some(should_ignore);
                        }
                    }
                }
            }

            // Perform Win32 / Tauri calls outside the mutex lock
            if let Some(ignore) = toggle_ignore_cursor {
                let _ = window.set_ignore_cursor_events(ignore);
            }
            if let Some((wx, wy, ww, wh)) = move_win_to {
                set_window_rect_atomic(&window, wx, wy, ww, wh);
            }
            if let Some((px, py)) = save_pill_pos {
                let _ = db.update_window_position(px, py);
            }
            if let Some(geom) = emit_geom {
                let _ = app.emit("isla://window-mode", &geom);
            }

            std::thread::sleep(Duration::from_millis(sleep_ms));
        }
    });
}

pub fn restore_initial_window_bounds(
    window: &WebviewWindow,
    controller: &WindowController,
    db: &Database,
) {
    if let Ok(settings) = db.load_settings() {
        let _ = window.set_always_on_top(settings.always_on_top);
        let scale = window.scale_factor().unwrap_or(1.0);
        let exp_phys_w = ((CANVAS_LOGICAL_W as f64) * scale).round() as i32;
        let exp_phys_h = ((CANVAS_LOGICAL_H as f64) * scale).round() as i32;

        let monitors = collect_monitor_rects(window);
        let (pill_card_w, _) = get_pill_card_dimensions(&settings.pill_size);
        let pill_win_phys_w = (((pill_card_w + SHADOW_GUTTER*2) as f64) * scale).round() as i32;

        let (raw_pill_x, raw_pill_y) = if settings.remember_position {
            (
                settings.window_x.unwrap_or(96),
                settings.window_y.unwrap_or(72),
            )
        } else if let Some(first) = monitors.first() {
            (first.x + first.width - pill_win_phys_w - 48, first.y + 48)
        } else {
            (96, 72)
        };

        let (pill_x, pill_y, win_x, win_y, off_x, off_y) = compute_canvas_and_anchor_for_pill(
            raw_pill_x,
            raw_pill_y,
            scale,
            &settings.pill_size,
            &monitors,
        );

        let _ = window.set_size(LogicalSize::new(
            CANVAS_LOGICAL_W as f64,
            CANVAS_LOGICAL_H as f64,
        ));
        set_window_rect_atomic(window, win_x, win_y, exp_phys_w, exp_phys_h);

        if let Ok(mut st) = controller.state.lock() {
            st.expanded = settings.start_expanded;
            st.pill_size = settings.pill_size.clone();
            st.pill_phys_x = pill_x;
            st.pill_phys_y = pill_y;
            st.win_phys_x = win_x;
            st.win_phys_y = win_y;
            st.anchor_offset_x = off_x;
            st.anchor_offset_y = off_y;
        }
    }
}

pub fn persist_current_window_position(
    _window: &WebviewWindow,
    controller: &WindowController,
    db: &Database,
) -> Result<(i32, i32), String> {
    let (px, py) = if let Ok(st) = controller.state.lock() {
        (st.pill_phys_x, st.pill_phys_y)
    } else {
        (96, 72)
    };
    db.update_window_position(px, py)?;
    Ok((px, py))
}

#[cfg(target_os = "windows")]
pub fn set_windows_startup(enabled: bool) -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
        .map_err(|e| format!("Failed to open startup registry key: {e}"))?;

    if enabled {
        let exe_path =
            std::env::current_exe().map_err(|e| format!("Cannot resolve current exe: {e}"))?;
        let quoted = format!("\"{}\"", exe_path.to_string_lossy());
        key.set_value("IslaMusicPlayer", &quoted)
            .map_err(|e| format!("Failed to register startup entry: {e}"))?;
    } else {
        let _ = key.delete_value("IslaMusicPlayer");
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set_windows_startup(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_active_press_keeps_its_release_during_a_pulse() {
        assert!(!ignore_cursor_for_pointer(false,false,true));
        assert!(ignore_cursor_for_pointer(false,false,false));
        assert!(ignore_cursor_for_pointer(false,true,true));
        assert!(!ignore_cursor_for_pointer(true,true,true));
    }

    #[test]
    fn monitor_query_can_reenter_window_state_without_blocking_ui() {
        for expanded in [false,true] {
            let controller = WindowController::new(expanded,"default".into());
            controller.state.lock().unwrap().drag_session = Some(DragSession {
                start_cursor_x: 0,start_cursor_y: 0,start_pill_x: 0,start_pill_y: 0,
                start_win_x: 0,start_win_y: 0,dragging_expanded: expanded,
            });
            let monitors = controller.drag_monitor_snapshot(|| {
                // A Tauri monitor getter waits for the UI, which can receive a bounds IPC first.
                let mut ui_state = controller.state.try_lock().expect("monitor query holds window state: UI bounds command would deadlock");
                ui_state.island_bounds = Some(IslandBounds {x:48.0,y:48.0,width:260.0,height:58.0,radius:29.0});
                vec![MonitorRect {x:0,y:0,width:1920,height:1080}]
            }).unwrap();
            assert_eq!(monitors.len(),1);
        }
    }

    #[test]
    fn animated_island_hit_test_excludes_transparent_corners_and_shadow() {
        let bounds = IslandBounds { x: 50.0, y: 20.0, width: 344.0, height: 68.0, radius: 34.0 };
        assert!(bounds.contains(380.0, 54.0));
        assert!(!bounds.contains(51.0, 21.0));
        assert!(!bounds.contains(45.0, 54.0));
        assert!(!bounds.contains(399.0, 54.0));
    }

    #[test]
    fn compact_after_expanded_drag_keeps_room_for_revealing_metadata() {
        assert_eq!(expanded_pill_anchor_x("compact",false,false),0);
        assert_eq!(expanded_pill_anchor_x("compact",false,true),352);
        assert_eq!(expanded_pill_anchor_x("default",false,false),76);
    }

    #[test]
    fn compact_canvas_reserves_a_full_side_for_the_metadata_satellite() {
        let monitors=[MonitorRect{x:0,y:0,width:1920,height:1080}];
        for x in [200,850,1500,1800] {
            let (_,_,_,_,anchor,_) = compute_canvas_and_anchor_for_pill(x,100,1.0,"compact",&monitors);
            assert!(anchor<=78||anchor>=274,"compact orb lacks room beside it at {x}: {anchor}");
        }
    }

    #[test]
    fn split_compact_regions_leave_gap_and_circle_corners_click_through() {
        let bounds=IslandBounds{x:48.0,y:48.0,width:214.0,height:60.0,radius:30.0};
        let regions=[IslandBounds{x:48.0,y:48.0,width:60.0,height:60.0,radius:30.0},
            IslandBounds{x:118.0,y:56.0,width:144.0,height:44.0,radius:22.0}];
        assert!(island_contains(&bounds,&regions,78.0,78.0));
        assert!(island_contains(&bounds,&regions,200.0,78.0));
        assert!(!island_contains(&bounds,&regions,113.0,78.0));
        assert!(!island_contains(&bounds,&regions,49.0,49.0));
        assert!(island_contains(&bounds,&[],113.0,78.0));
    }

    #[test]
    fn rejects_non_finite_or_out_of_canvas_bounds() {
        assert!(!IslandBounds { x: f64::NAN, y: 0.0, width: 260.0, height: 58.0, radius: 29.0 }.valid());
        assert!(!IslandBounds { x: 0.0, y: 0.0, width: -1.0, height: 58.0, radius: 29.0 }.valid());
    }

    #[test]
    fn clamps_right_and_bottom_edges_on_primary_monitor() {
        let monitors = vec![MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let (x, y) = clamp_to_monitors(1800, 40, 436, 412, &monitors, 8);
        assert_eq!(x, 1920 - 436 - 8);
        assert_eq!(y, 40);
    }

    #[test]
    fn canvas_has_full_shadow_and_pulse_clearance_at_every_edge() {
        assert!(CANVAS_LOGICAL_W >= CARD_LOGICAL_W+96);
        assert!(CANVAS_LOGICAL_H >= CARD_LOGICAL_H+96);
    }

    #[test]
    fn computes_bottom_anchor_offset_when_pill_is_at_bottom_of_screen() {
        let monitors = vec![MonitorRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        }];
        let (pill_x, pill_y, win_x, win_y, off_x, off_y) =
            compute_canvas_and_anchor_for_pill(800, 900, 1.0, "default", &monitors);
        assert_eq!(pill_x, 800);
        assert_eq!(pill_y, 900);
        assert_eq!(win_x, 800 - 76);
        assert_eq!(win_y, 900 - 330);
        assert_eq!(off_x, 76);
        assert_eq!(off_y, 330); // Bottom of 388px island (388 - 58 = 330)
    }

    #[test]
    fn supports_negative_virtual_desktop_coordinates_on_secondary_monitor() {
        let monitors = vec![
            MonitorRect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
            },
            MonitorRect {
                x: -1920,
                y: -200,
                width: 1920,
                height: 1080,
            },
        ];
        let (x, y) = clamp_to_monitors(-1915, -198, 284, 82, &monitors, 8);
        assert_eq!(x, -1920 + 8);
        assert_eq!(y, -200 + 8);
    }
}
