#![windows_subsystem = "windows"]

use std::env;
use std::ffi::OsStr;
use std::fs;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr::{null, null_mut};

const PAYLOAD_ISLA_EXE: &[u8] = include_bytes!("../release/Isla.exe");
const PAYLOAD_WEBVIEW2_DLL: &[u8] = include_bytes!("../release/WebView2Loader.dll");
const PAYLOAD_ICON_ICO: &[u8] = include_bytes!("../src-tauri/icons/icon.ico");

const CREATE_NO_WINDOW: u32 = 0x08000000;

const ID_CHK_DESKTOP: usize = 101;
const ID_CHK_STARTMENU: usize = 102;
const ID_CHK_LAUNCH: usize = 103;
const ID_BTN_INSTALL: usize = 104;
const ID_BTN_CANCEL: usize = 105;

const WM_CREATE: u32 = 0x0001;
const WM_DESTROY: u32 = 0x0002;
const WM_COMMAND: u32 = 0x0111;
const WM_SETFONT: u32 = 0x0030;
const WM_CTLCOLORSTATIC: u32 = 0x0138;
const WM_CTLCOLORBTN: u32 = 0x0135;

const WS_OVERLAPPED: u32 = 0x00000000;
const WS_CAPTION: u32 = 0x00C00000;
const WS_SYSMENU: u32 = 0x00080000;
const WS_MINIMIZEBOX: u32 = 0x00020000;
const WS_VISIBLE: u32 = 0x10000000;
const WS_CHILD: u32 = 0x40000000;
const WS_TABSTOP: u32 = 0x00010000;

const BS_AUTOCHECKBOX: u32 = 0x00000003;
const BS_DEFPUSHBUTTON: u32 = 0x00000001;
const BS_PUSHBUTTON: u32 = 0x00000000;
const BM_GETCHECK: u32 = 0x00F0;
const BM_SETCHECK: u32 = 0x00F1;
const BST_CHECKED: usize = 1;

const PBM_SETRANGE32: u32 = 0x0406;
const PBM_SETPOS: u32 = 0x0402;

const COLOR_WINDOW: i32 = 5;
const TRANSPARENT: i32 = 1;
const DEFAULT_GUI_FONT: i32 = 17;

const MB_OK: u32 = 0x00000000;
const MB_YESNO: u32 = 0x00000004;
const MB_ICONINFORMATION: u32 = 0x00000040;
const MB_ICONQUESTION: u32 = 0x00000020;
const MB_ICONERROR: u32 = 0x00000010;
const IDYES: i32 = 6;

type HWND = *mut core::ffi::c_void;
type HINSTANCE = *mut core::ffi::c_void;
type HMENU = *mut core::ffi::c_void;
type HICON = *mut core::ffi::c_void;
type HCURSOR = *mut core::ffi::c_void;
type HBRUSH = *mut core::ffi::c_void;
type HGDIOBJ = *mut core::ffi::c_void;
type HDC = *mut core::ffi::c_void;
type WPARAM = usize;
type LPARAM = isize;
type LRESULT = isize;

#[repr(C)]
struct WNDCLASSEXW {
    cb_size: u32,
    style: u32,
    lpfn_wnd_proc: Option<unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT>,
    cb_cls_extra: i32,
    cb_wnd_extra: i32,
    h_instance: HINSTANCE,
    h_icon: HICON,
    h_cursor: HCURSOR,
    hbr_background: HBRUSH,
    lpsz_menu_name: *const u16,
    lpsz_class_name: *const u16,
    h_icon_sm: HICON,
}

#[repr(C)]
struct MSG {
    hwnd: HWND,
    message: u32,
    w_param: WPARAM,
    l_param: LPARAM,
    time: u32,
    pt_x: i32,
    pt_y: i32,
}

#[link(name = "user32")]
extern "system" {
    fn RegisterClassExW(lpwcx: *const WNDCLASSEXW) -> u16;
    fn CreateWindowExW(
        dw_ex_style: u32,
        lp_class_name: *const u16,
        lp_window_name: *const u16,
        dw_style: u32,
        x: i32,
        y: i32,
        n_width: i32,
        n_height: i32,
        h_wnd_parent: HWND,
        h_menu: HMENU,
        h_instance: HINSTANCE,
        lp_param: *mut core::ffi::c_void,
    ) -> HWND;
    fn DefWindowProcW(hwnd: HWND, msg: u32, w_param: WPARAM, l_param: LPARAM) -> LRESULT;
    fn GetMessageW(lp_msg: *mut MSG, h_wnd: HWND, w_msg_filter_min: u32, w_msg_filter_max: u32) -> i32;
    fn TranslateMessage(lp_msg: *const MSG) -> i32;
    fn DispatchMessageW(lp_msg: *const MSG) -> LRESULT;
    fn PostQuitMessage(n_exit_code: i32);
    fn SendMessageW(h_wnd: HWND, msg: u32, w_param: WPARAM, l_param: LPARAM) -> LRESULT;
    fn SetWindowTextW(h_wnd: HWND, lp_string: *const u16) -> i32;
    fn EnableWindow(h_wnd: HWND, b_enable: i32) -> i32;
    fn UpdateWindow(h_wnd: HWND) -> i32;
    fn GetSystemMetrics(n_index: i32) -> i32;
    fn LoadCursorW(h_instance: HINSTANCE, lp_cursor_name: *const u16) -> HCURSOR;
    fn LoadIconW(h_instance: HINSTANCE, lp_icon_name: *const u16) -> HICON;
    fn MessageBoxW(h_wnd: HWND, lp_text: *const u16, lp_caption: *const u16, u_type: u32) -> i32;
    fn SetProcessDPIAware() -> i32;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetModuleHandleW(lp_module_name: *const u16) -> HINSTANCE;
}

#[link(name = "gdi32")]
extern "system" {
    fn GetStockObject(i: i32) -> HGDIOBJ;
    fn CreateFontW(
        c_height: i32,
        c_width: i32,
        c_escapement: i32,
        c_orientation: i32,
        c_weight: i32,
        b_italic: u32,
        b_underline: u32,
        b_strike_out: u32,
        i_char_set: u32,
        i_out_precision: u32,
        i_clip_precision: u32,
        i_quality: u32,
        i_pitch_and_family: u32,
        psz_face_name: *const u16,
    ) -> HGDIOBJ;
    fn SetBkMode(hdc: HDC, mode: i32) -> i32;
}

#[link(name = "comctl32")]
extern "system" {
    fn InitCommonControls();
}

#[link(name = "shell32")]
extern "system" {
    fn ShellExecuteW(
        hwnd: HWND,
        lp_operation: *const u16,
        lp_file: *const u16,
        lp_parameters: *const u16,
        lp_directory: *const u16,
        n_show_cmd: i32,
    ) -> isize;
}

fn to_wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

struct UiHandles {
    chk_desktop: HWND,
    chk_startmenu: HWND,
    chk_launch: HWND,
    progress_bar: HWND,
    lbl_status: HWND,
    btn_install: HWND,
    btn_cancel: HWND,
    font_title: HGDIOBJ,
    font_sub: HGDIOBJ,
    font_body: HGDIOBJ,
}

static mut UI: UiHandles = UiHandles {
    chk_desktop: null_mut(),
    chk_startmenu: null_mut(),
    chk_launch: null_mut(),
    progress_bar: null_mut(),
    lbl_status: null_mut(),
    btn_install: null_mut(),
    btn_cancel: null_mut(),
    font_title: null_mut(),
    font_sub: null_mut(),
    font_body: null_mut(),
};

fn get_install_dir() -> PathBuf {
    let local_app_data = env::var("LOCALAPPDATA").unwrap_or_else(|_| {
        let user = env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        format!("{user}\\AppData\\Local")
    });
    PathBuf::from(local_app_data).join("Programs").join("Isla")
}

fn create_windows_shortcut(lnk_path: &Path, target_exe: &Path, work_dir: &Path, icon_path: &Path) {
    let ps_script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $s = $ws.CreateShortcut('{}'); \
         $s.TargetPath = '{}'; \
         $s.WorkingDirectory = '{}'; \
         $s.IconLocation = '{},0'; \
         $s.Description = 'Isla — Floating Dynamic Island Music Player'; \
         $s.Save()",
        lnk_path.to_string_lossy().replace('\'', "''"),
        target_exe.to_string_lossy().replace('\'', "''"),
        work_dir.to_string_lossy().replace('\'', "''"),
        icon_path.to_string_lossy().replace('\'', "''"),
    );

    let _ = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &ps_script])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
}

fn register_uninstaller_in_registry(install_dir: &Path, exe_path: &Path, uninstaller_path: &Path) {
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Isla";
    let reg_cmds: &[(&str, &str, String)] = &[
        ("DisplayName", "REG_SZ", "Isla — Floating Music Player".to_string()),
        ("DisplayVersion", "REG_SZ", "1.0.0".to_string()),
        ("Publisher", "REG_SZ", "Isla Desktop".to_string()),
        ("DisplayIcon", "REG_SZ", exe_path.to_string_lossy().to_string()),
        ("InstallLocation", "REG_SZ", install_dir.to_string_lossy().to_string()),
        (
            "UninstallString",
            "REG_SZ",
            format!("\"{}\" --uninstall", uninstaller_path.to_string_lossy()),
        ),
        ("NoModify", "REG_DWORD", "1".to_string()),
        ("NoRepair", "REG_DWORD", "1".to_string()),
        ("EstimatedSize", "REG_DWORD", "15800".to_string()),
    ];

    for (name, kind, val) in reg_cmds {
        let _ = Command::new("reg")
            .args(["add", key, "/v", name, "/t", kind, "/d", val, "/f"])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
}

unsafe fn set_progress(pos: usize, text: &str) {
    SendMessageW(UI.progress_bar, PBM_SETPOS, pos, 0);
    let wide = to_wide(text);
    SetWindowTextW(UI.lbl_status, wide.as_ptr());
    UpdateWindow(UI.lbl_status);
    UpdateWindow(UI.progress_bar);
}

unsafe fn perform_install(
    hwnd: HWND,
    create_desktop: bool,
    create_startmenu: bool,
    launch_after: bool,
    silent: bool,
) -> Result<(), String> {
    if !silent {
        EnableWindow(UI.btn_install, 0);
        EnableWindow(UI.btn_cancel, 0);
        set_progress(12, "Menutup proses Isla yang sedang berjalan...");
    }

    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "Isla.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    std::thread::sleep(std::time::Duration::from_millis(250));

    let install_dir = get_install_dir();
    if !silent {
        set_progress(28, "Membuat direktori instalasi...");
    }
    fs::create_dir_all(&install_dir)
        .map_err(|e| format!("Gagal membuat folder instalasi {}: {e}", install_dir.display()))?;

    let exe_path = install_dir.join("Isla.exe");
    let dll_path = install_dir.join("WebView2Loader.dll");
    let ico_path = install_dir.join("icon.ico");
    let uninst_path = install_dir.join("Uninstall Isla.exe");

    if !silent {
        set_progress(50, "Mengekstrak Isla.exe & komponen audio...");
    }
    fs::write(&exe_path, PAYLOAD_ISLA_EXE)
        .map_err(|e| format!("Gagal menulis Isla.exe: {e}"))?;
    fs::write(&dll_path, PAYLOAD_WEBVIEW2_DLL)
        .map_err(|e| format!("Gagal menulis WebView2Loader.dll: {e}"))?;
    fs::write(&ico_path, PAYLOAD_ICON_ICO)
        .map_err(|e| format!("Gagal menulis icon.ico: {e}"))?;

    if let Ok(self_exe) = env::current_exe() {
        let _ = fs::copy(&self_exe, &uninst_path);
    }

    if create_desktop {
        if !silent {
            set_progress(72, "Membuat shortcut di Desktop...");
        }
        if let Ok(user_profile) = env::var("USERPROFILE") {
            let desktop_lnk = PathBuf::from(user_profile).join("Desktop").join("Isla.lnk");
            create_windows_shortcut(&desktop_lnk, &exe_path, &install_dir, &ico_path);
        }
    }

    if create_startmenu {
        if !silent {
            set_progress(85, "Membuat shortcut di Start Menu Windows...");
        }
        if let Ok(appdata) = env::var("APPDATA") {
            let start_dir = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs");
            let _ = fs::create_dir_all(&start_dir);
            let start_lnk = start_dir.join("Isla.lnk");
            create_windows_shortcut(&start_lnk, &exe_path, &install_dir, &ico_path);
        }
    }

    if !silent {
        set_progress(95, "Mendaftarkan aplikasi ke sistem Windows...");
    }
    register_uninstaller_in_registry(&install_dir, &exe_path, &uninst_path);

    if !silent {
        set_progress(100, "Instalasi Isla v1.0.0 selesai!");
    }

    if launch_after {
        let op = to_wide("open");
        let file = to_wide(&exe_path.to_string_lossy());
        let dir = to_wide(&install_dir.to_string_lossy());
        ShellExecuteW(null_mut(), op.as_ptr(), file.as_ptr(), null(), dir.as_ptr(), 1);
    } else if !silent {
        let msg = to_wide("Isla v1.0.0 berhasil diinstal di komputer Anda!");
        let cap = to_wide("Instalasi Selesai");
        MessageBoxW(hwnd, msg.as_ptr(), cap.as_ptr(), MB_OK | MB_ICONINFORMATION);
    }

    Ok(())
}

unsafe fn perform_uninstall() {
    let ask = to_wide("Apakah Anda yakin ingin menghapus instalasi Isla Music Player dari komputer ini?");
    let cap = to_wide("Uninstall Isla");
    if MessageBoxW(null_mut(), ask.as_ptr(), cap.as_ptr(), MB_YESNO | MB_ICONQUESTION) != IDYES {
        return;
    }

    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "Isla.exe"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();
    std::thread::sleep(std::time::Duration::from_millis(300));

    let install_dir = get_install_dir();
    let _ = fs::remove_file(install_dir.join("Isla.exe"));
    let _ = fs::remove_file(install_dir.join("WebView2Loader.dll"));
    let _ = fs::remove_file(install_dir.join("icon.ico"));

    if let Ok(user_profile) = env::var("USERPROFILE") {
        let _ = fs::remove_file(PathBuf::from(user_profile).join("Desktop").join("Isla.lnk"));
    }
    if let Ok(appdata) = env::var("APPDATA") {
        let _ = fs::remove_file(
            PathBuf::from(appdata)
                .join("Microsoft\\Windows\\Start Menu\\Programs\\Isla.lnk"),
        );
    }

    let _ = Command::new("reg")
        .args([
            "delete",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Isla",
            "/f",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    let done = to_wide("Isla telah berhasil dihapus dari komputer Anda.");
    MessageBoxW(null_mut(), done.as_ptr(), cap.as_ptr(), MB_OK | MB_ICONINFORMATION);

    // Schedule removal of install folder including Uninstall Isla.exe after process exits
    let cleanup_cmd = format!(
        "ping 127.0.0.1 -n 2 > nul & rmdir /s /q \"{}\"",
        install_dir.to_string_lossy()
    );
    let _ = Command::new("cmd")
        .args(["/C", &cleanup_cmd])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    match msg {
        WM_CREATE => {
            let h_inst = GetModuleHandleW(null());
            let face = to_wide("Segoe UI");
            UI.font_title = CreateFontW(-22, 0, 0, 0, 700, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());
            UI.font_sub = CreateFontW(-13, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());
            UI.font_body = CreateFontW(-14, 0, 0, 0, 400, 0, 0, 0, 1, 0, 0, 5, 0, face.as_ptr());
            if UI.font_body.is_null() {
                UI.font_body = GetStockObject(DEFAULT_GUI_FONT);
            }

            let cls_static = to_wide("STATIC");
            let cls_button = to_wide("BUTTON");
            let cls_progress = to_wide("msctls_progress32");

            let lbl_header = CreateWindowExW(
                0,
                cls_static.as_ptr(),
                to_wide("Install Isla v1.0.0").as_ptr(),
                WS_CHILD | WS_VISIBLE,
                28,
                22,
                430,
                30,
                hwnd,
                null_mut(),
                h_inst,
                null_mut(),
            );
            SendMessageW(lbl_header, WM_SETFONT, UI.font_title as usize, 1);

            let lbl_desc = CreateWindowExW(
                0,
                cls_static.as_ptr(),
                to_wide("Floating Dynamic Island Music Player dengan Auto BPM & Beat-Synced DJ Automix untuk Windows 10/11.").as_ptr(),
                WS_CHILD | WS_VISIBLE,
                28,
                56,
                435,
                38,
                hwnd,
                null_mut(),
                h_inst,
                null_mut(),
            );
            SendMessageW(lbl_desc, WM_SETFONT, UI.font_sub as usize, 1);

            let install_path_text = format!(
                "Lokasi Instalasi: {}",
                get_install_dir().to_string_lossy()
            );
            let lbl_path = CreateWindowExW(
                0,
                cls_static.as_ptr(),
                to_wide(&install_path_text).as_ptr(),
                WS_CHILD | WS_VISIBLE,
                28,
                100,
                435,
                20,
                hwnd,
                null_mut(),
                h_inst,
                null_mut(),
            );
            SendMessageW(lbl_path, WM_SETFONT, UI.font_sub as usize, 1);

            UI.chk_desktop = CreateWindowExW(
                0,
                cls_button.as_ptr(),
                to_wide("Buat shortcut Isla di Desktop").as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX,
                28,
                132,
                400,
                24,
                hwnd,
                ID_CHK_DESKTOP as HMENU,
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.chk_desktop, WM_SETFONT, UI.font_body as usize, 1);
            SendMessageW(UI.chk_desktop, BM_SETCHECK, BST_CHECKED, 0);

            UI.chk_startmenu = CreateWindowExW(
                0,
                cls_button.as_ptr(),
                to_wide("Buat shortcut di Start Menu Windows").as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX,
                28,
                162,
                400,
                24,
                hwnd,
                ID_CHK_STARTMENU as HMENU,
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.chk_startmenu, WM_SETFONT, UI.font_body as usize, 1);
            SendMessageW(UI.chk_startmenu, BM_SETCHECK, BST_CHECKED, 0);

            UI.chk_launch = CreateWindowExW(
                0,
                cls_button.as_ptr(),
                to_wide("Jalankan Isla setelah instalasi selesai").as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_AUTOCHECKBOX,
                28,
                192,
                400,
                24,
                hwnd,
                ID_CHK_LAUNCH as HMENU,
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.chk_launch, WM_SETFONT, UI.font_body as usize, 1);
            SendMessageW(UI.chk_launch, BM_SETCHECK, BST_CHECKED, 0);

            UI.lbl_status = CreateWindowExW(
                0,
                cls_static.as_ptr(),
                to_wide("Siap menginstal Isla v1.0.0").as_ptr(),
                WS_CHILD | WS_VISIBLE,
                28,
                232,
                435,
                20,
                hwnd,
                null_mut(),
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.lbl_status, WM_SETFONT, UI.font_sub as usize, 1);

            UI.progress_bar = CreateWindowExW(
                0,
                cls_progress.as_ptr(),
                null(),
                WS_CHILD | WS_VISIBLE,
                28,
                255,
                435,
                18,
                hwnd,
                null_mut(),
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.progress_bar, PBM_SETRANGE32, 0, 100);
            SendMessageW(UI.progress_bar, PBM_SETPOS, 0, 0);

            UI.btn_install = CreateWindowExW(
                0,
                cls_button.as_ptr(),
                to_wide("Install Sekarang").as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON,
                225,
                292,
                135,
                34,
                hwnd,
                ID_BTN_INSTALL as HMENU,
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.btn_install, WM_SETFONT, UI.font_body as usize, 1);

            UI.btn_cancel = CreateWindowExW(
                0,
                cls_button.as_ptr(),
                to_wide("Batal").as_ptr(),
                WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_PUSHBUTTON,
                370,
                292,
                93,
                34,
                hwnd,
                ID_BTN_CANCEL as HMENU,
                h_inst,
                null_mut(),
            );
            SendMessageW(UI.btn_cancel, WM_SETFONT, UI.font_body as usize, 1);

            0
        }
        WM_CTLCOLORSTATIC | WM_CTLCOLORBTN => {
            let hdc = w_param as HDC;
            SetBkMode(hdc, TRANSPARENT);
            (COLOR_WINDOW + 1) as LRESULT
        }
        WM_COMMAND => {
            let id = w_param & 0xFFFF;
            if id == ID_BTN_CANCEL {
                PostQuitMessage(0);
                return 0;
            }
            if id == ID_BTN_INSTALL {
                let create_desktop =
                    SendMessageW(UI.chk_desktop, BM_GETCHECK, 0, 0) as usize == BST_CHECKED;
                let create_startmenu =
                    SendMessageW(UI.chk_startmenu, BM_GETCHECK, 0, 0) as usize == BST_CHECKED;
                let launch_after =
                    SendMessageW(UI.chk_launch, BM_GETCHECK, 0, 0) as usize == BST_CHECKED;

                match perform_install(hwnd, create_desktop, create_startmenu, launch_after, false) {
                    Ok(()) => {
                        PostQuitMessage(0);
                    }
                    Err(err) => {
                        let msg = to_wide(&err);
                        let cap = to_wide("Gagal Menginstal Isla");
                        MessageBoxW(hwnd, msg.as_ptr(), cap.as_ptr(), MB_OK | MB_ICONERROR);
                        EnableWindow(UI.btn_install, 1);
                        EnableWindow(UI.btn_cancel, 1);
                    }
                }
                return 0;
            }
            DefWindowProcW(hwnd, msg, w_param, l_param)
        }
        WM_DESTROY => {
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, w_param, l_param),
    }
}

fn main() {
    unsafe {
        SetProcessDPIAware();
        InitCommonControls();

        let args: Vec<String> = env::args().collect();
        let exe_name = env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|s| s.to_string_lossy().to_lowercase()))
            .unwrap_or_default();

        if exe_name.contains("uninstall")
            || args.iter().any(|a| a.eq_ignore_ascii_case("--uninstall") || a.eq_ignore_ascii_case("/uninstall"))
        {
            perform_uninstall();
            return;
        }

        if args.iter().any(|a| a.eq_ignore_ascii_case("/S") || a.eq_ignore_ascii_case("--silent")) {
            let _ = perform_install(null_mut(), true, true, false, true);
            return;
        }

        let h_inst = GetModuleHandleW(null());
        let class_name = to_wide("IslaSetupWindowClass");
        let app_icon = LoadIconW(h_inst, 1usize as *const u16);

        let wc = WNDCLASSEXW {
            cb_size: core::mem::size_of::<WNDCLASSEXW>() as u32,
            style: 0,
            lpfn_wnd_proc: Some(wnd_proc),
            cb_cls_extra: 0,
            cb_wnd_extra: 0,
            h_instance: h_inst,
            h_icon: app_icon,
            h_cursor: LoadCursorW(null_mut(), 32512usize as *const u16),
            hbr_background: (COLOR_WINDOW + 1) as HBRUSH,
            lpsz_menu_name: null(),
            lpsz_class_name: class_name.as_ptr(),
            h_icon_sm: app_icon,
        };
        RegisterClassExW(&wc);

        let win_w = 500;
        let win_h = 378;
        let screen_w = GetSystemMetrics(0);
        let screen_h = GetSystemMetrics(1);
        let pos_x = (screen_w - win_w) / 2;
        let pos_y = (screen_h - win_h) / 2;

        let hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            to_wide("Isla v1.0.0 Setup").as_ptr(),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX | WS_VISIBLE,
            pos_x,
            pos_y,
            win_w,
            win_h,
            null_mut(),
            null_mut(),
            h_inst,
            null_mut(),
        );

        if hwnd.is_null() {
            return;
        }

        let mut msg = MSG {
            hwnd: null_mut(),
            message: 0,
            w_param: 0,
            l_param: 0,
            time: 0,
            pt_x: 0,
            pt_y: 0,
        };

        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
