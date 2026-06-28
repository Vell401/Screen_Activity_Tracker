//! Window tracking через Win32 API.
//!
//! GetForegroundWindow + GetWindowText + GetWindowThreadProcessId +
//! QueryFullProcessImageNameW. Цель: вернуть (имя_процесса, заголовок_окна,
//! полный_путь_к_exe) для активного окна.
//!
//! На не-Windows платформе — заглушка (cfg-гейты нужны, чтобы cargo check
//! на других ОС не падал на `use windows::...`).

#![cfg_attr(not(windows), allow(dead_code))]

/// Снимок активного окна: имя процесса, заголовок, полный путь к exe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForegroundSnapshot {
    pub app_name: String,
    pub window_title: String,
    /// Полный путь к .exe (используется для извлечения иконки).
    pub exe_path: Option<String>,
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
        let (app_name, exe_path) = process_name_and_path(pid)
            .unwrap_or_else(|| (format!("pid:{}", pid), None));

        Some(ForegroundSnapshot {
            app_name,
            window_title: title,
            exe_path,
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

/// Извлечь имя exe и полный путь по pid.
#[cfg(windows)]
fn process_name_and_path(pid: u32) -> Option<(String, Option<String>)> {
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
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.clone());
        Some((name, Some(path)))
    }
}

/// Перечислить все запущенные процессы и найти первый с указанным именем exe.
/// Возвращает его полный путь, если есть. Используется для извлечения иконки
/// без необходимости держать окно в фокусе.
#[cfg(windows)]
pub fn find_running_exe_path(target_name: &str) -> Option<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let target = target_name.to_ascii_lowercase();

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0).ok()?;

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        let mut found_pid: Option<u32> = None;
        if Process32FirstW(snap, &mut entry).is_ok() {
            loop {
                let len = entry
                    .szExeFile
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if name.to_ascii_lowercase() == target {
                    found_pid = Some(entry.th32ProcessID);
                    break;
                }
                if Process32NextW(snap, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snap);

        let pid = found_pid?;
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len: u32 = buf.len() as u32;
        let res = windows::Win32::System::Threading::QueryFullProcessImageNameW(
            handle,
            windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0),
            windows::core::PWSTR(buf.as_mut_ptr()),
            &mut len,
        );
        let _ = CloseHandle(handle);
        res.ok()?;
        let path = String::from_utf16_lossy(&buf[..len as usize]).to_string();
        Some(path)
    }
}

#[cfg(not(windows))]
pub fn find_running_exe_path(_target_name: &str) -> Option<String> {
    None
}

// ----- nonwindows stub ----------------------------------------------------

#[cfg(not(windows))]
pub fn current_foreground() -> Option<ForegroundSnapshot> {
    None
}