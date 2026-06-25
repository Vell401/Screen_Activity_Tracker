//! Capture engine: фоновый поток опроса активного окна.
//!
//! Логика:
//!   - каждые `sample_interval_ms` (по умолчанию 1000) делаем снимок окна
//!   - если окно/idle-статус изменились — закрываем текущий интервал, пишем в БД,
//!     открываем новый
//!   - если tracking_enabled=false — цикл крутится вхолостую, ничего не пишем
//!
//! Запись в БД идёт синхронно через захваченный на итерацию лок: для локального
//! одно-поточного трекера этого достаточно (запись — редкая, раз в секунду при
//! смене окна, и тривиальная).

pub mod browser;
pub mod idle;
pub mod window;

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::db::{self, models::Activity};
use crate::state::AppState;

/// Сигнатура текущего интервала. Если меняется — закрываем интервал.
#[derive(Debug, Clone, PartialEq, Eq)]
struct IntervalKey {
    app_name: String,
    window_title: String,
    domain: Option<String>,
    is_idle: bool,
}

/// Открытый интервал (ещё не записанный в БД).
struct OpenInterval {
    key: IntervalKey,
    started_at: i64,
}

/// Текущее unix-время в мс.
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Запустить фоновый capture loop. Вызывается из setup().
pub fn spawn(state: Arc<AppState>, app_handle: tauri::AppHandle) {
    std::thread::spawn(move || run(state, app_handle));
}

fn run(state: Arc<AppState>, _app_handle: tauri::AppHandle) {
    log::info!("capture engine started");

    let mut current: Option<OpenInterval> = None;

    loop {
        // Конфиг может поменяться через настройки — перечитываем каждый цикл.
        // Дёшево: одна быстрая SELECT.
        let cfg = {
            let c = state.config.lock().expect("config mutex poisoned");
            c.clone()
        };

        let sleep = Duration::from_millis(cfg.sample_interval_ms.max(200));

        if !cfg.tracking_enabled {
            // На паузе: закрываем текущий интервал (если был), спим.
            if let Some(open) = current.take() {
                flush(&state.db, &open, now_ms());
            }
            std::thread::sleep(sleep);
            continue;
        }

        // Снимок текущего состояния.
        let now = now_ms();
        let idle = idle::is_idle(cfg.idle_threshold_ms);

        let key = match window::current_foreground() {
            Some(snap) => {
                // Пробуем определить браузер и достать домен.
                let (domain, url_field) = match browser::detect(&snap.app_name) {
                    Some(_b) => {
                        let parsed = browser::parse_title(&snap.window_title);
                        (parsed.domain, parsed.url)
                    }
                    None => (None, None),
                };
                let _ = url_field; // URL пока не храним отдельно от title — Фаза 1+
                IntervalKey {
                    app_name: snap.app_name.clone(),
                    window_title: snap.window_title.clone(),
                    domain,
                    is_idle: idle,
                }
            }
            None => IntervalKey {
                app_name: "(unknown)".to_string(),
                window_title: String::new(),
                domain: None,
                is_idle: idle,
            },
        };

        match &current {
            Some(open) if open.key == key => {
                // Тот же сигнал — интервал продолжается. Ничего не делаем.
            }
            _ => {
                // Сигнал сменился: закрываем старый, открываем новый.
                if let Some(open) = current.take() {
                    flush(&state.db, &open, now);
                }
                current = Some(OpenInterval {
                    key: key.clone(),
                    started_at: now,
                });
            }
        }

        std::thread::sleep(sleep);
    }
}

/// Закрыть и записать интервал в БД.
fn flush(db: &Mutex<Connection>, open: &OpenInterval, ended_at: i64) {
    // Игнорируем слишком короткие (< 1s) — это шум переключений.
    if ended_at - open.started_at < 1000 {
        return;
    }

    let activity = Activity::new(
        open.started_at,
        ended_at,
        open.key.app_name.clone(),
        if open.key.window_title.is_empty() {
            None
        } else {
            Some(open.key.window_title.clone())
        },
        // browser/idle-детали пока опускаем — Фаза 1+. Достаточно app+title+domain.
        None,
        None,
        open.key.domain.clone(),
        None,
        open.key.is_idle,
    );

    if let Err(e) = db::with_conn(db, |c| db::insert_activity(c, &activity)) {
        log::warn!("failed to insert activity: {e}");
    }
}
