//! Capture engine: фоновый поток опроса активного окна.
//!
//! Логика:
//!   - каждые `sample_interval_ms` (по умолчанию 5000) делаем снимок окна;
//!   - если окно/idle/домен/URL изменились — закрываем текущий интервал, пишем
//!     в БД (с категорией), открываем новый;
//!   - если в фокусе браузер — предпочитаем точный URL/домен из heartbeat
//!     расширения (см. [`crate::bridge`]); иначе fallback на парсинг заголовка;
//!   - если tracking_enabled=false — цикл крутится вхолостую, ничего не пишем;
//!   - при первом появлении нового app_name запускается фоновое извлечение
//!     иконки (см. [`crate::icons`]) — результат попадает в `app_icons` и
//!     кеш-PNG в `data_dir/icons/<hash>.png`.
//!
//! Запись в БД идёт синхронно через захваченный на итерацию лок: для локального
//! одно-поточного трекера этого достаточно (запись редкая, при смене окна).

pub mod browser;
pub mod idle;
pub mod window;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;

use crate::bridge;
use crate::db::{self, models::Activity};
use crate::icons;
use crate::state::AppState;

/// Если heartbeat расширения старше этого — данным не доверяем (вкладка устарела).
const HEARTBEAT_FRESH_MS: i64 = 10_000;

/// Сигнатура текущего интервала. Если меняется — закрываем интервал.
#[derive(Debug, Clone, PartialEq, Eq)]
struct IntervalKey {
    app_name: String,
    window_title: String,
    domain: Option<String>,
    url: Option<String>,
    browser: Option<String>,
    is_idle: bool,
}

/// Открытый интервал (ещё не записанный в БД). Живёт в AppState, чтобы его можно
/// было сбросить при выходе приложения (см. [`flush_open_interval`]).
pub(crate) struct OpenInterval {
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

    let hb_path = bridge::heartbeat_path(&state.data_dir);

    loop {
        // Конфиг может поменяться через настройки — перечитываем каждый цикл.
        let cfg = {
            let c = state.config.lock().expect("config mutex poisoned");
            c.clone()
        };

        let sleep = std::time::Duration::from_millis(cfg.sample_interval_ms.max(200));

        if !cfg.tracking_enabled {
            // На паузе: закрываем текущий интервал (если был), спим.
            flush_open_interval(&state);
            std::thread::sleep(sleep);
            continue;
        }

        // Снимок текущего состояния.
        let now = now_ms();
        let idle = idle::is_idle(cfg.idle_threshold_ms);

        let key = match window::current_foreground() {
            Some(snap) => {
                // Сохраняем путь для возможного извлечения иконки.
                let exe_path = snap.exe_path.clone();

                let (domain, url, browser_str, media_playing) = match browser::detect(&snap.app_name) {
                    Some(b) => resolve_browser(&hb_path, now, &snap.window_title, b),
                    None => (None, None, None, false),
                };

                // Если в фокусе — это новое приложение (или мы его ещё не
                // закешировали) — запускаем фоновое извлечение иконки.
                maybe_extract_icon(&state, &snap.app_name, exe_path.as_deref());

                IntervalKey {
                    app_name: snap.app_name,
                    window_title: snap.window_title,
                    domain,
                    url,
                    browser: browser_str,
                    // Воспроизводимое видео — явный пользовательский сигнал
                    // от расширения; считаем его активным, даже если мышь и
                    // клавиатура не двигались дольше idle-порога.
                    is_idle: idle && !media_playing,
                }
            }
            None => IntervalKey {
                app_name: "(unknown)".to_string(),
                window_title: String::new(),
                domain: None,
                url: None,
                browser: None,
                is_idle: idle,
            },
        };

        // Сигнал сменился — закрываем старый интервал, открываем новый. Открытый
        // интервал хранится в AppState (его сбросит flush_open_interval на выходе).
        // Лок open_interval отпускаем ДО записи в БД (flush лочит state.db).
        let to_flush = {
            let mut cur = state
                .open_interval
                .lock()
                .expect("open_interval mutex poisoned");
            let same = matches!(&*cur, Some(open) if open.key == key);
            if same {
                None
            } else {
                let old = cur.take();
                *cur = Some(OpenInterval { key, started_at: now });
                old
            }
        };
        if let Some(open) = to_flush {
            flush(&state.db, &open, now);
        }

        std::thread::sleep(sleep);
    }
}

/// Сбросить открытый интервал в БД. Вызывается из capture loop (на паузе) и при
/// выходе приложения (`RunEvent::Exit`), чтобы не терять последний сегмент.
/// Лок open_interval отпускаем до записи в БД, чтобы не держать два лока сразу.
pub(crate) fn flush_open_interval(state: &AppState) {
    let open = match state.open_interval.lock() {
        Ok(mut cur) => cur.take(),
        Err(_) => return,
    };
    if let Some(open) = open {
        flush(&state.db, &open, now_ms());
    }
}

/// Определить (домен, url, имя_браузера) для активного окна-браузера.
/// Приоритет — свежий heartbeat расширения, fallback — парсинг заголовка.
fn resolve_browser(
    hb_path: &Path,
    now: i64,
    title: &str,
    b: browser::Browser,
) -> (Option<String>, Option<String>, Option<String>, bool) {
    let name = Some(b.as_str().to_string());

    if let Some(hb) = bridge::read(hb_path) {
        // Доверяем heartbeat только если он свежий: age в [0, FRESH).
        // age >= 0 защищает от обратного скачка системных часов (иначе
        // отрицательный age проходил бы как «свежий» и привязал бы устаревший URL).
        let age = now - hb.ts;
        if (0..HEARTBEAT_FRESH_MS).contains(&age) {
            if hb.kind == "active" {
                if let Some(url) = hb.url.as_deref() {
                    let domain = browser::url_domain(url);
                    if domain.is_some() {
                        return (domain, Some(url.to_string()), name, hb.media_playing);
                    }
                }
            } else {
                // Свежий blur/idle — активной вкладки нет: не приписываем
                // устаревший URL/домен и не парсим заголовок.
                return (None, None, name, false);
            }
        }
    }

    // Нет свежего heartbeat — fallback на парсинг заголовка вкладки.
    let parsed = browser::parse_title(title);
    (parsed.domain, parsed.url, name, false)
}

/// Закрыть и записать интервал в БД (с категорией).
fn flush(db: &Mutex<Connection>, open: &OpenInterval, ended_at: i64) {
    // Игнорируем слишком короткие (< 1s) — это шум переключений.
    if ended_at - open.started_at < 1000 {
        return;
    }

    let k = &open.key;

    // Категория по правилам (на момент записи).
    let category_id = db::with_conn(db, |c| {
        db::find_category_id(c, &k.app_name, k.domain.as_deref())
    })
    .ok()
    .flatten();

    let activity = Activity::new(
        open.started_at,
        ended_at,
        k.app_name.clone(),
        if k.window_title.is_empty() {
            None
        } else {
            Some(k.window_title.clone())
        },
        k.browser.clone(),
        k.url.clone(),
        k.domain.clone(),
        category_id,
        k.is_idle,
    );

    if let Err(e) = db::with_conn(db, |c| db::insert_activity(c, &activity)) {
        log::warn!("failed to insert activity: {e}");
    }
}

/// Запустить фоновое извлечение иконки для приложения, если её ещё нет в кеше.
/// Не блокирует capture loop: работает в отдельном потоке.
fn maybe_extract_icon(state: &Arc<AppState>, app_name: &str, exe_path: Option<&str>) {
    let name_norm = icons::normalize_app_name(app_name);
    if name_norm.is_empty() || name_norm.starts_with("pid:") || name_norm == "(unknown)" {
        return;
    }

    // Быстрая проверка: если уже закешировано — выходим.
    let already = db::with_conn(&state.db, |c| db::get_app_icon(c, &name_norm))
        .ok()
        .flatten();
    if already.is_some() {
        return;
    }

    // Если путь не дан (например, фокус на чём-то странном) — попробуем
    // найти запущенный процесс с таким именем.
    let path_owned: String;
    let path_ref: Option<&str> = match exe_path {
        Some(p) if !p.is_empty() => Some(p),
        _ => {
            path_owned = window::find_running_exe_path(&name_norm).unwrap_or_default();
            if path_owned.is_empty() {
                None
            } else {
                Some(&path_owned)
            }
        }
    };

    let Some(path) = path_ref else { return };

    let state_clone = state.clone();
    let path_str = path.to_string();
    let app_name_norm = name_norm.clone();
    std::thread::spawn(move || {
        extract_and_store(&state_clone, &app_name_norm, std::path::Path::new(&path_str));
    });
}

/// Извлечь иконку из exe, сохранить на диск и в БД.
fn extract_and_store(state: &Arc<AppState>, app_name_norm: &str, exe_path: &Path) {
    let Some(icon) = icons::extract_from_exe(exe_path, 32) else {
        log::debug!("icon extraction failed for {app_name_norm}");
        return;
    };

    let hash = icons::sha256_hex(&icon.png);
    if let Err(e) = icons::write_to_disk(&state.data_dir, &hash, &icon.png) {
        log::warn!("failed to write icon file: {e}");
        return;
    }

    let rec = db::AppIcon {
        app_name: app_name_norm.to_string(),
        icon_hash: hash,
        source: "exe".to_string(),
        width: icon.width as i64,
        updated_at: now_ms(),
    };

    if let Err(e) = db::with_conn(&state.db, |c| db::upsert_app_icon(c, &rec)) {
        log::warn!("failed to upsert app_icon: {e}");
    }
}
