//! Idle detection через GetLastInputInfo + GetTickCount64.
//!
//! Известное ограничение (зафиксировано в CLAUDE.md): такой метод не учитывает
//! просмотр видео — мышь не двигается, пользователь визуально активен, но
//! счётчик простоя растёт. Future: дополнить сигналом аудиосессии.

#![cfg_attr(not(windows), allow(dead_code))]

/// Сколько миллисекунд прошло с последнего ввода (мышь/клавиатура).
#[cfg(windows)]
pub fn millis_since_last_input() -> Option<u64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetLastInputInfo;
    use windows::Win32::UI::Input::KeyboardAndMouse::LASTINPUTINFO;

    unsafe {
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            // dwTime и GetTickCount — оба u32 (ms с старта системы, одна шкала).
            // wrapping_sub корректно считает разницу через 32-битное
            // переполнение (~каждые 49.7 дней). Если брать GetTickCount64
            // (не оборачивается), после оборота dwTime разница станет
            // гигантской и всё начнёт считаться простоем.
            let now = GetTickCount();
            Some(now.wrapping_sub(info.dwTime) as u64)
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
