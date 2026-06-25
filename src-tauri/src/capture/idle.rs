//! Idle detection через GetLastInputInfo + GetTickCount64.
//!
//! Известное ограничение (зафиксировано в CLAUDE.md): такой метод не учитывает
//! просмотр видео — мышь не двигается, пользователь визуально активен, но
//! счётчик простоя растёт. Future: дополнить сигналом аудиосессии.

#![cfg_attr(not(windows), allow(dead_code))]

/// Сколько миллисекунд прошло с последнего ввода (мышь/клавиатура).
#[cfg(windows)]
pub fn millis_since_last_input() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetLastInputInfo;
    use windows::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO;

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            let now = GetTickCount64();
            // dwTime — это ms с старта системы, в той же шкале что GetTickCount.
            let last = info.dwTime as u64;
            // Защита от гонки/оборачивания.
            now.checked_sub(last)
        } else {
            None
        }
    }
}

#[cfg(not(windows))]
pub fn millis_since_last_input() -> Option<u64> {
    None
}

/// true, если бездействие длится дольше threshold_ms.
pub fn is_idle(threshold_ms: u64) -> bool {
    matches!(millis_since_last_input(), Some(d) if d >= threshold_ms)
}
