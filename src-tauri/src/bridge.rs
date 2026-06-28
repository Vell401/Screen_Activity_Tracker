//! Мост «браузерное расширение → приложение» через файл heartbeat.
//!
//! Нативный хост (этот же бинарник, запущенный браузером, см. [`crate::native_host`])
//! пишет сюда URL/заголовок активной вкладки. Capture loop читает файл, когда в
//! фокусе браузер, и предпочитает эти данные парсингу заголовка окна.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Имя файла-моста рядом с БД (в app_data_dir).
pub const HEARTBEAT_FILE: &str = "browser_heartbeat.json";

/// Снимок активной вкладки от расширения (формат файла-моста).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BrowserHeartbeat {
    /// Тип события расширения: "active" | "idle" | "blur" | "connect".
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    /// unix ms — момент записи heartbeat хостом.
    #[serde(default)]
    pub ts: i64,
}

/// Путь к файлу-мосту.
pub fn heartbeat_path(data_dir: &Path) -> PathBuf {
    data_dir.join(HEARTBEAT_FILE)
}

/// Текущее unix-время в мс.
pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Прочитать heartbeat. None — если файла нет или он битый.
pub fn read(path: &Path) -> Option<BrowserHeartbeat> {
    let txt = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&txt).ok()
}

/// Записать heartbeat (вызывается нативным хостом). Файл крошечный, пишем целиком.
pub fn write(path: &Path, hb: &BrowserHeartbeat) -> std::io::Result<()> {
    let txt = serde_json::to_string(hb).unwrap_or_else(|_| "{}".to_string());
    std::fs::write(path, txt)
}
