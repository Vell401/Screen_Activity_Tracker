//! Слой доступа к данным: инициализация соединения, миграции, запросы.
//!
//! Соединение хранится под `Mutex<Connection>` в `AppState` (один писатель за раз).
//! Capture engine пишет через эту же connection — для локального одно-поточного
//! трекинга этого достаточно; пессимистичных блокировок практически не возникает.

pub mod models;

use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::models::{Activity, ActivityFilters, CategoryRule, SettingEntry, SummaryBucket, SummaryGroupBy};

/// Текст схемы из schema.sql, встроенный в бинарник через include_str!.
const SCHEMA_SQL: &str = include_str!("schema.sql");

/// Значения по умолчанию для таблицы settings.
/// Применяются при первом старте (INSERT OR IGNORE — не перезаписывают пользовательские).
const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("sample_interval_ms", "1000"),
    ("idle_threshold_ms", "60000"),
    ("tracking_enabled", "true"),
    ("db_schema_version", "1"),
];

/// Предзаполненные правила категорий (только при пустой таблице).
/// Зеркало: Telegram -> Мессенджеры, IDE -> Разработка, и т.д.
const SEED_RULES: &[(&str, &str, &str, &str)] = &[
    // (name, match_type, pattern, color)
    ("Мессенджеры", "app", "Telegram", "#5a9ff5"),
    ("Мессенджеры", "domain", "telegram.org", "#5a9ff5"),
    ("Мессенджеры", "domain", "web.telegram.org", "#5a9ff5"),
    ("Разработка", "domain_suffix", "jetbrains.com", "#f55a5a"),
    ("Разработка", "domain", "github.com", "#f55a5a"),
    ("Разработка", "app", "Code.exe", "#f55a5a"),
    ("Развлечения", "domain", "youtube.com", "#f5a535"),
    ("Развлечения", "domain_suffix", "steampowered.com", "#f5a535"),
];

/// Открыть/создать БД и применить миграции.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // Небольшая производительность: WAL лучше для mix read/write.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn)?;
    seed_defaults(&conn)?;
    Ok(conn)
}

fn apply_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

fn seed_defaults(conn: &Connection) -> rusqlite::Result<()> {
    // Настройки — INSERT OR IGNORE (не трогаем существующие).
    for (k, v) in DEFAULT_SETTINGS {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![k, v],
        )?;
    }

    // Правила категорий — только если таблица пуста.
    let count: i64 =
        conn.query_row("SELECT COUNT(*) FROM category_rules", [], |r| r.get(0))?;
    if count == 0 {
        let mut stmt = conn.prepare(
            "INSERT INTO category_rules (name, match_type, pattern, color, priority)
             VALUES (?1, ?2, ?3, ?4, 0)",
        )?;
        for (name, mt, pattern, color) in SEED_RULES {
            stmt.execute(rusqlite::params![name, mt, pattern, color])?;
        }
    }
    Ok(())
}

// ----- queries: activities -------------------------------------------------

/// Вставить один интервал активности. Возвращает его id.
pub fn insert_activity(conn: &Connection, a: &Activity) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO activities
            (started_at, ended_at, duration_ms, app_name, window_title,
             browser, url, domain, category_id, is_idle)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            a.started_at,
            a.ended_at,
            a.duration_ms,
            a.app_name,
            a.window_title,
            a.browser,
            a.url,
            a.domain,
            a.category_id,
            a.is_idle as i64,
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// Получить активности с фильтрами (LEFT JOIN категорий — чтобы забрать имя).
pub fn query_activities(
    conn: &Connection,
    f: &ActivityFilters,
) -> rusqlite::Result<Vec<Activity>> {
    let mut sql = String::from(
        "SELECT a.id, a.started_at, a.ended_at, a.duration_ms,
                a.app_name, a.window_title, a.browser, a.url, a.domain,
                a.category_id, cr.name, a.is_idle
         FROM activities a
         LEFT JOIN category_rules cr ON cr.id = a.category_id
         WHERE 1=1",
    );
    let mut params: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(from) = f.from {
        sql.push_str(" AND a.ended_at >= ?");
        params.push(from.into());
    }
    if let Some(to) = f.to {
        sql.push_str(" AND a.started_at <= ?");
        params.push(to.into());
    }
    if let Some(ref app) = f.app_name {
        sql.push_str(" AND a.app_name = ?");
        params.push(app.clone().into());
    }
    if let Some(ref domain) = f.domain {
        sql.push_str(" AND a.domain = ?");
        params.push(domain.clone().into());
    }
    if let Some(cat) = f.category_id {
        sql.push_str(" AND a.category_id = ?");
        params.push(cat.into());
    }
    if let Some(idle) = f.is_idle {
        sql.push_str(" AND a.is_idle = ?");
        params.push((idle as i64).into());
    }
    sql.push_str(" ORDER BY a.started_at DESC LIMIT 5000");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |r| {
        Ok(Activity {
            id: r.get(0)?,
            started_at: r.get(1)?,
            ended_at: r.get(2)?,
            duration_ms: r.get(3)?,
            app_name: r.get(4)?,
            window_title: r.get(5)?,
            browser: r.get(6)?,
            url: r.get(7)?,
            domain: r.get(8)?,
            category_id: r.get(9)?,
            category_name: r.get(10)?,
            is_idle: r.get::<_, i64>(11)? != 0,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Агрегированная сводка для дашборда.
pub fn query_summary(
    conn: &Connection,
    from: i64,
    to: i64,
    group_by: &SummaryGroupBy,
) -> rusqlite::Result<Vec<SummaryBucket>> {
    // Какую колонку группируем.
    let key_expr = match group_by {
        SummaryGroupBy::App => "a.app_name",
        SummaryGroupBy::Domain => "COALESCE(a.domain, a.app_name)",
        SummaryGroupBy::Category => "COALESCE(cr.name, 'Без категории')",
    };
    let sql = format!(
        "SELECT {key} AS k, SUM(a.duration_ms) AS total, COUNT(*) AS cnt, a.category_id
         FROM activities a
         LEFT JOIN category_rules cr ON cr.id = a.category_id
         WHERE a.ended_at >= ?1 AND a.started_at <= ?2
         GROUP BY k
         ORDER BY total DESC",
        key = key_expr
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![from, to], |r| {
        Ok(SummaryBucket {
            key: r.get(0)?,
            total_ms: r.get(1)?,
            count: r.get(2)?,
            category_id: r.get(3)?,
        })
    })?;

    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

// ----- queries: category_rules --------------------------------------------

pub fn list_rules(conn: &Connection) -> rusqlite::Result<Vec<CategoryRule>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, match_type, pattern, color, priority
         FROM category_rules ORDER BY priority DESC, name ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryRule {
            id: Some(r.get(0)?),
            name: r.get(1)?,
            match_type: r.get(2)?,
            pattern: r.get(3)?,
            color: r.get(4)?,
            priority: r.get(5)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Вставить новое или обновить существующее правило (по id).
pub fn upsert_rule(conn: &Connection, r: &CategoryRule) -> rusqlite::Result<CategoryRule> {
    match r.id {
        Some(id) => {
            conn.execute(
                "UPDATE category_rules
                 SET name=?1, match_type=?2, pattern=?3, color=?4, priority=?5
                 WHERE id=?6",
                rusqlite::params![r.name, r.match_type, r.pattern, r.color, r.priority, id],
            )?;
            let mut out = r.clone();
            out.id = Some(id);
            Ok(out)
        }
        None => {
            conn.execute(
                "INSERT INTO category_rules (name, match_type, pattern, color, priority)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![r.name, r.match_type, r.pattern, r.color, r.priority],
            )?;
            let mut out = r.clone();
            out.id = Some(conn.last_insert_rowid());
            Ok(out)
        }
    }
}

pub fn delete_rule(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM category_rules WHERE id=?1", rusqlite::params![id])?;
    Ok(())
}

// ----- queries: settings ---------------------------------------------------

pub fn list_settings(conn: &Connection) -> rusqlite::Result<Vec<SettingEntry>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt.query_map([], |r| {
        Ok(SettingEntry {
            key: r.get(0)?,
            value: r.get(1)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

pub fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let res: rusqlite::Result<String> =
        conn.query_row("SELECT value FROM settings WHERE key=?1", [key], |r| r.get(0));
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// Удобная обёртка: достаёт соединение из Mutex, захватив лок на вызов.
pub fn with_conn<R>(
    lock: &Mutex<Connection>,
    f: impl FnOnce(&Connection) -> rusqlite::Result<R>,
) -> rusqlite::Result<R> {
    let conn = lock.lock().expect("DB mutex poisoned");
    f(&conn)
}
