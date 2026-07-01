-- Схема SQLite для Screen Activity Tracker.
-- Идемпотентный скрипт миграции: выполняется при каждом старте приложения.
-- Любое изменение здесь требует зеркального изменения в src/types/activity.ts.

-- Один непрерывный интервал активности (одно окно/приложение).
CREATE TABLE IF NOT EXISTS activities (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at    INTEGER NOT NULL,   -- unix ms, начало интервала
    ended_at      INTEGER NOT NULL,   -- unix ms, конец интервала
    duration_ms   INTEGER NOT NULL,
    app_name      TEXT    NOT NULL,   -- имя процесса или окна
    window_title  TEXT,               -- заголовок окна (GetWindowText)
    browser       TEXT,               -- 'chrome' | 'yandex' | NULL
    url           TEXT,               -- извлечено из title, если получилось
    domain        TEXT,               -- нормализованный домен (telegram.org)
    category_id   INTEGER REFERENCES category_rules(id),
    is_idle       INTEGER NOT NULL DEFAULT 0  -- 0/1 bool
);

CREATE INDEX IF NOT EXISTS idx_activities_started ON activities(started_at);
CREATE INDEX IF NOT EXISTS idx_activities_app     ON activities(app_name);
CREATE INDEX IF NOT EXISTS idx_activities_domain  ON activities(domain);
-- Диапазонные запросы (get_activities/get_summary/get_range_stats/get_timeline)
-- фильтруют "ended_at >= from AND started_at <= to". `to` на практике почти
-- всегда "сейчас", так что started_at<=to совпадает почти со всеми строками —
-- реально отсекающее условие это ended_at>=from, а его не на чем было искать
-- (только idx_activities_started, и то не с той стороны). Без этого индекса
-- каждый такой запрос на большой БД сканировал бы всю таблицу целиком.
CREATE INDEX IF NOT EXISTS idx_activities_ended   ON activities(ended_at);

-- Правило сопоставления приложение/домен -> категория.
-- match_type:
--   'app'           — точное/подстрочное имя процесса (Telegram.exe)
--   'domain'        — точный домен (telegram.org)
--   'domain_suffix' — суффикс домена (*.jetbrains.com -> jetbrains.com)
CREATE TABLE IF NOT EXISTS category_rules (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,         -- 'Мессенджеры', 'Разработка'
    match_type  TEXT NOT NULL,         -- 'app' | 'domain' | 'domain_suffix'
    pattern     TEXT NOT NULL,         -- конкретный паттерн
    color       TEXT,                  -- hex для UI, опционально
    priority    INTEGER NOT NULL DEFAULT 0  -- выше = раньше матчится при конфликте
);

CREATE INDEX IF NOT EXISTS idx_category_rules_priority ON category_rules(priority DESC);

-- Ключ-значение хранилище настроек.
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Кеш извлечённых иконок приложений (по имени процесса, нормализованному).
-- icon_hash — SHA-256 содержимого PNG; PNG-файл лежит на диске в data_dir/icons/<hash>.png.
-- source  — откуда взяли: 'exe' (из .exe) | 'window' (WM_GETICON из окна).
-- updated_at — последний раз когда успешно извлекли (unix ms).
CREATE TABLE IF NOT EXISTS app_icons (
    app_name    TEXT PRIMARY KEY,       -- нормализованное имя процесса (chrome.exe, Code.exe)
    icon_hash   TEXT NOT NULL,          -- hex sha256 PNG
    source      TEXT NOT NULL DEFAULT 'exe',
    width       INTEGER NOT NULL DEFAULT 32,
    updated_at  INTEGER NOT NULL
);
