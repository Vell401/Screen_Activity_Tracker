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
`update_settings`, `set_tracking_enabled`.

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

## Известные ограничения (задокументированные)

1. **Browser URL из title.** Полный URL виден в заголовке вкладки только у
   части сайтов. Domain-уровень (telegram.org) надёжно. Решение «Native
   Messaging расширение» отложено как Phase 4 — принимается после оценки
   точности парсинга заголовков.

2. **Idle vs просмотр видео.** `GetLastInputInfo` не учитывает просмотр видео
   (мышь не двигается, пользователь активен, но idle растёт). Future:
   secondary-сигнал аудиосессии (`IAudioSessionManager`).

3. **Multi-monitor / Win11 virtual desktops.** `GetForegroundWindow` корректен,
   но явно тестируется.

## Фазы проекта
- **0. Каркас** ✅ — Tauri+React+Vite, SQLite init, Discord-тема, базовый shell
- **1. Capture Engine** ✅ — window/idle/browser, запись интервалов
- **2. Категоризация** ✅ — правила + CRUD, сид данных
- **3. UI Дашборд** — в работе: наполнение Dashboard/Categories/Settings данными
- **4. (опц.)** Native Messaging расширение

## Договорённости по коду

- Rust: snake_case, модули с `//!` doc-комментарием сверху, публичные сущности
  документированы.
- TS: strict mode, `noUnusedLocals`/`noUnusedParameters`, алиас `@/` → `src/`.
- CSS: только CSS variables из `theme.css`, никаких хардкод-цветов в
  компонентах.
- Коммиты: только когда просит пользователь. Текущая ветка `dev`.
