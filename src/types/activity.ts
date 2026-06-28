/**
 * Контракт данных между React-фронтом и Rust-бэкендом Tauri.
 * Эти типы — TS-зеркало структур в src-tauri/src/db/models.rs и команд.
 *
 * ВАЖНО: поля в camelCase — бэкенд сериализует через serde
 * `rename_all = "camelCase"`. Любое изменение в одной стороне зеркалится в другой.
 */

/** Запись об одном интервале активности. Соответствует строке activities в SQLite. */
export interface Activity {
  id: number;
  startedAt: number; // unix ms
  endedAt: number; // unix ms
  durationMs: number;
  appName: string;
  windowTitle: string | null;
  browser: string | null;
  url: string | null;
  domain: string | null;
  categoryId: number | null;
  categoryName?: string | null; // JOIN из category_rules, опционально
  isIdle: boolean;
}

/** Тип сопоставления правила категории. Зеркало CategoryMatchType в Rust. */
export type CategoryMatchType = "app" | "domain" | "domain_suffix";

/** Правило сопоставления приложение/домен → категория. */
export interface CategoryRule {
  id?: number;
  name: string;
  matchType: CategoryMatchType;
  pattern: string;
  color: string | null;
  priority: number;
}

/** Параметры фильтрации для get_activities и get_summary. */
export interface ActivityFilters {
  from?: number; // unix ms, включительно
  to?: number; // unix ms, включительно
  appName?: string;
  domain?: string;
  categoryId?: number;
  isIdle?: boolean;
}

/** Группировка агрегации для дашборда. */
export type SummaryGroupBy = "app" | "domain" | "category";

/** Один бакет агрегированной сводки. */
export interface SummaryBucket {
  key: string; // appName | domain | category name
  totalMs: number;
  count: number; // сколько интервалов попало
  categoryId?: number | null;
}

/** Диапазон дат для сводки. */
export interface DateRange {
  from: number; // unix ms
  to: number; // unix ms
}

/** Пара ключ-значение в таблице settings. */
export interface SettingEntry {
  key: string;
  value: string;
}

/** Текущая (живая) активность — виджет «Сейчас». */
export interface CurrentActivity {
  appName: string;
  windowTitle: string | null;
  domain: string | null;
  url: string | null;
  browser: string | null;
  isIdle: boolean;
  categoryName: string | null;
  trackingEnabled: boolean;
}

/** Сведения о хранилище данных. */
export interface DbInfo {
  path: string;
  sizeBytes: number;
  activityCount: number;
  ruleCount: number;
  oldestMs: number | null;
}

/** Статус браузерного расширения (транспорт — локальный HTTP-сервер). */
export interface ExtensionStatus {
  connected: boolean;
  lastUrl: string | null;
  lastTitle: string | null;
  lastSeenMsAgo: number | null;
  serverRunning: boolean;
  serverPort: number;
}

/**
 * Запись о закешированной иконке приложения. Зеркало db::AppIcon в Rust.
 * PNG-файл лежит в data_dir/icons/<iconHash>.png; для UI возвращается
 * в виде data URL через `get_app_icon_data`.
 */
export interface AppIcon {
  appName: string;
  iconHash: string;
  source: string;
  width: number;
  updatedAt: number;
}
