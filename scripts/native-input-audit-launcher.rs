//! Launch only the opt-in fixture on a private, never-switched Windows desktop.
use std::ffi::c_void;
#[repr(C)]
#[derive(Default)]
struct Startup {
    cb: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    cols: u32,
    rows: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved_data: *mut u8,
    stdin: isize,
    stdout: isize,
    stderr: isize,
}
#[repr(C)]
#[derive(Default)]
struct Process {
    process: isize,
    thread: isize,
    pid: u32,
    tid: u32,
}
#[link(name = "user32")]
extern "system" {
    fn CreateDesktopW(
        name: *const u16,
        device: *const u16,
        mode: *const c_void,
        flags: u32,
        access: u32,
        security: *const c_void,
    ) -> isize;
    fn CloseDesktop(desktop: isize) -> i32;
    fn GetProcessWindowStation() -> isize;
    fn GetUserObjectInformationW(
        object: isize,
        index: i32,
        data: *mut c_void,
        len: u32,
        needed: *mut u32,
    ) -> i32;
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateProcessW(
        app: *const u16,
        command: *mut u16,
        process_attributes: *const c_void,
        thread_attributes: *const c_void,
        inherit: i32,
        flags: u32,
        environment: *const c_void,
        directory: *const u16,
        start: *mut Startup,
        process: *mut Process,
    ) -> i32;
    fn WaitForSingleObject(handle: isize, ms: u32) -> u32;
    fn GetExitCodeProcess(handle: isize, code: *mut u32) -> i32;
    fn CloseHandle(handle: isize) -> i32;
    fn TerminateProcess(handle: isize, code: u32) -> i32;
}
fn main() {
    unsafe {
        let path = std::env::args().nth(1).expect("audit executable path");
        let mut station = [0u16; 256];
        let mut needed = 0;
        assert_ne!(
            GetUserObjectInformationW(
                GetProcessWindowStation(),
                2,
                station.as_mut_ptr() as *mut _,
                512,
                &mut needed
            ),
            0
        );
        let station =
            String::from_utf16_lossy(&station[..station.iter().position(|c| *c == 0).unwrap()]);
        let name = format!("IslaNativeAudit-{}", std::process::id());
        let desktop_name: Vec<u16> = format!("{name}\0").encode_utf16().collect();
        let desktop = CreateDesktopW(
            desktop_name.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            0xc3,
            std::ptr::null(),
        );
        assert_ne!(desktop, 0, "private test desktop unavailable");
        let mut full: Vec<u16> = format!("{station}\\{name}\0").encode_utf16().collect();
        let app: Vec<u16> = format!("{path}\0").encode_utf16().collect();
        let mut start = Startup::default();
        start.cb = std::mem::size_of::<Startup>() as u32;
        start.desktop = full.as_mut_ptr();
        let mut process = Process::default();
        let created = CreateProcessW(
            app.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            0,
            0x08000000,
            std::ptr::null(),
            std::ptr::null(),
            &mut start,
            &mut process,
        );
        assert_ne!(created, 0, "cannot start private fixture");
        if WaitForSingleObject(process.process, 20000) == 258 {
            // Only the fixture process created above, never an arbitrary app/PID.
            TerminateProcess(process.process, 2);
            WaitForSingleObject(process.process, 5000);
        }
        let mut code = 1;
        GetExitCodeProcess(process.process, &mut code);
        CloseHandle(process.thread);
        CloseHandle(process.process);
        CloseDesktop(desktop);
        std::process::exit(if code == 259 { 2 } else { code as i32 });
    }
}
