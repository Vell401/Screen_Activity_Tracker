//! Глобальное состояние приложения.
//!
//! Хранится в Tauri State manager под `Arc<AppState>`. Один и тот же Arc
//! делят команды (через `State<'_, Arc<AppState>>`) и фоновый capture loop
//! (через клон Arc) — так все обращаются к одному `Mutex<Connection>`.

use std::sync::Mutex;

use tauri::Manager;

use crate::settings::CaptureConfig;

/// Состояние, доступное командам и capture engine.
pub struct AppState {
    /// Соединение с SQLite. Mutex — единственный писатель за раз.
    pub db: Mutex<rusqlite::Connection>,
    /// Текущий конфиг трекинга. Обновляется при изменении настроек.
    pub config: Mutex<CaptureConfig>,
}

impl AppState {
    /// Путь к файлу БД: app_data_dir/screen_activity.db
    pub fn db_path(app: &tauri::AppHandle) -> std::path::PathBuf {
        let dir = app
            .path()
            .app_data_dir()
            .expect("app_data_dir unavailable");
        std::fs::create_dir_all(&dir).ok();
        dir.join("screen_activity.db")
    }
}
