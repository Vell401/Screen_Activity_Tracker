# Screen Activity Tracker

Локальный трекер активности за ПК для Windows. Отслеживает активное окно,
определяет простой (idle) и категоризирует приложения/домены. Всё хранится
локально в SQLite — никаких облаков, никакой телеметрии наружу.

## Возможности
- 📊 Трекинг активного окна (приложение + заголовок) с интервалом 1с
- 🌐 Определение браузера (Chrome, Yandex) и домена из заголовка вкладки
- ⏸️ Idle detection через `GetLastInputInfo`
- 🏷️ Категоризация по правилам (домен/процесс → категория) с UI
- 🎨 Discord-подобный интерфейс с повышенным контрастом для данных
- 🔒 100% локально, без AI и облака

## Стек
Tauri v2 · Rust · React 18 · TypeScript · Vite · SQLite · Zustand

## Установка и запуск

### Требования
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)
- MSVC Build Tools (C++ + Windows SDK) — для сборки Rust под Windows

### Дев-режим
```bash
npm install
npm run tauri dev
```
Откроется окно приложения с hot reload фронтенда.

### Release-сборка
```bash
npm run tauri build
```
Готовый установщик появится в `src-tauri/target/release/bundle/`.

## Структура
- `src/` — React-фронтенд (views, components, stores, types, lib)
- `src-tauri/` — Rust-бэкенд
  - `src/capture/` — capture engine (window, idle, browser)
  - `src/db/` — SQLite-слой, миграции, модели
  - `src/commands.rs` — Tauri IPC-команды
  - `src/lib.rs` — setup приложения

Подробности — в [CLAUDE.md](./CLAUDE.md).

## Лицензия
MIT
