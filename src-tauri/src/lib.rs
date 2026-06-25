//! Точка входа библиотеки Tauri. Setup: открыть БД, зарегистрировать состояние,
//! запустить capture engine, повесить обработчики команд.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capture;
mod commands;
mod db;
mod settings;
mod state;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Логирование — минимум в stdout, для dev.
            let _ = env_logger::Builder::from_env(
                env_logger::Env::default().default_filter_or("info"),
            )
            .try_init();

            // 1. Открываем БД в app_data_dir.
            let db_path = AppState::db_path(&app.handle());
            log::info!("opening db at {}", db_path.display());
            let conn = db::open(&db_path).expect("failed to open db");

            // 2. Грузим конфиг трекинга из settings.
            let config = {
                let mut cfg = settings::CaptureConfig::default();
                if let Ok(Some(v)) = db::get_setting(&conn, settings::KEY_SAMPLE_INTERVAL_MS) {
                    if let Some(n) = v.parse::<u64>().ok() {
                        cfg.sample_interval_ms = n.max(200);
                    }
                }
                if let Ok(Some(v)) = db::get_setting(&conn, settings::KEY_IDLE_THRESHOLD_MS) {
                    if let Some(n) = v.parse::<u64>().ok() {
                        cfg.idle_threshold_ms = n;
                    }
                }
                if let Ok(Some(v)) = db::get_setting(&conn, settings::KEY_TRACKING_ENABLED) {
                    cfg.tracking_enabled = matches!(v.as_str(), "true" | "1");
                }
                cfg
            };

            // 3. Регистрируем состояние.
            let state = Arc::new(AppState {
                db: Mutex::new(conn),
                config: Mutex::new(config),
            });
            app.manage(state.clone());

            // 4. Запускаем capture engine.
            capture::spawn(state.clone(), app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_activities,
            commands::get_summary,
            commands::list_category_rules,
            commands::upsert_category_rule,
            commands::delete_category_rule,
            commands::get_settings,
            commands::update_settings,
            commands::set_tracking_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
