//! Opt-in CLI integration fixture. No desktop input injection or user library.
//! Compiled out of ordinary app builds.
use crate::{window_manager, AppState};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager};

static POINTER: Mutex<Option<((i32, i32), bool)>> = Mutex::new(None);
fn trace(message: &str) {
    if let Some(path) = std::env::var_os("ISLA_INPUT_AUDIT_REPORT") {
        use std::io::Write;
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(std::path::PathBuf::from(path).with_extension("trace"))
        {
            let _ = writeln!(f, "{:?}: {message}", Instant::now());
        }
    }
}
pub fn pointer() -> Option<((i32, i32), bool)> {
    *POINTER.lock().unwrap()
}
fn point(value: (i32, i32), down: bool) {
    *POINTER.lock().unwrap() = Some((value, down));
}

#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}
#[link(name = "user32")]
extern "system" {
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
    fn GetDpiForWindow(hwnd: isize) -> u32;
    fn EnumChildWindows(
        hwnd: isize,
        callback: unsafe extern "system" fn(isize, isize) -> i32,
        data: isize,
    ) -> i32;
    fn GetClassNameW(hwnd: isize, class: *mut u16, len: i32) -> i32;
    fn PostMessageW(hwnd: isize, message: u32, wparam: usize, lparam: isize) -> i32;
    fn WindowFromPoint(point: Point) -> isize;
    fn IsChild(parent: isize, child: isize) -> i32;
    fn GetThreadDesktop(thread: u32) -> isize;
    fn GetUserObjectInformationW(
        object: isize,
        index: i32,
        data: *mut std::ffi::c_void,
        len: u32,
        needed: *mut u32,
    ) -> i32;
    fn CreateWindowExW(
        ex: u32,
        class: *const u16,
        title: *const u16,
        style: u32,
        x: i32,
        y: i32,
        w: i32,
        h: i32,
        parent: isize,
        menu: isize,
        instance: isize,
        param: *const std::ffi::c_void,
    ) -> isize;
    fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn GetCurrentThreadId() -> u32;
}

fn private_desktop() -> bool {
    unsafe {
        let mut name = [0u16; 256];
        let mut needed = 0;
        GetUserObjectInformationW(
            GetThreadDesktop(GetCurrentThreadId()),
            2,
            name.as_mut_ptr() as *mut _,
            512,
            &mut needed,
        ) != 0
            && String::from_utf16_lossy(&name).starts_with("IslaNativeAudit-")
    }
}

unsafe extern "system" fn renderer_child(hwnd: isize, data: isize) -> i32 {
    let mut class = [0u16; 128];
    let len = GetClassNameW(hwnd, class.as_mut_ptr(), 128);
    if String::from_utf16_lossy(&class[..len as usize]) == "Chrome_RenderWidgetHostHWND" {
        *(data as *mut isize) = hwnd;
    }
    1
}

pub fn configure(context: &mut tauri::Context<tauri::Wry>) {
    context.config_mut().identifier = format!("app.isla.inputaudit.p{}", std::process::id());
    context.config_mut().app.windows[0].visible = private_desktop();
    context.config_mut().app.windows[0].skip_taskbar = true;
}

fn wait(label: &str, mut condition: impl FnMut() -> bool) -> Result<(), String> {
    trace(&format!("wait: {label}"));
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(5) {
        if condition() {
            trace(&format!("done: {label}"));
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    Err(format!("Timed out: {label}"))
}

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        trace("audit thread starting");
        let mut stages = Vec::new();
        let events = std::sync::Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let sink = events.clone();
        let _listen = app.listen("isla://input-audit", move |event| {
            if let Ok(value) = serde_json::from_str(event.payload()) {
                sink.lock().unwrap().push(value);
            }
        });
        let outcome = (|| -> Result<(), String> {
            if !private_desktop() {
                return Err(
                    "Refusing native pointer fixture outside the private audit desktop".into(),
                );
            }
            let window = app.get_webview_window("main").unwrap();
            let state = app.state::<AppState>();
            let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
            let origin = || {
                let mut p = Point::default();
                unsafe {
                    ClientToScreen(hwnd, &mut p);
                }
                (p.x, p.y)
            };
            let scale = unsafe { GetDpiForWindow(hwnd) } as f64 / 96.0;
            let class: Vec<u16> = "BUTTON\0".encode_utf16().collect();
            let backdrop = unsafe {
                CreateWindowExW(
                    0x08000080,
                    class.as_ptr(),
                    class.as_ptr(),
                    0x90000000,
                    0,
                    0,
                    5000,
                    5000,
                    0,
                    0,
                    0,
                    std::ptr::null(),
                )
            };
            if backdrop == 0 {
                return Err("Cannot create fixture backdrop".into());
            }
            unsafe {
                SetWindowPos(backdrop, 1, 0, 0, 0, 0, 0x1 | 0x2 | 0x10);
            }
            let mut renderer = 0isize;
            unsafe {
                EnumChildWindows(hwnd, renderer_child, &mut renderer as *mut _ as isize);
            }
            if renderer == 0 {
                return Err("Real WebView2 renderer HWND missing".into());
            }
            let packed = |x: f64, y: f64| {
                (((y * scale).round() as i32 & 0xffff) << 16
                    | ((x * scale).round() as i32 & 0xffff)) as isize
            };
            let snapshot = |label: &str| {
                trace(&format!("snapshot: {label}"));
                let mut value = {
                    let s = state.window_ctrl.state.lock().unwrap();
                    serde_json::json!({"label":label,"expanded":s.expanded,"ignore":s.ignoring_cursor,"drag":s.drag_session.is_some(),"bounds":s.island_bounds.map(|b|(b.x,b.y,b.width,b.height)),"regions":s.island_regions.iter().map(|b|(b.x,b.y,b.width,b.height)).collect::<Vec<_>>(),"geometryAgeMs":s.hit_geometry_at.map(|at|at.elapsed().as_millis())})
                };
                value["origin"] = serde_json::json!(origin());
                value["flags"] = serde_json::json!(unsafe { GetWindowLongPtrW(hwnd, -20) });
                value
            };
            let set_local = |x: f64, y: f64, down| {
                let (ox, oy) = origin();
                point((ox + (x * scale) as i32, oy + (y * scale) as i32), down);
            };
            set_local(350.0, 260.0, false);
            wait("initial real WebView2 geometry", || {
                state
                    .window_ctrl
                    .state
                    .lock()
                    .unwrap()
                    .island_bounds
                    .is_some_and(|b| b.width < 65.0)
            })?;
            window.eval("for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'isla://input-audit',payload:{type:e.type,target:e.target.tagName,label:e.target.closest('[aria-label]')?.getAttribute('aria-label'),trusted:e.isTrusted,x:e.clientX,y:e.clientY}}),true)").map_err(|e|e.to_string())?;
            let query_id = std::sync::atomic::AtomicUsize::new(0);
            let dom_center = |selector: &str| -> Result<(f64, f64), String> {
                trace(&format!("click: {selector}"));
                let id = query_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                let selector = serde_json::to_string(selector).unwrap();
                window.eval(format!("(()=>{{const e=document.querySelector({selector}),r=e.getBoundingClientRect();window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{{event:'isla://input-audit',payload:{{type:'point',id:{id},x:r.x+r.width/2,y:r.y+r.height/2}}}})}})()")).map_err(|e|e.to_string())?;
                wait("DOM click point", || {
                    events
                        .lock()
                        .unwrap()
                        .iter()
                        .any(|e| e["type"] == "point" && e["id"] == id)
                })?;
                let value = events
                    .lock()
                    .unwrap()
                    .iter()
                    .find(|e| e["type"] == "point" && e["id"] == id)
                    .unwrap()
                    .clone();
                let (x, y) = (value["x"].as_f64().unwrap(), value["y"].as_f64().unwrap());
                Ok((x, y))
            };
            let click = |selector: &str| -> Result<(), String> {
                let (x, y) = dom_center(selector)?;
                set_local(x, y, false);
                wait(
                    "fixture click hit target",
                    || unsafe { GetWindowLongPtrW(hwnd, -20) } & 0x20 == 0,
                )?;
                set_local(x, y, true);
                unsafe {
                    PostMessageW(renderer, 0x200, 0, packed(x, y));
                    PostMessageW(renderer, 0x201, 1, packed(x, y));
                }
                std::thread::sleep(Duration::from_millis(50));
                set_local(x, y, false);
                unsafe {
                    PostMessageW(renderer, 0x202, 0, packed(x, y));
                }
                Ok(())
            };
            stages.push(snapshot("initial"));
            trace("reading audio snapshot");
            let mut playing = serde_json::to_value(state.audio.get_snapshot()).unwrap();
            let track = serde_json::json!({"id":1,"title":"Native input fixture","artist":"Isla test","album":"Fixture","albumArtist":"","genre":"","filePath":"fixture.mp3","normalizedPath":"fixture.mp3","trackNumber":null,"year":null,"durationSecs":180.0,"format":"MP3","bitrateKbps":null,"sampleRateHz":null,"fileSizeBytes":0,"artworkDataUrl":null,"dominantColor":"#7560ff","isFavorite":false,"dateAdded":0,"fileMissing":false});
            playing["currentTrack"] = track.clone();
            playing["queue"] = serde_json::json!([track]);
            playing["currentQueueIndex"] = serde_json::json!(0);
            playing["isPlaying"] = serde_json::json!(true);
            playing["durationSecs"] = serde_json::json!(180);
            playing["volume"] = serde_json::json!(0.5);
            trace("emitting playing state");
            let _ = app.emit("isla://playback-state", playing);
            trace("emitted playing state");
            let pulses = app.clone();
            std::thread::spawn(move || loop {
                let _ = pulses.emit(
                    "isla://audio-beat",
                    serde_json::json!({"trackId":1,"strength":1}),
                );
                std::thread::sleep(Duration::from_millis(180));
            });
            std::thread::sleep(Duration::from_millis(300));
            click("[data-compact-orb]")?;
            wait("split controls", || {
                state.window_ctrl.state.lock().unwrap().island_regions.len() == 2
            })?;
            std::thread::sleep(Duration::from_millis(400));
            click("[aria-label=\"Expand music player\"]")?;
            wait("expanded geometry", || {
                let s = state.window_ctrl.state.lock().unwrap();
                s.expanded && s.island_bounds.is_some_and(|b| b.width > 400.0)
            })?;
            stages.push(snapshot("expanded"));
            let mode = std::env::var("ISLA_AUDIT_MODE").unwrap_or_default();
            if mode == "expanded-drag" {
                let (hx, hy) = dom_center(".xp-eyebrow")?;
                set_local(hx, hy, true);
                let cursor = pointer().unwrap().0;
                unsafe {
                    PostMessageW(renderer, 0x200, 0, packed(hx, hy));
                    PostMessageW(renderer, 0x201, 1, packed(hx, hy));
                }
                wait("expanded renderer starts drag", || {
                    state
                        .window_ctrl
                        .state
                        .lock()
                        .unwrap()
                        .drag_session
                        .is_some()
                })?;
                point((cursor.0 - 80, cursor.1 - 40), true);
                unsafe {
                    PostMessageW(
                        renderer,
                        0x200,
                        1,
                        packed(hx - 80.0 / scale, hy - 40.0 / scale),
                    );
                }
                std::thread::sleep(Duration::from_millis(150));
                point((cursor.0 - 80, cursor.1 - 40), false);
                unsafe {
                    PostMessageW(renderer, 0x202, 0, packed(hx, hy));
                }
                wait("expanded renderer drag release", || {
                    state
                        .window_ctrl
                        .state
                        .lock()
                        .unwrap()
                        .drag_session
                        .is_none()
                })?;
                stages.push(snapshot("expanded moved"));
            }
            let (px, py) = {
                let s = state.window_ctrl.state.lock().unwrap();
                let b = s.island_bounds.unwrap();
                (b.x + b.width / 2.0, b.y + b.height / 2.0)
            };
            set_local(px, py, false);
            wait(
                "expanded HWND interactive",
                || unsafe { GetWindowLongPtrW(hwnd, -20) } & 0x20 == 0,
            )?;
            std::thread::sleep(Duration::from_millis(300));
            if mode == "blur" {
                window
                    .eval("window.dispatchEvent(new FocusEvent('blur'))")
                    .map_err(|e| e.to_string())?;
            } else if mode != "idle" {
                click("[aria-label=\"Collapse to floating pill\"]")?;
            }
            wait("collapsed real WebView2 geometry", || {
                let s = state.window_ctrl.state.lock().unwrap();
                !s.expanded
                    && s.island_bounds.is_some_and(|b| b.width < 65.0)
                    && s.island_regions.len() == 1
            })?;
            stages.push(snapshot("collapsed"));
            set_local(350.0, 260.0, false);
            wait(
                "collapsed transparent HWND",
                || unsafe { GetWindowLongPtrW(hwnd, -20) } & 0x20 != 0,
            )?;
            {
                let p = pointer().unwrap().0;
                let target = unsafe { WindowFromPoint(Point { x: p.0, y: p.1 }) };
                if target != backdrop {
                    return Err(format!("Transparent native WebView2 canvas still owns hit target: {target}, expected {backdrop}"));
                }
            }
            stages.push(snapshot("outside after collapse"));
            let (x, y) = {
                let s = state.window_ctrl.state.lock().unwrap();
                let b = s.island_regions[0];
                (b.x + b.width / 2.0, b.y + b.height / 2.0)
            };
            set_local(x, y, false);
            wait(
                "artwork HWND interactive after collapse",
                || unsafe { GetWindowLongPtrW(hwnd, -20) } & 0x20 == 0,
            )?;
            {
                let p = pointer().unwrap().0;
                let target = unsafe { WindowFromPoint(Point { x: p.0, y: p.1 }) };
                if target != hwnd && unsafe { IsChild(hwnd, target) } == 0 {
                    return Err(format!("Artwork cannot receive Windows input: {target}"));
                }
            }
            stages.push(snapshot("artwork after collapse"));
            let cursor = pointer().unwrap().0;
            let before_pointer_drag = origin();
            point(cursor, true);
            unsafe {
                PostMessageW(renderer, 0x200, 0, packed(x, y));
                PostMessageW(renderer, 0x201, 1, packed(x, y));
            }
            std::thread::sleep(Duration::from_millis(80));
            point((cursor.0 + 24, cursor.1 - 12), true);
            unsafe {
                PostMessageW(
                    renderer,
                    0x200,
                    1,
                    packed(x + 24.0 / scale, y - 12.0 / scale),
                );
            }
            let native_drag = wait("real WebView2 pointer drag after collapse", || {
                state
                    .window_ctrl
                    .state
                    .lock()
                    .unwrap()
                    .drag_session
                    .is_some()
            });
            native_drag?;
            point((cursor.0 - 80, cursor.1 - 40), true);
            unsafe {
                PostMessageW(
                    renderer,
                    0x200,
                    1,
                    packed(x - 80.0 / scale, y - 40.0 / scale),
                );
            }
            wait("real renderer drag moves the native window", || {
                let now = origin();
                (now.0 - before_pointer_drag.0).abs() >= 50
                    && (now.1 - before_pointer_drag.1).abs() >= 20
            })?;
            stages.push(snapshot("real renderer pointer drag"));
            point((cursor.0 - 80, cursor.1 - 40), false);
            let now = origin();
            let up_x = (cursor.0 - 80 - now.0) as f64 / scale;
            let up_y = (cursor.1 - 40 - now.1) as f64 / scale;
            unsafe {
                PostMessageW(renderer, 0x202, 0, packed(up_x, up_y));
            }
            wait("renderer drag release", || {
                state
                    .window_ctrl
                    .state
                    .lock()
                    .unwrap()
                    .drag_session
                    .is_none()
            })?;
            let before = origin();
            let cursor = pointer().unwrap().0;
            point(cursor, true);
            window_manager::begin_interactive_drag(&window, &state.window_ctrl)?;
            let (dx, dy) = if std::env::var("ISLA_AUDIT_ANCHOR").as_deref() == Ok("bottom-right") {
                (-80, -40)
            } else {
                (80, 40)
            };
            point((cursor.0 + dx, cursor.1 + dy), true);
            wait("native window moves after collapse", || {
                let now = origin();
                (now.0 - before.0).abs() >= 60 && (now.1 - before.1).abs() >= 25
            })?;
            stages.push(snapshot("drag moved"));
            point((cursor.0 + dx, cursor.1 + dy), false);
            wait("native drag releases", || {
                state
                    .window_ctrl
                    .state
                    .lock()
                    .unwrap()
                    .drag_session
                    .is_none()
            })?;
            stages.push(snapshot("drag released"));
            Ok(())
        })();
        let passed = outcome.is_ok();
        let report = serde_json::json!({"passed":passed,"error":outcome.err(),"stages":stages,"events":*events.lock().unwrap(),"isolatedDesktop":true,"injectedUserInput":false});
        if let Some(path) = std::env::var_os("ISLA_INPUT_AUDIT_REPORT") {
            let _ = std::fs::write(path, serde_json::to_vec_pretty(&report).unwrap());
        }
        app.exit(if passed { 0 } else { 1 });
    });
}
