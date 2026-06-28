//! Обёртки над settings: удобный типизированный доступ из capture engine.

use std::sync::Mutex;

use rusqlite::Connection;

use crate::db;

/// Ключи настроек, известные приложению.
pub const KEY_SAMPLE_INTERVAL_MS: &str = "sample_interval_ms";
pub const KEY_IDLE_THRESHOLD_MS: &str = "idle_threshold_ms";
pub const KEY_TRACKING_ENABLED: &str = "tracking_enabled";
pub const KEY_MINIMIZE_TO_TRAY: &str = "minimize_to_tray";

/// Динамически читаемые настройки, влияющие на capture engine.
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    pub sample_interval_ms: u64,
    pub idle_threshold_ms: u64,
    pub tracking_enabled: bool,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            sample_interval_ms: 5000,
            idle_threshold_ms: 120_000,
            tracking_enabled: true,
        }
    }
}

/// Загрузить конфиг из БД (с fallback на defaults).
pub fn load_config(lock: &Mutex<Connection>) -> CaptureConfig {
    let mut cfg = CaptureConfig::default();
    db::with_conn(lock, |c| {
        if let Some(v) = db::get_setting(c, KEY_SAMPLE_INTERVAL_MS)? {
            if let Ok(n) = v.parse::<u64>() {
                cfg.sample_interval_ms = n.max(200); // не меньше 200ms
            }
        }
        if let Some(v) = db::get_setting(c, KEY_IDLE_THRESHOLD_MS)? {
            if let Ok(n) = v.parse::<u64>() {
                cfg.idle_threshold_ms = n;
            }
        }
        if let Some(v) = db::get_setting(c, KEY_TRACKING_ENABLED)? {
            cfg.tracking_enabled = matches!(v.as_str(), "true" | "1");
        }
        Ok(())
    })
    .ok();
    cfg
}

/// Записать флаг включения трекинга. Возвращает новое значение.
pub fn set_tracking_enabled(lock: &Mutex<Connection>, enabled: bool) -> bool {
    let v = if enabled { "true" } else { "false" };
    db::with_conn(lock, |c| db::set_setting(c, KEY_TRACKING_ENABLED, v)).ok();
    enabled
}
