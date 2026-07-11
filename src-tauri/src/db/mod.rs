//! Слой доступа к данным: инициализация соединения, миграции, запросы.
//!
//! Соединение хранится под `Mutex<Connection>` в `AppState` (один писатель за раз).
//! Capture engine пишет через эту же connection — для локального одно-поточного
//! трекинга этого достаточно; пессимистичных блокировок практически не возникает.

pub mod models;

use std::sync::Mutex;

use rusqlite::Connection;

use crate::db::models::{
    Activity, ActivityFilters, CategoryRule, RangeStats, SettingEntry, SummaryBucket,
    SummaryGroupBy, TimelineBucket,
};

/// Текст схемы из schema.sql, встроенный в бинарник через include_str!.
const SCHEMA_SQL: &str = include_str!("schema.sql");

/// Значения по умолчанию для таблицы settings.
/// Применяются при первом старте (INSERT OR IGNORE — не перезаписывают пользовательские).
const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("sample_interval_ms", "5000"),
    ("idle_threshold_ms", "180000"),
    ("tracking_enabled", "true"),
    ("minimize_to_tray", "true"),
    ("language", "en"),
    ("db_schema_version", "1"),
];

/// Предзаполненные правила категорий (только при пустой таблице).
/// Зеркало: Telegram -> Мессенджеры, IDE -> Разработка, и т.д.
// Категории совпадают с DEFAULT_CATEGORIES (i18n.ts), язык по умолчанию — английский.
// Только типы app/domain (тип domain_suffix из UI убран; в matching он ещё поддержан
// для legacy-правил, но новые/сидовые правила его не используют).
const SEED_RULES: &[(&str, &str, &str, &str)] = &[
    // (name, match_type, pattern, color)
    ("Browser", "app", "chrome.exe", "#00b0f4"),
    ("Browser", "app", "msedge.exe", "#00b0f4"),
    ("Browser", "app", "firefox.exe", "#00b0f4"),
    ("Browser", "app", "opera.exe", "#00b0f4"),
    ("Browser", "app", "brave.exe", "#00b0f4"),
    ("Browser", "app", "vivaldi.exe", "#00b0f4"),
    ("Development", "app", "Code.exe", "#f55a5a"),
    ("Development", "domain", "github.com", "#f55a5a"),
    ("Development", "domain", "stackoverflow.com", "#f55a5a"),
    ("Messengers", "app", "Telegram", "#5a9ff5"),
    ("Messengers", "app", "Discord", "#5a9ff5"),
    ("Messengers", "domain", "web.telegram.org", "#5a9ff5"),
    ("Design", "domain", "figma.com", "#eb459e"),
    ("AI", "domain", "claude.ai", "#7c83ff"),
    ("AI", "domain", "chatgpt.com", "#7c83ff"),
    ("Games", "app", "steam.exe", "#9b84ec"),
    ("Entertainment", "domain", "youtube.com", "#faa61a"),
    ("Work", "domain", "mail.google.com", "#5865f2"),
];

/// Открыть/создать БД и применить миграции.
pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    // Небольшая производительность: WAL лучше для mix read/write.
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn)?;
    migrate_legacy_favicon_keys(&conn)?;
    seed_defaults(&conn)?;
    // Пересчёт категорий только при изменении правил (гейт по сигнатуре) —
    // иначе на больших БД каждый старт делал бы дорогой UPDATE всех строк.
    recategorize_if_rules_changed(&conn)?;
    Ok(conn)
}

fn apply_migrations(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

/// Перенести favicon, сохранённые ранними версиями под «голым» доменом,
/// в пространство ключей `site:<домен>`.
///
/// Префикс отделяет доменные иконки от иконок процессов. Без этой миграции UI
/// уже запрашивает `site:youtube.com`, а прежняя запись `youtube.com` остаётся
/// недоступной, хотя файл иконки на диске существует. Новая запись имеет
/// приоритет: если она уже есть, legacy-копию просто удаляем.
fn migrate_legacy_favicon_keys(conn: &Connection) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare(
        "SELECT app_name, icon_hash, source, width, updated_at
         FROM app_icons
         WHERE source = 'favicon' AND app_name NOT LIKE 'site:%'",
    )?;
    let legacy = stmt
        .query_map([], |r| {
            Ok(AppIcon {
                app_name: r.get(0)?,
                icon_hash: r.get(1)?,
                source: r.get(2)?,
                width: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(stmt);

    for icon in legacy {
        let legacy_key = icon.app_name;
        conn.execute(
            "INSERT OR IGNORE INTO app_icons (app_name, icon_hash, source, width, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                format!("site:{legacy_key}"),
                icon.icon_hash,
                icon.source,
                icon.width,
                icon.updated_at,
            ],
        )?;
        conn.execute(
            "DELETE FROM app_icons WHERE app_name = ?1 AND source = 'favicon'",
            rusqlite::params![legacy_key],
        )?;
    }
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

/// Агрегированная сводка для дашборда (Top Apps/Domains, донат категорий).
/// Простой исключён (is_idle=0) — согласовано с KPI «Активное время» и
/// таймлайном, которые тоже считают только активное время. Иначе оставленное
/// открытым окно/вкладка во время ухода от ПК молча приплюсовывалось бы к его
/// показателям без какой-либо пометки (в отличие от бейджа «idle» в журнале).
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
    // INDEXED BY принудительно: для group_by=App у SQLite есть соблазн
    // сканировать через idx_activities_app целиком (это готовый порядок для
    // GROUP BY по app_name без временного B-tree) вместо того чтобы сузиться
    // по диапазону дат через idx_activities_ended — и этот выбор остаётся
    // неизменным даже после ANALYZE. Замерено на синтетических 500k строк за
    // год: без хинта — 600+ мс (скан всей таблицы) на любой диапазон, включая
    // "всё время"; с хинтом — 17-100 мс. Для Domain/Category такой соблазн не
    // возникает (их ключ — вычисляемое выражение, а не голая колонка с
    // отдельным индексом), там планировщик и без хинта уже выбирает
    // idx_activities_ended — так что хинт для них не меняет план (безопасно
    // применять к одному общему шаблону запроса на все три группировки).
    let sql = format!(
        "SELECT {key} AS k, SUM(a.duration_ms) AS total, COUNT(*) AS cnt, a.category_id
         FROM activities a INDEXED BY idx_activities_ended
         LEFT JOIN category_rules cr ON cr.id = a.category_id
         WHERE a.ended_at >= ?1 AND a.started_at <= ?2 AND a.is_idle = 0
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

/// Суммарные показатели за диапазон (KPI дашборда). Считаем в SQL — без выгрузки
/// строк, поэтому корректно и дёшево даже на сотнях тысяч интервалов.
pub fn query_range_stats(conn: &Connection, from: i64, to: i64) -> rusqlite::Result<RangeStats> {
    conn.query_row(
        "SELECT COALESCE(SUM(duration_ms), 0),
                COALESCE(SUM(CASE WHEN is_idle = 1 THEN duration_ms ELSE 0 END), 0),
                COUNT(*)
         FROM activities
         WHERE ended_at >= ?1 AND started_at <= ?2",
        rusqlite::params![from, to],
        |r| {
            Ok(RangeStats {
                total_ms: r.get(0)?,
                idle_ms: r.get(1)?,
                intervals: r.get(2)?,
            })
        },
    )
}

/// Бакеты таймлайна (активное время) по часам или дням, с разбивкой по
/// категориям. Локальные границы суток считает SQLite (strftime ... 'localtime'),
/// без выгрузки сырых строк — корректно и компактно на любых диапазонах.
pub fn query_timeline(
    conn: &Connection,
    from: i64,
    to: i64,
    hourly: bool,
) -> rusqlite::Result<Vec<TimelineBucket>> {
    let bucket_expr = if hourly {
        "strftime('%H', a.started_at / 1000, 'unixepoch', 'localtime')"
    } else {
        "strftime('%Y-%m-%d', a.started_at / 1000, 'unixepoch', 'localtime')"
    };
    let sql = format!(
        "SELECT {bucket} AS b, COALESCE(cr.name, '') AS cat, SUM(a.duration_ms) AS ms
         FROM activities a
         LEFT JOIN category_rules cr ON cr.id = a.category_id
         WHERE a.ended_at >= ?1 AND a.started_at <= ?2 AND a.is_idle = 0
         GROUP BY b, cat",
        bucket = bucket_expr
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params![from, to], |r| {
        Ok(TimelineBucket {
            bucket: r.get(0)?,
            category: r.get(1)?,
            ms: r.get(2)?,
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

/// Имя категории (правила) по id.
pub fn category_name(conn: &Connection, id: i64) -> rusqlite::Result<Option<String>> {
    let res: rusqlite::Result<String> = conn.query_row(
        "SELECT name FROM category_rules WHERE id=?1",
        rusqlite::params![id],
        |r| r.get(0),
    );
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Подобрать id правила-категории для (app_name, domain) по приоритету.
/// Возвращает первое (наивысшего приоритета) сматчившееся правило.
pub fn find_category_id(
    conn: &Connection,
    app_name: &str,
    domain: Option<&str>,
) -> rusqlite::Result<Option<i64>> {
    let rules = list_rules(conn)?; // priority DESC, name ASC
    let app_l = app_name.to_ascii_lowercase();
    let dom_l = domain.map(|d| d.to_ascii_lowercase());

    for r in &rules {
        let pat = r.pattern.trim().to_ascii_lowercase();
        if pat.is_empty() {
            continue;
        }
        let hit = match r.match_type.as_str() {
            "app" => app_l.contains(&pat),
            "domain" => dom_l.as_deref() == Some(pat.as_str()),
            "domain_suffix" => match &dom_l {
                Some(d) => *d == pat || d.ends_with(&format!(".{pat}")),
                None => false,
            },
            _ => false,
        };
        if hit {
            return Ok(r.id);
        }
    }
    Ok(None)
}

/// Пересчитать category_id у всех строк activities по текущим правилам.
/// Применяем правила по возрастанию приоритета, чтобы высший приоритет
/// перезаписал низший (последним «выиграло» нужное правило).
pub fn recategorize_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("UPDATE activities SET category_id = NULL", [])?;

    // Порядок применения должен давать тот же итог, что и find_category_id
    // (priority DESC, name ASC, первое совпадение). Применяем по возрастанию
    // приоритета (высший — последним, перезаписывает) и name DESC (меньшее имя —
    // последним, выигрывает), чтобы последний UPDATE совпал с «первым» в live.
    let rules: Vec<(i64, String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, match_type, pattern FROM category_rules ORDER BY priority ASC, name DESC",
        )?;
        let mapped = stmt.query_map([], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?;
        mapped.filter_map(|x| x.ok()).collect()
    };

    for (id, mt, pattern) in rules {
        let pattern = pattern.trim().to_string();
        if pattern.is_empty() {
            continue;
        }
        match mt.as_str() {
            "app" => {
                conn.execute(
                    "UPDATE activities SET category_id=?1
                     WHERE instr(lower(app_name), lower(?2)) > 0",
                    rusqlite::params![id, pattern],
                )?;
            }
            "domain" => {
                conn.execute(
                    "UPDATE activities SET category_id=?1 WHERE lower(domain)=lower(?2)",
                    rusqlite::params![id, pattern],
                )?;
            }
            "domain_suffix" => {
                conn.execute(
                    "UPDATE activities SET category_id=?1
                     WHERE lower(domain)=lower(?2) OR lower(domain) LIKE '%.'||lower(?2)",
                    rusqlite::params![id, pattern],
                )?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// Сигнатура текущего набора правил — для гейта пересчёта категорий на старте.
fn rules_sig(conn: &Connection) -> rusqlite::Result<String> {
    let mut stmt = conn.prepare(
        "SELECT id, match_type, pattern, priority, name FROM category_rules ORDER BY id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(format!(
            "{}:{}:{}:{}:{}",
            r.get::<_, i64>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, i64>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut parts = Vec::new();
    for row in rows {
        parts.push(row?);
    }
    Ok(parts.join("\n"))
}

/// Пересчитать категории всех строк и запомнить текущую сигнатуру правил.
/// Зовётся командами при изменении правил, чтобы следующий старт не повторял
/// дорогой пересчёт зря.
pub fn recategorize_all_and_mark(conn: &Connection) -> rusqlite::Result<()> {
    recategorize_all(conn)?;
    let sig = rules_sig(conn)?;
    set_setting(conn, "rules_sig", &sig)?;
    Ok(())
}

/// Пересчитать категории только если правила изменились с прошлого раза.
/// Вызывается на старте: на больших БД пропускает дорогой UPDATE всех строк,
/// когда правила не менялись (обычный случай) — холодный старт остаётся быстрым.
pub fn recategorize_if_rules_changed(conn: &Connection) -> rusqlite::Result<()> {
    let sig = rules_sig(conn)?;
    if get_setting(conn, "rules_sig")?.as_deref() != Some(sig.as_str()) {
        recategorize_all(conn)?;
        set_setting(conn, "rules_sig", &sig)?;
    }
    Ok(())
}

/// Удалить все записи активности (кнопка «очистить данные»).
pub fn clear_activities(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM activities", [])?;
    Ok(())
}

/// Статистика по БД: число строк и границы по времени.
pub fn db_stats(conn: &Connection) -> rusqlite::Result<(i64, i64, Option<i64>)> {
    let activity_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))?;
    let rule_count: i64 =
        conn.query_row("SELECT COUNT(*) FROM category_rules", [], |r| r.get(0))?;
    let oldest: Option<i64> =
        conn.query_row("SELECT MIN(started_at) FROM activities", [], |r| r.get(0))?;
    Ok((activity_count, rule_count, oldest))
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

// ----- queries: app_icons --------------------------------------------------

/// Запись о закешированной иконке приложения.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppIcon {
    pub app_name: String,
    pub icon_hash: String,
    pub source: String,
    pub width: i64,
    pub updated_at: i64,
}

/// Достать запись об иконке по нормализованному имени процесса.
pub fn get_app_icon(conn: &Connection, app_name: &str) -> rusqlite::Result<Option<AppIcon>> {
    let res: rusqlite::Result<AppIcon> = conn.query_row(
        "SELECT app_name, icon_hash, source, width, updated_at
         FROM app_icons WHERE app_name = ?1",
        rusqlite::params![app_name],
        |r| {
            Ok(AppIcon {
                app_name: r.get(0)?,
                icon_hash: r.get(1)?,
                source: r.get(2)?,
                width: r.get(3)?,
                updated_at: r.get(4)?,
            })
        },
    );
    match res {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Список нескольких иконок по именам (для bulk-запроса UI).
/// Возвращает только те, что есть в кеше.
pub fn get_app_icons_bulk(conn: &Connection, names: &[String]) -> rusqlite::Result<Vec<AppIcon>> {
    if names.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = std::iter::repeat("?")
        .take(names.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT app_name, icon_hash, source, width, updated_at
         FROM app_icons WHERE app_name IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params = rusqlite::params_from_iter(names.iter());
    let rows = stmt.query_map(params, |r| {
        Ok(AppIcon {
            app_name: r.get(0)?,
            icon_hash: r.get(1)?,
            source: r.get(2)?,
            width: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

/// Upsert записи об иконке. Если запись уже была с тем же хешем — просто
/// обновляет `updated_at`. Если хеш изменился — перезаписывает.
pub fn upsert_app_icon(conn: &Connection, icon: &AppIcon) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_icons (app_name, icon_hash, source, width, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(app_name) DO UPDATE SET
           icon_hash  = excluded.icon_hash,
           source     = excluded.source,
           width      = excluded.width,
           updated_at = excluded.updated_at",
        rusqlite::params![
            icon.app_name,
            icon.icon_hash,
            icon.source,
            icon.width,
            icon.updated_at,
        ],
    )?;
    Ok(())
}

/// Все записи app_icons (для отладки / Settings UI).
#[allow(dead_code)] // пока используется только из Rust-API, зарезервировано для настроек
pub fn list_app_icons(conn: &Connection) -> rusqlite::Result<Vec<AppIcon>> {
    let mut stmt = conn.prepare(
        "SELECT app_name, icon_hash, source, width, updated_at
         FROM app_icons ORDER BY updated_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(AppIcon {
            app_name: r.get(0)?,
            icon_hash: r.get(1)?,
            source: r.get(2)?,
            width: r.get(3)?,
            updated_at: r.get(4)?,
        })
    })?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Открываем in-memory БД с той же schema, что и основное приложение,
    /// и прогоняем CRUD на таблице app_icons.
    fn open_mem() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory db");
        conn.execute_batch(SCHEMA_SQL).expect("apply schema");
        conn
    }

    #[test]
    fn app_icons_upsert_and_get() {
        let conn = open_mem();
        let rec = AppIcon {
            app_name: "chrome.exe".into(),
            icon_hash: "abc123".into(),
            source: "exe".into(),
            width: 32,
            updated_at: 1_700_000_000_000,
        };
        upsert_app_icon(&conn, &rec).expect("insert");
        let got = get_app_icon(&conn, "chrome.exe").expect("query").expect("row");
        assert_eq!(got.app_name, "chrome.exe");
        assert_eq!(got.icon_hash, "abc123");
        assert_eq!(got.width, 32);
        assert_eq!(got.updated_at, 1_700_000_000_000);

        // Update: меняем hash.
        let upd = AppIcon {
            icon_hash: "def456".into(),
            updated_at: 1_700_000_999_999,
            ..rec.clone()
        };
        upsert_app_icon(&conn, &upd).expect("update");
        let got = get_app_icon(&conn, "chrome.exe").expect("query2").expect("row2");
        assert_eq!(got.icon_hash, "def456");
        assert_eq!(got.updated_at, 1_700_000_999_999);
    }

    #[test]
    fn migrates_legacy_favicon_to_site_namespace() {
        let conn = open_mem();
        upsert_app_icon(
            &conn,
            &AppIcon {
                app_name: "youtube.com".into(),
                icon_hash: "favicon-hash".into(),
                source: "favicon".into(),
                width: 0,
                updated_at: 1,
            },
        )
        .expect("insert legacy favicon");

        migrate_legacy_favicon_keys(&conn).expect("migrate favicon");

        assert!(get_app_icon(&conn, "youtube.com").unwrap().is_none());
        let migrated = get_app_icon(&conn, "site:youtube.com")
            .unwrap()
            .expect("migrated favicon");
        assert_eq!(migrated.icon_hash, "favicon-hash");
    }

    #[test]
    fn app_icons_bulk_and_missing() {
        let conn = open_mem();
        // Bulk-функция ищет по точному совпадению имени (нормализацию делает
        // caller — это совпадает с тем, как commands::get_app_icons нормализует
        // перед передачей в db::get_app_icons_bulk).
        for (name, hash) in [
            ("chrome.exe", "h1"),
            ("code.exe", "h2"),
            ("devenv.exe", "h3"),
        ] {
            upsert_app_icon(
                &conn,
                &AppIcon {
                    app_name: name.into(),
                    icon_hash: hash.into(),
                    source: "exe".into(),
                    width: 32,
                    updated_at: 0,
                },
            )
            .unwrap();
        }

        let bulk = get_app_icons_bulk(
            &conn,
            &[
                "chrome.exe".into(),
                "code.exe".into(),
                "unknown.exe".into(), // не существует
            ],
        )
        .expect("bulk");
        assert_eq!(bulk.len(), 2);
        let names: std::collections::HashSet<_> = bulk.iter().map(|r| r.app_name.as_str()).collect();
        assert!(names.contains("chrome.exe"));
        assert!(names.contains("code.exe"));
        assert!(!names.contains("unknown.exe"));

        // Bulk с пустым списком — пустой результат, без ошибок.
        let empty = get_app_icons_bulk(&conn, &[]).expect("empty bulk");
        assert!(empty.is_empty());
    }

    /// Регрессия на INDEXED BY в query_summary: если имя индекса когда-нибудь
    /// разъедется со схемой (переименуют/удалят в schema.sql), запрос будет
    /// падать в рантайме с "no such index" — обычный SQL так не ломается,
    /// поэтому именно на этот запрос нужен явный тест поверх настоящей схемы
    /// (open_mem применяет её целиком, включая idx_activities_ended).
    #[test]
    fn query_summary_works_with_indexed_by_hint() {
        let conn = open_mem();
        let mk = |app: &str, dom: Option<&str>, ms: i64, idle: bool| Activity {
            id: 0,
            started_at: 0,
            ended_at: ms,
            duration_ms: ms,
            app_name: app.to_string(),
            window_title: None,
            browser: None,
            url: None,
            domain: dom.map(str::to_string),
            category_id: None,
            category_name: None,
            is_idle: idle,
        };
        insert_activity(&conn, &mk("chrome.exe", Some("github.com"), 60_000, false)).unwrap();
        insert_activity(&conn, &mk("chrome.exe", Some("github.com"), 5_000, true)).unwrap();
        insert_activity(&conn, &mk("code.exe", None, 30_000, false)).unwrap();

        let by_app = query_summary(&conn, 0, i64::MAX, &SummaryGroupBy::App).expect("app summary");
        let chrome = by_app.iter().find(|b| b.key == "chrome.exe").expect("chrome bucket");
        assert_eq!(chrome.total_ms, 60_000, "простой (idle) не должен попадать в сумму");
        assert_eq!(chrome.count, 1);

        let by_domain =
            query_summary(&conn, 0, i64::MAX, &SummaryGroupBy::Domain).expect("domain summary");
        assert!(by_domain.iter().any(|b| b.key == "github.com" && b.total_ms == 60_000));

        let by_cat =
            query_summary(&conn, 0, i64::MAX, &SummaryGroupBy::Category).expect("category summary");
        let total: i64 = by_cat.iter().map(|b| b.total_ms).sum();
        assert_eq!(total, 90_000, "chrome (active) + code = вся активная сумма без idle");
    }
}
