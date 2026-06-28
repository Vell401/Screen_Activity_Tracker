# Screen Activity Tracker — справка для агента

Локальный трекер активности за ПК. Tauri v2 + Rust + React + SQLite.
**Без AI, без браузерного расширения, без облака** — всё локально.

## Стек
- **Backend:** Rust, Tauri v2, `rusqlite` (bundled SQLite), `windows` (Win32 API)
- **Frontend:** React 18, Vite 6, TypeScript (strict), `zustand`
- **Пакетный менеджер:** npm
- **Целевая ОС:** Windows (основная); не-Windows собирается как заглушка

## Запуск

```bash
npm install              # один раз
npm run tauri dev        # дев-режим: Vite HMR + Rust hot-rebuild
npm run tauri build      # release-сборка (в src-tauri/target/release)
```

Frontend dev-сервер: http://localhost:1420 (strictPort).
Tauri поднимает Vite сам через `beforeDevCommand: "npm run dev"`.

## Архитектура

```
React (TS)  ──invoke──▶  Tauri Commands (Rust)  ──▶  SQLite
                              ▲
                              │
                       Capture Engine (фоновый поток)
                       ├─ GetForegroundWindow + GetWindowText
                       ├─ GetLastInputInfo (idle)
                       └─ browser detect + URL/domain из title
```

**Поток данных:** capture loop каждые 1с делает снимок активного окна. При
смене сигнала (app/title/domain/idle) закрывает текущий интервал и пишет строку
в `activities`. UI читает данные командами `get_activities`/`get_summary`.

**Состояние:** `Arc<AppState>` регистрируется в `app.manage()` и шарится между
командами (`State<'_, Arc<AppState>>`) и capture loop (клон Arc). Соединение с
БД — под `Mutex<Connection>`.

## Контракт IPC (UI ↔ backend)

Зеркальные типы:
- Rust: `src-tauri/src/db/models.rs`
- TS: `src/types/activity.ts`
- Обёртки invoke: `src/lib/tauri.ts`

**Любое изменение в одной стороне должно быть зеркально отражено в другой.**
Поля в `camelCase` (serde `rename_all = "camelCase"`).

Команды: `get_activities`, `get_summary`, `list_category_rules`,
`upsert_category_rule`, `delete_category_rule`, `get_settings`,
`update_settings`, `set_tracking_enabled`, `get_current_activity`,
`get_db_info`, `clear_activities`, `recategorize`, `get_extension_status`,
`export_extension`.

## Схема БД (`src-tauri/src/db/schema.sql`)

- `activities` — интервалы активности (started_at, ended_at, app_name,
  window_title, browser, url, domain, category_id, is_idle)
- `category_rules` — правила категоризации (name, match_type, pattern, color,
  priority). match_type: `app` | `domain` | `domain_suffix`
- `settings` — key/value (sample_interval_ms, idle_threshold_ms,
  tracking_enabled, db_schema_version)

Миграции идемпотентны (`CREATE TABLE IF NOT EXISTS`), применяются при старте.
Сид правил категорий — только при пустой таблице.

## Дизайн-система (Discord-стиль)

Палитра в `src/styles/theme.css`. **Принцип отступления от Discord:** данные и
метрики рисуем с повышенным контрастом (`--text-bright: #ffffff`), не наследуем
низкоконтрастный серый интерфейсный текст. Акцент blurple (`#5865f2`) — только
для интерактивных элементов и ключевых KPI.

## Браузерное расширение (локальный HTTP-сервер) — Phase 4 ✅

Точные URL/домены вкладок приходят из браузерного расширения (Chromium: Chrome,
Edge, Brave, Opera, Yandex, Vivaldi) через **локальный HTTP-сервер**.

> Изначально планировался native messaging, но он оказался ненадёжным (на части
> сборок Yandex браузер не резолвит HKCU-регистрацию хоста даже при идеально
> прописанном реестре). Перешли на локальный сервер — он не требует реестра,
> прав администратора и перезапуска браузера; работает во всех Chromium сразу.

**Сервер** (`server.rs`): при старте биндит первый свободный порт из
`PORTS = [35745..35748]` на `127.0.0.1`, принимает `GET /status` и
`POST /heartbeat`. Порт хранится в `AppState.server_port`. CORS открыт.

**Расширение** (`resources/extension/*`, MV3): `background.js` находит порт
(пробует `/status`) и шлёт `POST /heartbeat {type,url,title}` на смену
вкладки/окна и по таймеру (`chrome.alarms`). Права: `tabs`, `alarms`,
`host_permissions: http://127.0.0.1/*`. Стабильный ID — закреплённый `key`.

**Мост через файл.** Сервер пишет `browser_heartbeat.json` в app_data_dir
(`bridge.rs`). Capture loop читает его, когда в фокусе браузер, и предпочитает
точный URL парсингу заголовка (fallback — `browser::parse_title`).

`export_extension` выгружает встроенные файлы расширения в «Загрузки».
Ключевые файлы: `src-tauri/src/{server,extension,bridge}.rs`,
`src-tauri/resources/extension/*`, UI — `src/views/ExtensionView.tsx`.

## Известные ограничения (задокументированные)

1. **Browser URL без расширения.** Если расширение не установлено, URL берётся из
   заголовка вкладки (виден лишь у части сайтов); домен — надёжно. С расширением
   (Phase 4, см. выше) URL/домен точные.

2. **Idle vs просмотр видео.** `GetLastInputInfo` не учитывает просмотр видео
   (мышь не двигается, пользователь активен, но idle растёт). Future:
   secondary-сигнал аудиосессии (`IAudioSessionManager`).

3. **Multi-monitor / Win11 virtual desktops.** `GetForegroundWindow` корректен,
   но явно тестируется.

## Фазы проекта
- **0. Каркас** ✅ — Tauri+React+Vite, SQLite init, Discord-тема, базовый shell
- **1. Capture Engine** ✅ — window/idle/browser, запись интервалов, категоризация
  при записи + bulk-пересчёт
- **2. Категоризация** ✅ — правила + CRUD, сид данных
- **3. UI Дашборд** ✅ — дашборд с KPI/графиками (SVG), журнал «Активность»,
  CRUD категорий, настройки, вкладка «Расширение»; графики свои на SVG (без
  внешних библиотек), темизация только через `theme.css`
- **4. Native Messaging расширение** ✅ — Chromium-расширение + native-host,
  точные URL/домены (см. раздел «Браузерное расширение»)

## Договорённости по коду

- Rust: snake_case, модули с `//!` doc-комментарием сверху, публичные сущности
  документированы.
- TS: strict mode, `noUnusedLocals`/`noUnusedParameters`, алиас `@/` → `src/`.
- CSS: только CSS variables из `theme.css`, никаких хардкод-цветов в
  компонентах.
- Коммиты: только когда просит пользователь. Текущая ветка `dev`.
