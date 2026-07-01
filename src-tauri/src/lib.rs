//! Точка входа библиотеки Tauri. Setup: открыть БД, зарегистрировать состояние,
//! запустить capture engine, повесить обработчики команд, трей и автозапуск.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod capture;
mod commands;
mod db;
mod extension;
mod icons;
mod server;
mod settings;
mod state;

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Arc, Mutex};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WindowEvent};

use crate::state::AppState;

/// Показать и сфокусировать главное окно (из трея). Явно шлём "app-resumed" —
/// не полагаемся только на нативный Focused(true) (см. on_window_event ниже),
/// так как set_focus() на уже сфокусированном окне может не породить событие.
fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    let _ = app.emit("app-resumed", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Аргумент при автозапуске: стартуем свёрнутыми в трей.
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            // Логирование — минимум в stdout, для dev.
            let _ = env_logger::Builder::from_env(
                env_logger::Env::default().default_filter_or("info"),
            )
            .try_init();

            // 1. Открываем БД (путь учитывает пользовательский выбор).
            let data_dir = AppState::data_dir(&app.handle());
            let db_path = AppState::resolve_db_path(&app.handle());
            log::info!("opening db at {}", db_path.display());
            let conn = db::open(&db_path).expect("failed to open db");

            // 2. Грузим конфиг трекинга + флаг трея из settings.
            let mut minimize_to_tray = true;
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
                if let Ok(Some(v)) = db::get_setting(&conn, settings::KEY_MINIMIZE_TO_TRAY) {
                    minimize_to_tray = matches!(v.as_str(), "true" | "1");
                }
                cfg
            };

            // 3. Регистрируем состояние.
            let state = Arc::new(AppState {
                db: Mutex::new(conn),
                config: Mutex::new(config),
                data_dir,
                db_path,
                server_port: AtomicU16::new(0),
                minimize_to_tray: AtomicBool::new(minimize_to_tray),
                open_interval: Mutex::new(None),
            });
            app.manage(state.clone());

            // 4. Запускаем capture engine.
            capture::spawn(state.clone(), app.handle().clone());

            // 5. Локальный сервер приёма heartbeat от браузерного расширения.
            server::spawn(state.clone());

            // 6. Иконка в системном трее с меню «Открыть / Выход».
            if let Some(icon) = app.default_window_icon().cloned() {
                let show_i = MenuItem::with_id(app, "show", "Открыть", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
                let _tray = TrayIconBuilder::with_id("main")
                    .icon(icon)
                    .tooltip("Screen Activity Tracker")
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => show_main(app),
                        "quit" => app.exit(0),
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            show_main(tray.app_handle());
                        }
                    })
                    .build(app)?;
            }

            // 7. Запуск через автозапуск (--autostart) → стартуем в трее.
            if std::env::args().any(|a| a == "--autostart") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| match event {
            // Закрытие окна → прячем в трей (если включено), не выходим.
            WindowEvent::CloseRequested { api, .. } => {
                let state = window.state::<Arc<AppState>>();
                if state.minimize_to_tray.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            // Окно вернуло фокус — свернули из трея, развернули из панели задач
            // или просто переключились обратно. Данные могли устареть, пока
            // поллинг стоял на паузе (см. useAsyncData: пауза при document.hidden).
            WindowEvent::Focused(true) => {
                let _ = window.emit("app-resumed", ());
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_activities,
            commands::get_summary,
            commands::get_range_stats,
            commands::get_timeline,
            commands::list_category_rules,
            commands::upsert_category_rule,
            commands::delete_category_rule,
            commands::get_settings,
            commands::update_settings,
            commands::set_tracking_enabled,
            commands::get_current_activity,
            commands::get_db_info,
            commands::clear_activities,
            commands::recategorize,
            commands::get_extension_status,
            commands::export_extension,
            commands::get_app_icon,
            commands::get_app_icons,
            commands::ensure_app_icon,
            commands::get_app_icon_data,
            commands::get_minimize_to_tray,
            commands::set_minimize_to_tray,
            commands::get_autostart,
            commands::set_autostart,
            commands::choose_db_location,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // При выходе сбрасываем открытый интервал, чтобы не потерять
            // последний (часто самый длинный) сегмент активности.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app_handle.try_state::<Arc<AppState>>() {
                    capture::flush_open_interval(state.inner());
                }
            }
        });
}
