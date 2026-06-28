//! Глобальное состояние приложения.
//!
//! Хранится в Tauri State manager под `Arc<AppState>`. Один и тот же Arc
//! делят команды (через `State<'_, Arc<AppState>>`) и фоновый capture loop
//! (через клон Arc) — так все обращаются к одному `Mutex<Connection>`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU16};
use std::sync::Mutex;

use tauri::Manager;

use crate::settings::CaptureConfig;

/// Состояние, доступное командам и capture engine.
pub struct AppState {
    /// Соединение с SQLite. Mutex — единственный писатель за раз.
    pub db: Mutex<rusqlite::Connection>,
    /// Текущий конфиг трекинга. Обновляется при изменении настроек.
    pub config: Mutex<CaptureConfig>,
    /// Каталог данных приложения (app_data_dir). Здесь icons/ и файл-мост расширения.
    pub data_dir: PathBuf,
    /// Фактический путь к файлу БД (учитывает пользовательский выбор, см. db_location.txt).
    pub db_path: PathBuf,
    /// Порт локального HTTP-сервера приёма heartbeat (0 — ещё не запущен).
    pub server_port: AtomicU16,
    /// Прятать окно в трей при закрытии вместо полного выхода.
    pub minimize_to_tray: AtomicBool,
}

impl AppState {
    /// Каталог данных приложения: app_data_dir (создаётся при необходимости).
    pub fn data_dir(app: &tauri::AppHandle) -> PathBuf {
        let dir = app
            .path()
            .app_data_dir()
            .expect("app_data_dir unavailable");
        std::fs::create_dir_all(&dir).ok();
        dir
    }

    /// Файл с пользовательским путём к БД (лежит в app_data_dir).
    /// Путь нельзя хранить в самой БД (его читают ещё до её открытия).
    fn db_location_file(app: &tauri::AppHandle) -> PathBuf {
        Self::data_dir(app).join("db_location.txt")
    }

    /// Фактический путь к БД: из `db_location.txt`, иначе
    /// `app_data_dir/screen_activity.db`. Каталог назначения создаётся.
    pub fn resolve_db_path(app: &tauri::AppHandle) -> PathBuf {
        let loc = Self::db_location_file(app);
        if let Ok(s) = std::fs::read_to_string(&loc) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                let p = PathBuf::from(trimmed);
                if let Some(parent) = p.parent() {
                    std::fs::create_dir_all(parent).ok();
                }
                return p;
            }
        }
        Self::data_dir(app).join("screen_activity.db")
    }
}
