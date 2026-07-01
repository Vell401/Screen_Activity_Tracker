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

**Поток данных:** capture loop каждые `sample_interval_ms` (по умолчанию 5с,
настраивается в Настройках) делает снимок активного окна. При смене сигнала
(app/title/domain/idle) закрывает текущий интервал и пишет строку в
`activities`.

**Агрегация — в SQL, не в JS.** KPI дашборда и таймлайн считаются командами
`get_range_stats`/`get_timeline` (агрегаты `SUM`/`GROUP BY` в SQLite), а не
выгрузкой сырых интервалов с суммированием на фронте — это принципиально:
`get_activities` отдаёт только последние `LIMIT 5000` строк (для журнала
«Активность» и drill-down этого достаточно), и если считать KPI по этому же
списку, на большой БД цифры будут занижены. `get_summary` (Top Apps/Domains,
донат категорий) и `get_timeline` дополнительно фильтруют `is_idle=0` —
простой не должен молча приплюсовываться к времени приложения/домена/категории.

**Автообновление UI:** периодический поллинг (по умолчанию 5 мин на
дашборде) приостанавливается, пока окно скрыто (`document.hidden`), и сразу
обновляется при возврате видимости/фокуса. Дополнительно бэкенд шлёт событие
`app-resumed` (`lib.rs`: `WindowEvent::Focused(true)` и явный emit в
`show_main` при разворачивании из трея) — фронтенд слушает его и форсирует
перезагрузку данных (`bumpRefresh` в сторе), не полагаясь только на видимость
webview.

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

Команды (группы соответствуют секциям в `commands.rs`):
- **activities:** `get_activities`, `get_summary`, `get_range_stats`, `get_timeline`
- **category rules:** `list_category_rules`, `upsert_category_rule`, `delete_category_rule`
- **settings:** `get_settings`, `update_settings`, `set_tracking_enabled`
- **live/обслуживание:** `get_current_activity`, `get_db_info`,
  `clear_activities`, `recategorize`
- **система:** `get_minimize_to_tray`, `set_minimize_to_tray`, `get_autostart`,
  `set_autostart`, `choose_db_location`
- **расширение:** `get_extension_status`, `export_extension`
- **иконки приложений:** `get_app_icon`, `get_app_icons`, `ensure_app_icon`,
  `get_app_icon_data`

## Схема БД (`src-tauri/src/db/schema.sql`)

- `activities` — интервалы активности (started_at, ended_at, app_name,
  window_title, browser, url, domain, category_id, is_idle)
- `category_rules` — правила категоризации (name, match_type, pattern, color,
  priority). match_type: `app` | `domain` | `domain_suffix` — `domain_suffix`
  оставлен только ради обратной совместимости со старыми строками; в UI
  создания/редактирования правила больше не предлагается.
- `settings` — key/value (sample_interval_ms, idle_threshold_ms,
  tracking_enabled, minimize_to_tray, language, theme, db_schema_version,
  `rules_sig` — служебный, см. ниже)

Миграции идемпотентны (`CREATE TABLE IF NOT EXISTS`), применяются при старте.
Сид правил категорий — только при пустой таблице.

**Пересчёт категорий на старте — с гейтом.** `recategorize_all` (полный
`UPDATE` всех строк `activities`) запускается при открытии БД только если
правила изменились с прошлого раза — сравнивается сигнатура текущих правил с
сохранённой в `settings.rules_sig` (`recategorize_if_rules_changed`). На
большой БД безусловный пересчёт на каждом холодном старте был бы дорогим.
CRUD правил (`upsert_category_rule`/`delete_category_rule`) и кнопка
«Пересчитать категории» идут через `recategorize_all_and_mark`, которая
обновляет `rules_sig` после пересчёта.

## Дизайн-система (Discord-стиль) + тёмная/светлая тема

Палитра в `src/styles/theme.css`. **Принцип отступления от Discord:** данные и
метрики рисуем с повышенным контрастом (`--text-bright`), не наследуем
низкоконтрастный серый интерфейсный текст. Акцент blurple (`#5865f2`) — только
для интерактивных элементов и ключевых KPI.

**Тема:** тёмная — палитра в `:root`, светлая — переопределение тех же токенов
в `:root[data-theme="light"]` (тот же принцип: `--text-bright` почти чёрный на
белом, для повышенного контраста данных). Все компоненты используют только CSS
переменные — переключение темы не требует правок компонентов. Атрибут
`data-theme` на `<html>` выставляется в двух местах: `main.tsx` (до первого
рендера, из кеша `localStorage["theme"]`, чтобы не было вспышки не той темы) и
`stores/app.ts` (`setTheme`, источник истины — настройка `theme` в БД).
Переключатель — Настройки → «Внешний вид». По умолчанию тёмная.

**Локализация (i18n):** `src/lib/i18n.ts` — плоский словарь `en`/`ru` +
`translate()`/`useT()`. Английский — язык по умолчанию, переключение там же, в
Настройках («Внешний вид»); `src/lib/format.ts` дублирует локаль для
дат/длительностей (`setFormatLang`). Добавляя UI-строку — ключ нужен в ОБОИХ
словарях (en и ru), иначе будет fallback на английский текст в русском UI.

> **Готча импортов:** `i18n.ts` импортирует `useAppStore` (значение) из
> `stores/app.ts`. Поэтому `stores/app.ts` обязан импортировать из `i18n.ts`
> **только типы** (`import type { ... }`) — импорт оттуда значения, используемого
> при инициализации стора (например, дефолт темы), создаёт рантайм-цикл и
> `ReferenceError` (TDZ) при старте → белый экран. `tsc` эту ошибку не ловит.
> Дефолтные константы, если нужны в сторе, инлайнить строкой/литералом, а не
> импортировать из i18n.

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

`export_extension` выгружает встроенные файлы расширения в папку рядом с
файлом БД (`db_path.parent()`, не «Загрузки» — пользователю не нужно никуда
их перекладывать, расширение грузится распакованным прямо оттуда).
Ключевые файлы: `src-tauri/src/{server,extension,bridge}.rs`,
`src-tauri/resources/extension/*`, UI — `src/views/ExtensionView.tsx`.

## Смена логотипа/иконки

Источник — `logo.png` в корне репозитория (квадратный, 1024×1024).
Регенерация всех размеров/форматов под `src-tauri/icons/*`:
```bash
npm run tauri -- icon logo.png
```
Затем **обязателен полный ребилд релиза** (`npm run tauri build`) — просто
пересборки недостаточно. `build.rs` объявляет
`cargo:rerun-if-changed=icons/icon.ico`; без этой строки Cargo не считает
`icon.ico` зависимостью сборки и может **не перелинковать** exe с новой
иконкой даже после явной пересборки (баг был воспроизведён и исправлен —
собранный `.exe` показывал иконку-заглушку из самой первой сборки проекта,
несмотря на то, что `icon.ico` давно был другим). Если меняли только сам
`logo.png`/`icon.ico` и результат не подхватился — `cargo clean -p
screen-activity-tracker --release` перед ребилдом форсирует релинк.
Дополнительно: Windows кеширует иконки ярлыков — после переустановки старая
иконка может остаться на Рабочем столе/в Пуске, пока не переустановить
начисто или не сбросить кеш иконок оболочки.

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
- **5. Полировка** ✅ — тёмная/светлая тема, i18n (en по умолчанию + ru),
  произвольный диапазон дат (день/промежуток/«всё время») в шапке, KPI и
  таймлайн переведены на SQL-агрегацию (см. «Поток данных»), гейт пересчёта
  категорий по сигнатуре правил, автообновление UI (поллинг + возврат фокуса),
  фикс пайплайна иконки exe (см. «Смена логотипа/иконки»)

## Договорённости по коду

- Rust: snake_case, модули с `//!` doc-комментарием сверху, публичные сущности
  документированы.
- TS: strict mode, `noUnusedLocals`/`noUnusedParameters`, алиас `@/` → `src/`.
- CSS: только CSS variables из `theme.css`, никаких хардкод-цветов в
  компонентах.
- Коммиты: только когда просит пользователь. Текущая ветка `dev`.
