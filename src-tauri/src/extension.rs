//! Браузерное расширение: экспорт файлов на диск и статус подключения.
//!
//! Транспорт — локальный HTTP-сервер (см. [`crate::server`]). Регистрация в
//! реестре и native messaging больше не нужны: расширение само находит порт и
//! шлёт heartbeat на 127.0.0.1.

use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use serde::Serialize;

use crate::bridge;
use crate::state::AppState;

// Встроенные файлы расширения — бейкаются в бинарник на этапе компиляции.
const MANIFEST_JSON: &str = include_str!("../resources/extension/manifest.json");
const BACKGROUND_JS: &str = include_str!("../resources/extension/background.js");
const POPUP_HTML: &str = include_str!("../resources/extension/popup.html");
const POPUP_JS: &str = include_str!("../resources/extension/popup.js");
const INSTALL_TXT: &str = include_str!("../resources/extension/INSTALL.txt");
const ICON16: &[u8] = include_bytes!("../icons/32x32.png");
const ICON48: &[u8] = include_bytes!("../icons/64x64.png");
const ICON128: &[u8] = include_bytes!("../icons/128x128.png");

/// Статус расширения для UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionStatus {
    /// Расширение присылало heartbeat недавно (< 60с).
    pub connected: bool,
    /// Последний полученный URL (только для свежего события "active").
    pub last_url: Option<String>,
    pub last_title: Option<String>,
    /// Сколько мс назад был последний heartbeat (None — не было ни разу).
    pub last_seen_ms_ago: Option<i64>,
    /// Локальный сервер поднят.
    pub server_running: bool,
    /// Порт локального сервера (0 — не запущен).
    pub server_port: u16,
}

/// Записать файлы расширения в каталог `dest`. Возвращает путь к каталогу.
pub fn export(dest: &Path) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dest)?;
    std::fs::write(dest.join("manifest.json"), MANIFEST_JSON)?;
    std::fs::write(dest.join("background.js"), BACKGROUND_JS)?;
    std::fs::write(dest.join("popup.html"), POPUP_HTML)?;
    std::fs::write(dest.join("popup.js"), POPUP_JS)?;
    std::fs::write(dest.join("INSTALL.txt"), INSTALL_TXT)?;
    std::fs::write(dest.join("icon16.png"), ICON16)?;
    std::fs::write(dest.join("icon48.png"), ICON48)?;
    std::fs::write(dest.join("icon128.png"), ICON128)?;
    Ok(dest.to_path_buf())
}

/// Собрать статус расширения для UI.
pub fn status(state: &AppState) -> ExtensionStatus {
    let hb = bridge::read(&bridge::heartbeat_path(&state.data_dir));
    let now = bridge::now_ms();
    let (last_url, last_title, last_seen, connected) = match hb {
        Some(h) => {
            let ago = now - h.ts;
            let fresh = (0..60_000).contains(&ago);
            let url = if h.kind == "active" { h.url } else { None };
            (url, h.title, Some(ago), fresh)
        }
        None => (None, None, None, false),
    };
    let port = state.server_port.load(Ordering::SeqCst);
    ExtensionStatus {
        connected,
        last_url,
        last_title,
        last_seen_ms_ago: last_seen,
        server_running: port != 0,
        server_port: port,
    }
}
