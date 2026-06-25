//! Tauri-команды — API, доступное из React через invoke().
//! Контракт зеркален src/lib/tauri.ts.
//!
//! Все команды принимают `State<'_, Arc<AppState>>`: тот же Arc, что отдаётся
//! в `app.manage()` и клонируется в capture loop. Так один `Mutex<Connection>`
//! разделяется между запросами UI и фоновым потоком записи.

use std::sync::{Arc, Mutex};

use rusqlite::Connection;
use tauri::State;

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
    db::with_conn(conn(&state), |c| db::upsert_rule(c, &rule))
        .unwrap_or(rule)
}

#[tauri::command]
pub fn delete_category_rule(id: i64, state: State<'_, Arc<AppState>>) {
    let _ = db::with_conn(conn(&state), |c| db::delete_rule(c, id));
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
