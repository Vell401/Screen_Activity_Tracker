//! Window tracking через Win32 API.
//!
//! GetForegroundWindow + GetWindowText + GetWindowThreadProcessId +
//! QueryFullProcessImageNameW. Цель: вернуть (имя_процесса, заголовок_окна)
//! для активного окна.
//!
//! На не-Windows платформе — заглушка (cfg-гейты нужны, чтобы cargo check
//! на других ОС не падал на `use windows::...`).

#![cfg_attr(not(windows), allow(dead_code))]

/// Снимок активного окна: имя процесса + заголовок.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundSnapshot {
    pub app_name: String,
    pub window_title: String,
}

#[cfg(windows)]
pub fn current_foreground() -> Option<ForegroundSnapshot> {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;

    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }

        let title = read_window_text(hwnd);
        let pid = get_process_id(hwnd)?;
        let app_name = process_name(pid).unwrap_or_else(|| format!("pid:{}", pid));

        Some(ForegroundSnapshot {
            app_name,
            window_title: title,
        })
    }
}

#[cfg(windows)]
unsafe fn read_window_text(hwnd: windows::Win32::Foundation::HWND) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowTextW;

    // 512 символов достаточно для заголовков окон.
    let mut buf = [0u16; 512];
    let len = GetWindowTextW(hwnd, &mut buf);
    if len <= 0 {
        return String::new();
    }
    let len = len as usize;
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(windows)]
unsafe fn get_process_id(hwnd: windows::Win32::Foundation::HWND) -> Option<u32> {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid as *mut u32));
    if pid == 0 {
        None
    } else {
        Some(pid)
    }
}

/// Извлечь имя исполняемого файла процесса по pid.
#[cfg(windows)]
fn process_name(pid: u32) -> Option<String> {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
        QueryFullProcessImageNameW,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buf = [0u16; 1024];
        let mut len: u32 = buf.len() as u32;
        // Второй аргумент — PROCESS_NAME_FORMAT: Win32 = 0, Native = 1.
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );

        let _ = CloseHandle(handle);

        res.ok()?;
        let path = OsString::from_wide(&buf[..len as usize])
            .to_string_lossy()
            .to_string();

        // Берём только имя файла без каталога.
        let name = std::path::Path::new(&path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(&path);
        Some(name.to_string())
    }
}

// ----- non-windows stub ----------------------------------------------------

#[cfg(not(windows))]
pub fn current_foreground() -> Option<ForegroundSnapshot> {
    None
}
