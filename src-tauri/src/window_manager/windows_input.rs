//! Windows input uses the actual HWND state, independently of queued webview updates.
#[repr(C)]
#[derive(Default)]
struct Point {
    x: i32,
    y: i32,
}

#[link(name = "user32")]
extern "system" {
    fn GetWindowLongPtrW(hwnd: isize, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: isize, index: i32, value: isize) -> isize;
    fn ClientToScreen(hwnd: isize, point: *mut Point) -> i32;
    fn GetDpiForWindow(hwnd: isize) -> u32;
    fn IsWindow(hwnd: isize) -> i32;
    fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, w: i32, h: i32, flags: u32) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn SetLastError(error: u32);
    fn GetLastError() -> u32;
}

const EXSTYLE: i32 = -20;
const TRANSPARENT: isize = 0x20;
const LAYERED: isize = 0x80000;
const INPUT_MASK: isize = TRANSPARENT | LAYERED;

pub fn window_exists(hwnd: isize) -> bool {
    unsafe { IsWindow(hwnd) != 0 }
}

pub fn client_metrics(hwnd: isize) -> Option<((i32, i32), f64)> {
    let mut origin = Point::default();
    let dpi = unsafe { GetDpiForWindow(hwnd) };
    if dpi == 0 || unsafe { ClientToScreen(hwnd, &mut origin) } == 0 {
        return None;
    }
    Some(((origin.x, origin.y), f64::from(dpi) / 96.0))
}

/// Read back the OS flags every time. Tauri's setter acknowledges a queued
/// request, and caching that acknowledgement cannot detect later style changes.
/// Never call this while retaining the window-state mutex: Win32 can synchronously
/// notify the UI thread about a style change.
pub fn sync_passthrough(hwnd: isize, ignore: bool) -> Result<(), String> {
    let current = unsafe { GetWindowLongPtrW(hwnd, EXSTYLE) };
    let desired = if ignore {
        current | INPUT_MASK
    } else {
        current & !INPUT_MASK
    };
    if current == desired {
        return Ok(());
    }
    unsafe {
        SetLastError(0);
        if SetWindowLongPtrW(hwnd, EXSTYLE, desired) == 0 {
            let error = GetLastError();
            if error != 0 {
                return Err(format!("Cannot update Windows input style: {error}"));
            }
        }
        // Refresh cached non-client data without moving, resizing or activating.
        let _ = SetWindowPos(
            hwnd,
            0,
            0,
            0,
            0,
            0,
            0x0001 | 0x0002 | 0x0004 | 0x0010 | 0x0020,
        );
        let applied = GetWindowLongPtrW(hwnd, EXSTYLE) & INPUT_MASK;
        if applied != desired & INPUT_MASK {
            return Err("Windows input style did not settle".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[link(name = "user32")]
    extern "system" {
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
        fn DestroyWindow(hwnd: isize) -> i32;
        fn CreateDesktopW(
            name: *const u16,
            device: *const u16,
            mode: *const std::ffi::c_void,
            flags: u32,
            access: u32,
            security: *const std::ffi::c_void,
        ) -> isize;
        fn SetThreadDesktop(desktop: isize) -> i32;
        fn GetThreadDesktop(thread: u32) -> isize;
        fn CloseDesktop(desktop: isize) -> i32;
        fn WindowFromPoint(point: Point) -> isize;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> u32;
    }

    #[test]
    fn collapsed_input_routes_to_underlying_window_on_an_isolated_desktop() {
        // No SwitchDesktop, mouse/keyboard injection, screen capture or user app.
        // This checks actual Win32 target selection for an overlay with a child.
        std::thread::spawn(|| unsafe {
            let original = GetThreadDesktop(GetCurrentThreadId());
            let name: Vec<u16> = format!("Isla-input-contract-{}\0", std::process::id())
                .encode_utf16()
                .collect();
            let desktop = CreateDesktopW(
                name.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                0,
                0xc3,
                std::ptr::null(),
            );
            assert_ne!(desktop, 0, "cannot create isolated test desktop");
            assert_ne!(SetThreadDesktop(desktop), 0);
            let result = std::panic::catch_unwind(|| {
                struct OwnedWindow(isize);
                impl Drop for OwnedWindow {
                    fn drop(&mut self) {
                        unsafe {
                            DestroyWindow(self.0);
                        }
                    }
                }
                let class: Vec<u16> = "BUTTON\0".encode_utf16().collect();
                let create = |ex, style, x, y, w, h, parent| {
                    let hwnd = CreateWindowExW(
                        ex,
                        class.as_ptr(),
                        class.as_ptr(),
                        style,
                        x,
                        y,
                        w,
                        h,
                        parent,
                        0,
                        0,
                        std::ptr::null(),
                    );
                    assert_ne!(hwnd, 0);
                    OwnedWindow(hwnd)
                };
                let backdrop = create(0, 0x90000000, 0, 0, 800, 600, 0);
                let overlay = create(0x8, 0x90000000, 100, 100, 508, 484, 0);
                let webview_child = create(0, 0x50000000, 0, 0, 508, 484, overlay.0);
                let controller = super::super::WindowController::new(false, "compact".into());
                let orb = super::super::IslandBounds {
                    x: 48.0,
                    y: 48.0,
                    width: 60.0,
                    height: 60.0,
                    radius: 30.0,
                };
                controller
                    .state
                    .lock()
                    .unwrap()
                    .update_hit_geometry(orb, vec![orb], false);
                for (x, y, expected) in [
                    (78, 78, webview_child.0),
                    (350, 260, backdrop.0),
                    (49, 49, backdrop.0),
                    (120, 90, backdrop.0),
                ] {
                    let ignore = controller.cursor_passthrough(
                        Some((x as f64, y as f64)),
                        false,
                        std::time::Instant::now(),
                    );
                    sync_passthrough(overlay.0, ignore).unwrap();
                    assert_eq!(
                        WindowFromPoint(Point {
                            x: 100 + x,
                            y: 100 + y
                        }),
                        expected,
                        "wrong input target at {x},{y}"
                    );
                }
                let _busy_command = controller.state.lock().unwrap();
                let ignore = controller.cursor_passthrough(
                    Some((350.0, 260.0)),
                    false,
                    std::time::Instant::now(),
                );
                sync_passthrough(overlay.0, ignore).unwrap();
                assert_eq!(
                    WindowFromPoint(Point { x: 450, y: 360 }),
                    backdrop.0,
                    "busy UI command must not trap the underlying window"
                );
            });
            assert_ne!(SetThreadDesktop(original), 0);
            assert_ne!(CloseDesktop(desktop), 0);
            if let Err(error) = result {
                std::panic::resume_unwind(error);
            }
        })
        .join()
        .unwrap();
    }

    #[test]
    fn repairs_real_hwnd_flags_after_an_external_style_reset() {
        let class: Vec<u16> = "STATIC\0".encode_utf16().collect();
        let hwnd = unsafe {
            CreateWindowExW(
                0,
                class.as_ptr(),
                class.as_ptr(),
                0x80000000,
                0,
                0,
                64,
                64,
                0,
                0,
                0,
                std::ptr::null(),
            )
        };
        assert_ne!(hwnd, 0);
        struct OwnedWindow(isize);
        impl Drop for OwnedWindow {
            fn drop(&mut self) {
                unsafe {
                    DestroyWindow(self.0);
                }
            }
        }
        let _window = OwnedWindow(hwnd);
        sync_passthrough(hwnd, true).unwrap();
        assert_eq!(
            unsafe { GetWindowLongPtrW(hwnd, EXSTYLE) } & INPUT_MASK,
            INPUT_MASK
        );
        // Reproduce a window manager / show / focus operation replacing styles
        // while the desired input state remains unchanged.
        unsafe {
            SetWindowLongPtrW(hwnd, EXSTYLE, 0x80);
        }
        sync_passthrough(hwnd, true).unwrap();
        assert_eq!(
            unsafe { GetWindowLongPtrW(hwnd, EXSTYLE) } & (INPUT_MASK | 0x80),
            INPUT_MASK | 0x80
        );
        sync_passthrough(hwnd, false).unwrap();
        assert_eq!(
            unsafe { GetWindowLongPtrW(hwnd, EXSTYLE) } & (INPUT_MASK | 0x80),
            0x80
        );
        assert!(client_metrics(hwnd).is_some());
    }
}
