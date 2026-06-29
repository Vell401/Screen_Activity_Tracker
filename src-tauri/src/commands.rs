//! Tauri-команды — API, доступное из React через invoke().
//! Контракт зеркален src/lib/tauri.ts.
//!
//! Все команды принимают `State<'_, Arc<AppState>>`: тот же Arc, что отдаётся
//! в `app.manage()` и клонируется в capture loop. Так один `Mutex<Connection>`
//! разделяется между запросами UI и фоновым потоком записи.

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_dialog::DialogExt;

use crate::db::{self, models::*};
use crate::settings;
use crate::state::AppState;

/// Достать ссылку на соединение из state.
fn conn<'r>(state: &'r State<'_, Arc<AppState>>) -> &'r Mutex<Connection> {
    &state.db
}

// ----- activities ----------------------------------------------------------

#[tauri::command]
pub fn get_activities(
    filters: ActivityFilters,
    state: State<'_, Arc<AppState>>,
) -> Vec<Activity> {
    db::with_conn(conn(&state), |c| db::query_activities(c, &filters))
        .unwrap_or_default()
}

#[tauri::command]
pub fn get_summary(
    range: DateRange,
    group_by: SummaryGroupBy,
    state: State<'_, Arc<AppState>>,
) -> Vec<SummaryBucket> {
    db::with_conn(conn(&state), |c| {
        db::query_summary(c, range.from, range.to, &group_by)
    })
    .unwrap_or_default()
}

/// Суммарные показатели за диапазон (KPI дашборда) — агрегируются в SQL.
#[tauri::command]
pub fn get_range_stats(range: DateRange, state: State<'_, Arc<AppState>>) -> RangeStats {
    db::with_conn(conn(&state), |c| db::query_range_stats(c, range.from, range.to)).unwrap_or(
        RangeStats {
            total_ms: 0,
            idle_ms: 0,
            intervals: 0,
        },
    )
}

/// Бакеты таймлайна (по часам/дням, с разбивкой по категориям) — агрегируются в SQL.
#[tauri::command]
pub fn get_timeline(
    range: DateRange,
    hourly: bool,
    state: State<'_, Arc<AppState>>,
) -> Vec<TimelineBucket> {
    db::with_conn(conn(&state), |c| {
        db::query_timeline(c, range.from, range.to, hourly)
    })
    .unwrap_or_default()
}

// ----- category rules ------------------------------------------------------

#[tauri::command]
pub fn list_category_rules(state: State<'_, Arc<AppState>>) -> Vec<CategoryRule> {
    db::with_conn(conn(&state), |c| db::list_rules(c)).unwrap_or_default()
}

#[tauri::command]
pub fn upsert_category_rule(
    rule: CategoryRule,
    state: State<'_, Arc<AppState>>,
) -> CategoryRule {
    let saved = db::with_conn(conn(&state), |c| db::upsert_rule(c, &rule)).unwrap_or(rule);
    // Правила изменились — пересчитываем категории всех записей.
    let _ = db::with_conn(conn(&state), |c| db::recategorize_all_and_mark(c));
    saved
}

#[tauri::command]
pub fn delete_category_rule(id: i64, state: State<'_, Arc<AppState>>) {
    let _ = db::with_conn(conn(&state), |c| db::delete_rule(c, id));
    let _ = db::with_conn(conn(&state), |c| db::recategorize_all_and_mark(c));
}

// ----- settings ------------------------------------------------------------

#[tauri::command]
pub fn get_settings(state: State<'_, Arc<AppState>>) -> Vec<SettingEntry> {
    db::with_conn(conn(&state), |c| db::list_settings(c)).unwrap_or_default()
}

#[tauri::command]
pub fn update_settings(entries: Vec<SettingEntry>, state: State<'_, Arc<AppState>>) {
    let _ = db::with_conn(conn(&state), |c| {
        for e in &entries {
            db::set_setting(c, &e.key, &e.value)?;
        }
        Ok(())
    });
    // Перечитываем конфиг, чтобы capture loop подхватил новые значения.
    let new_cfg = settings::load_config(conn(&state));
    *state.config.lock().expect("config mutex poisoned") = new_cfg;
}

#[tauri::command]
pub fn set_tracking_enabled(enabled: bool, state: State<'_, Arc<AppState>>) {
    settings::set_tracking_enabled(conn(&state), enabled);
    let mut cfg = state.config.lock().expect("config mutex poisoned");
    cfg.tracking_enabled = enabled;
}

// ----- live / обслуживание ------------------------------------------------

/// Текущая активность (живой снимок) — для виджета «Сейчас».
#[tauri::command]
pub fn get_current_activity(state: State<'_, Arc<AppState>>) -> CurrentActivity {
    let cfg = state.config.lock().expect("config mutex poisoned").clone();
    let idle = crate::capture::idle::is_idle(cfg.idle_threshold_ms);
    let now = crate::bridge::now_ms();

    match crate::capture::window::current_foreground() {
        Some(snap) => {
            let (domain, url, browser) = match crate::capture::browser::detect(&snap.app_name) {
                Some(b) => {
                    let mut domain = None;
                    let mut url = None;
                    let hb_path = crate::bridge::heartbeat_path(&state.data_dir);
                    if let Some(hb) = crate::bridge::read(&hb_path) {
                        if hb.kind == "active" && now - hb.ts < 10_000 {
                            if let Some(u) = hb.url {
                                domain = crate::capture::browser::url_domain(&u);
                                url = Some(u);
                            }
                        }
                    }
                    if domain.is_none() {
                        let parsed = crate::capture::browser::parse_title(&snap.window_title);
                        domain = parsed.domain;
                        url = url.or(parsed.url);
                    }
                    (domain, url, Some(b.as_str().to_string()))
                }
                None => (None, None, None),
            };

            let category_name = db::with_conn(conn(&state), |c| {
                match db::find_category_id(c, &snap.app_name, domain.as_deref())? {
                    Some(id) => db::category_name(c, id),
                    None => Ok(None),
                }
            })
            .ok()
            .flatten();

            CurrentActivity {
                app_name: snap.app_name,
                window_title: if snap.window_title.is_empty() {
                    None
                } else {
                    Some(snap.window_title)
                },
                domain,
                url,
                browser,
                is_idle: idle,
                category_name,
                tracking_enabled: cfg.tracking_enabled,
            }
        }
        None => CurrentActivity {
            app_name: "(нет активного окна)".to_string(),
            window_title: None,
            domain: None,
            url: None,
            browser: None,
            is_idle: idle,
            category_name: None,
            tracking_enabled: cfg.tracking_enabled,
        },
    }
}

/// Сведения о хранилище данных.
#[tauri::command]
pub fn get_db_info(state: State<'_, Arc<AppState>>) -> DbInfo {
    let path = state.db_path.clone();
    let size_bytes = std::fs::metadata(&path).map(|m| m.len() as i64).unwrap_or(0);
    let (activity_count, rule_count, oldest_ms) =
        db::with_conn(conn(&state), |c| db::db_stats(c)).unwrap_or((0, 0, None));
    DbInfo {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        activity_count,
        rule_count,
        oldest_ms,
    }
}

/// Удалить всю накопленную активность.
#[tauri::command]
pub fn clear_activities(state: State<'_, Arc<AppState>>) {
    let _ = db::with_conn(conn(&state), |c| db::clear_activities(c));
}

/// Принудительно пересчитать категории по текущим правилам.
#[tauri::command]
pub fn recategorize(state: State<'_, Arc<AppState>>) {
    let _ = db::with_conn(conn(&state), |c| db::recategorize_all_and_mark(c));
}

// ----- система: трей, автозапуск, путь к БД --------------------------------

/// Прятать ли окно в трей при закрытии (вместо полного выхода).
#[tauri::command]
pub fn get_minimize_to_tray(state: State<'_, Arc<AppState>>) -> bool {
    state.minimize_to_tray.load(Ordering::Relaxed)
}

/// Включить/выключить сворачивание в трей при закрытии.
#[tauri::command]
pub fn set_minimize_to_tray(enabled: bool, state: State<'_, Arc<AppState>>) {
    state.minimize_to_tray.store(enabled, Ordering::Relaxed);
    let v = if enabled { "true" } else { "false" };
    let _ = db::with_conn(conn(&state), |c| {
        db::set_setting(c, settings::KEY_MINIMIZE_TO_TRAY, v)
    });
}

/// Включён ли автозапуск приложения вместе с Windows.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Включить/выключить автозапуск приложения вместе с Windows.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

/// Диалог выбора папки для файла БД. При выборе: чекпойнт WAL, копирование
/// текущей БД в новую папку, сохранение пути в db_location.txt и перезапуск
/// приложения (после рестарта БД откроется уже по новому пути).
#[tauri::command]
pub fn choose_db_location(app: AppHandle, state: State<'_, Arc<AppState>>) {
    let app2 = app.clone();
    let st = state.inner().clone();
    app.dialog().file().pick_folder(move |folder| {
        let Some(folder) = folder else { return };
        let folder = match folder.into_path() {
            Ok(p) => p,
            Err(_) => return,
        };
        let target = folder.join("screen_activity.db");

        // Держим лок БД на всё: чекпойнт → копия → запись пути → рестарт. Иначе
        // capture-поток мог бы записать в СТАРУЮ БД уже после копирования, и эти
        // интервалы потерялись бы после открытия новой.
        let Ok(c) = st.db.lock() else { return };
        let _ = c.pragma_update(None, "wal_checkpoint", "TRUNCATE");
        if st.db_path != target {
            if let Some(parent) = target.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Err(e) = std::fs::copy(&st.db_path, &target) {
                log::error!("копирование БД не удалось: {e}");
                return;
            }
        }
        if let Err(e) = std::fs::write(
            st.data_dir.join("db_location.txt"),
            target.to_string_lossy().as_bytes(),
        ) {
            log::error!("запись db_location.txt не удалась: {e}");
            return;
        }
        // Лок ещё удерживается (c живёт до конца замыкания) — capture не запишет
        // в старую БД до выхода процесса.
        let _ = &c;
        app2.restart();
    });
}

// ----- браузерное расширение ----------------------------------------------

/// Статус браузерного расширения (локальный сервер + подключение).
#[tauri::command]
pub fn get_extension_status(state: State<'_, Arc<AppState>>) -> crate::extension::ExtensionStatus {
    crate::extension::status(&state)
}

/// Выгрузить файлы расширения в папку рядом с БД и открыть её в проводнике.
/// Возвращает путь к папке.
#[tauri::command]
pub fn export_extension(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    // Папка назначения — рядом с файлом БД (стабильное место, а не «Загрузки»):
    // пользователю не нужно никуда перекладывать, расширение грузится распакованным
    // прямо отсюда. Откат на app_data_dir, если у БД почему-то нет родителя.
    let base = state
        .db_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| state.data_dir.clone());
    let dest = base.join("SAT-Browser-Extension");

    let path = crate::extension::export(&dest).map_err(|e| e.to_string())?;
    let path_str = path.to_string_lossy().to_string();

    // Открываем папку в проводнике (необязательно — игнорируем ошибку).
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(&path_str).spawn();
    }

    Ok(path_str)
}

// ----- иконки приложений ---------------------------------------------------

/// Получить запись об иконке для конкретного приложения.
/// Возвращает None, если иконка ещё не закеширована (UI использует fallback).
#[tauri::command]
pub fn get_app_icon(
    app_name: String,
    state: State<'_, Arc<AppState>>,
) -> Option<db::AppIcon> {
    let norm = crate::icons::normalize_app_name(&app_name);
    db::with_conn(conn(&state), |c| db::get_app_icon(c, &norm)).ok().flatten()
}

/// Bulk-вариант для UI: передаём массив имён, получаем словарь имя → AppIcon.
/// Имена, для которых иконок нет, просто отсутствуют в ответе.
#[tauri::command]
pub fn get_app_icons(
    app_names: Vec<String>,
    state: State<'_, Arc<AppState>>,
) -> Vec<db::AppIcon> {
    let norm: Vec<String> = app_names
        .iter()
        .map(|n| crate::icons::normalize_app_name(n))
        .filter(|n| !n.is_empty())
        .collect();
    db::with_conn(conn(&state), |c| db::get_app_icons_bulk(c, &norm))
        .unwrap_or_default()
}

/// Принудительно извлечь (или пере-извлечь) иконку для указанного имени.
/// Запускается синхронно и возвращает запись AppIcon или None при неудаче.
/// Используется вручную из UI (Settings/Диагностика), если автоматическое
/// извлечение не сработало.
#[tauri::command]
pub fn ensure_app_icon(
    app_name: String,
    state: State<'_, Arc<AppState>>,
) -> Option<db::AppIcon> {
    let norm = crate::icons::normalize_app_name(&app_name);
    if norm.is_empty() || norm.starts_with("pid:") || norm == "(unknown)" {
        return None;
    }

    // Сначала пробуем найти путь через текущий снимок активного окна.
    let path = crate::capture::window::current_foreground()
        .and_then(|s| {
            let sm = crate::icons::normalize_app_name(&s.app_name);
            if sm == norm {
                s.exe_path
            } else {
                None
            }
        })
        .or_else(|| crate::capture::window::find_running_exe_path(&norm));

    let path = path?;
    let icon = crate::icons::extract_from_exe(std::path::Path::new(&path), 32)?;

    let hash = crate::icons::sha256_hex(&icon.png);
    let _ = crate::icons::write_to_disk(&state.data_dir, &hash, &icon.png);

    let rec = db::AppIcon {
        app_name: norm.clone(),
        icon_hash: hash,
        source: "exe".to_string(),
        width: icon.width as i64,
        updated_at: crate::bridge::now_ms(),
    };
    let _ = db::with_conn(conn(&state), |c| db::upsert_app_icon(c, &rec));
    Some(rec)
}

/// Прочитать PNG-файл иконки и вернуть data URL.
/// Просто формат: `data:image/png;base,<base64>`. Удобно для <img src>.
/// Если иконки нет — возвращает None (UI использует fallback-глиф/монограмму).
#[tauri::command]
pub fn get_app_icon_data(
    app_name: String,
    state: State<'_, Arc<AppState>>,
) -> Option<String> {
    let norm = crate::icons::normalize_app_name(&app_name);
    let rec = db::with_conn(conn(&state), |c| db::get_app_icon(c, &norm))
        .ok()
        .flatten()?;
    let path = crate::icons::icon_path(&state.data_dir, &rec.icon_hash);
    let bytes = std::fs::read(&path).ok()?;
    // base64 encode без внешних крейтов.
    Some(format!(
        "data:image/png;base64,{}",
        base64_encode(&bytes)
    ))
}

/// Простой base64-кодер (без внешних зависимостей).
fn base64_encode(input: &[u8]) -> String {
    const ALPH: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | (input[i + 2] as u32);
        out.push(ALPH[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPH[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPH[((n >> 6) & 0x3f) as usize] as char);
        out.push(ALPH[(n & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(ALPH[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPH[((n >> 12) & 0x3f) as usize] as char);
        out.push('=');
        out.push('=');
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        out.push(ALPH[((n >> 18) & 0x3f) as usize] as char);
        out.push(ALPH[((n >> 12) & 0x3f) as usize] as char);
        out.push(ALPH[((n >> 6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}
