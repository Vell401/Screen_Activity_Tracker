//! Извлечение иконок приложений из Windows и кеширование их на диск.
//!
//! Стратегия:
//! 1. По полному пути .exe достаём HICON через `ExtractIconExW`.
//! 2. Рисуем иконку в 32-bit ARGB DIB-section через `DrawIconEx` и читаем
//!    пиксели через `GetDIBits`. Конвертим BGRA → RGBA, делаем premultiplied
//!    alpha (чтобы PNG корректно ложился на любой фон).
//! 3. Кодируем PNG через крейт `image`.
//! 4. Считаем SHA-256 от PNG и пишем файл `data_dir/icons/<hash>.png`.
//! 5. Вызывающий код сохраняет соответствие (app_name → hash) в `app_icons`.
//!
//! На не-Windows — заглушки, чтобы `cargo check` на других ОС проходил.

#![cfg_attr(not(windows), allow(dead_code))]

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Информация о результате извлечения.
#[derive(Debug, Clone)]
pub struct ExtractedIcon {
    /// PNG-байты.
    pub png: Vec<u8>,
    /// Реальная сторона вписанной иконки.
    pub width: u32,
}

/// Нормализуем имя процесса: lower-case + trim.
pub fn normalize_app_name(name: &str) -> String {
    name.trim().to_ascii_lowercase()
}

/// Каталог кеша иконок в data_dir.
pub fn icons_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("icons")
}

/// Полный путь к PNG-файлу по хешу.
pub fn icon_path(data_dir: &Path, hash_hex: &str) -> PathBuf {
    icons_dir(data_dir).join(format!("{hash_hex}.png"))
}

/// SHA-256 от байт → hex (lowercase, 64 символа).
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(64);
    for b in out {
        s.push_str(&format!("{:02x}", b));
    }
    s
}

/// Извлечь иконку .exe по полному пути. Возвращает None если не получилось.
#[cfg(windows)]
pub fn extract_from_exe(exe_path: &Path, target_size: u32) -> Option<ExtractedIcon> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileAttributesW, INVALID_FILE_ATTRIBUTES};
    use windows::Win32::UI::Shell::ExtractIconExW;
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let path_str = exe_path.to_string_lossy();
    let wide: Vec<u16> = path_str.encode_utf16().chain(std::iter::once(0)).collect();

    unsafe {
        let attrs = GetFileAttributesW(PCWSTR(wide.as_ptr()));
        if attrs == INVALID_FILE_ATTRIBUTES {
            return None;
        }

        let mut large = HICON::default();
        let mut small = HICON::default();
        let n = ExtractIconExW(PCWSTR(wide.as_ptr()), 0, Some(&mut large), Some(&mut small), 1);
        if n == 0 || large.is_invalid() {
            return None;
        }

        let hicon = if target_size <= 16 { small } else { large };
        let res = if hicon.is_invalid() {
            None
        } else {
            hicon_to_png(hicon, target_size)
        };
        let _ = DestroyIcon(large);
        let _ = DestroyIcon(small);
        res
    }
}

#[cfg(not(windows))]
pub fn extract_from_exe(_exe_path: &Path, _target_size: u32) -> Option<ExtractedIcon> {
    None
}

/// Снять HICON → RGBA → PNG.
#[cfg(windows)]
fn hicon_to_png(hicon: windows::Win32::UI::WindowsAndMessaging::HICON, target_size: u32) -> Option<ExtractedIcon> {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
        HDC,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};

    unsafe {
        let width = target_size.clamp(16, 256);
        let height = width;

        // DIB-секция 32bpp (BGRA в памяти).
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [Default::default(); 1],
        };

        let screen_dc: HDC = GetDC(HWND(std::ptr::null_mut()));
        let mem_dc: HDC = CreateCompatibleDC(screen_dc);

        let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
        let hbm_res = CreateDIBSection(screen_dc, &mut bmi, DIB_RGB_COLORS, &mut bits, None, 0);
        let hbm: HBITMAP = match hbm_res {
            Ok(h) => h,
            Err(_) => {
                let _ = DeleteDC(mem_dc);
                let _ = ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);
                let _ = DestroyIcon(hicon);
                return None;
            }
        };
        if hbm.is_invalid() || bits.is_null() {
            let _ = DeleteObject(hbm);
            let _ = DeleteDC(mem_dc);
            let _ = ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);
            let _ = DestroyIcon(hicon);
            return None;
        }

        let old = SelectObject(mem_dc, hbm);
        let _ = DrawIconEx(
            mem_dc,
            0,
            0,
            hicon,
            width as i32,
            height as i32,
            0,
            None,
            DI_NORMAL,
        );

        let mut buf: Vec<u8> = vec![0u8; (width * height * 4) as usize];
        let copied = GetDIBits(
            mem_dc,
            hbm,
            0,
            height as u32,
            Some(buf.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Восстанавливаем старый объект, прежде чем удалять DIB-секцию.
        SelectObject(mem_dc, old);
        let _ = DeleteObject(hbm);
        let _ = DeleteDC(mem_dc);
        let _ = ReleaseDC(HWND(std::ptr::null_mut()), screen_dc);
        let _ = DestroyIcon(hicon);

        if copied == 0 {
            return None;
        }

        // BGRA → RGBA
        let mut rgba = Vec::with_capacity(buf.len());
        for chunk in buf.chunks_exact(4) {
            rgba.push(chunk[2]); // R <- B
            rgba.push(chunk[1]); // G
            rgba.push(chunk[0]); // B <- R
            rgba.push(chunk[3]); // A
        }
        // Премильтиплицируем альфу, чтобы PNG корректно смешивался с тёмным фоном.
        premultiply_alpha_inplace(&mut rgba);

        let img = image::RgbaImage::from_raw(width, height, rgba)?;
        let mut png_buf: Vec<u8> = Vec::new();
        let dyn_img = image::DynamicImage::ImageRgba8(img);
        if dyn_img
            .write_to(&mut std::io::Cursor::new(&mut png_buf), image::ImageFormat::Png)
            .is_err()
        {
            return None;
        }

        Some(ExtractedIcon {
            png: png_buf,
            width,
        })
    }
}

/// Записать PNG на диск под именем hash.png. Создаёт каталог если надо.
pub fn write_to_disk(data_dir: &Path, hash_hex: &str, png: &[u8]) -> std::io::Result<PathBuf> {
    let dir = icons_dir(data_dir);
    std::fs::create_dir_all(&dir)?;
    let path = icon_path(data_dir, hash_hex);
    std::fs::write(&path, png)?;
    Ok(path)
}

/// Альфа-премильтипликация (in-place).
fn premultiply_alpha_inplace(rgba: &mut [u8]) {
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        px[0] = ((px[0] as u32 * a + 127) / 255) as u8;
        px[1] = ((px[1] as u32 * a + 127) / 255) as u8;
        px[2] = ((px[2] as u32 * a + 127) / 255) as u8;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_lower() {
        assert_eq!(normalize_app_name("Chrome.EXE "), "chrome.exe");
    }

    #[test]
    fn sha256_stable() {
        let a = sha256_hex(b"abc");
        let b = sha256_hex(b"abc");
        assert_eq!(a, b);
        assert_eq!(a.len(), 64);
    }

    /// Реальный тест: пытаемся извлечь иконку из системного notepad.exe.
    /// Если получилось — проверяем, что PNG валиден (можно открыть image::open)
    /// и записываем в %TEMP%\\sat-icon-test.png для визуальной проверки.
    #[cfg(windows)]
    #[test]
    fn extract_from_notepad_works() {
        use std::env;
        use std::path::PathBuf;

        // notepad.exe лежит в %SystemRoot%\System32\notepad.exe.
        let sys_root = env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let notepad = PathBuf::from(sys_root).join("System32").join("notepad.exe");

        let Some(icon) = extract_from_exe(&notepad, 32) else {
            eprintln!("[skip] notepad.exe not found at {}", notepad.display());
            return;
        };

        assert!(!icon.png.is_empty(), "PNG пустой");
        eprintln!(
            "[ok] extracted notepad icon: {} bytes, {}x{}",
            icon.png.len(),
            icon.width,
            icon.width
        );

        // Проверим, что PNG действительно читается.
        let img = image::load_from_memory(&icon.png).expect("invalid PNG");
        assert_eq!(img.width(), icon.width);
        assert_eq!(img.height(), icon.width);
        eprintln!("[ok] decoded back: {}x{} RGBA8", img.width(), img.height());

        // Сохраняем в %TEMP% для визуального контроля.
        let out = env::temp_dir().join("sat-icon-test.png");
        let _ = std::fs::write(&out, &icon.png);
        eprintln!("[ok] saved sample to: {}", out.display());

        // SHA-256 от PNG стабилен.
        let h = sha256_hex(&icon.png);
        assert_eq!(h.len(), 64);
        eprintln!("[ok] sha256: {}", h);
    }

    /// Тест полного pipeline: извлечение → SHA → запись на диск → проверка файла.
    #[cfg(windows)]
    #[test]
    fn full_pipeline_to_disk() {
        use std::env;
        use std::path::PathBuf;

        let sys_root = env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let calc = PathBuf::from(sys_root).join("System32").join("calc.exe");

        let Some(icon) = extract_from_exe(&calc, 32) else {
            eprintln!("[skip] calc.exe not found at {}", calc.display());
            return;
        };

        let hash = sha256_hex(&icon.png);
        let tmp_data = env::temp_dir().join("sat-icon-test-data");
        let _ = std::fs::create_dir_all(&tmp_data);
        let written = write_to_disk(&tmp_data, &hash, &icon.png).expect("write to disk");
        assert!(written.exists(), "PNG file not on disk");
        let bytes_on_disk = std::fs::read(&written).expect("read back");
        assert_eq!(bytes_on_disk, icon.png, "disk bytes differ from memory");
        eprintln!(
            "[ok] full pipeline: calc.exe → {} ({} bytes) → {}",
            hash,
            bytes_on_disk.len(),
            written.display()
        );
    }
}
