/**
 * Контракт данных между React-фронтом и Rust-бэкендом Tauri.
 * Эти типы — TS-зеркало структур в src-tauri/src/db/models.rs и команд.
 * Любое изменение в одной стороне должно зеркально отражаться в другой.
 */

/** Запись об одном интервале активности. Соответствует строке activities в SQLite. */
export interface Activity {
  id: number;
  started_at: number; // unix ms
  ended_at: number; // unix ms
  duration_ms: number;
  app_name: string;
  window_title: string | null;
  browser: "chrome" | "yandex" | null;
  url: string | null;
  domain: string | null;
  category_id: number | null;
  category_name?: string | null; // JOIN из category_rules, опционально
  is_idle: boolean;
}

/** Тип сопоставления правила категории. Зеркало enum CategoryMatchType в Rust. */
export type CategoryMatchType = "app" | "domain" | "domain_suffix";

/** Правило сопоставления приложение/домен → категория. */
export interface CategoryRule {
  id?: number;
  name: string;
  match_type: CategoryMatchType;
  pattern: string;
  color: string | null;
  priority: number;
}

/** Параметры фильтрации для get_activities и get_summary. */
export interface ActivityFilters {
  from?: number; // unix ms, включительно
  to?: number; // unix ms, включительно
  app_name?: string;
  domain?: string;
  category_id?: number;
  is_idle?: boolean;
}

/** Группировка агрегации для дашборда. */
export type SummaryGroupBy = "app" | "domain" | "category";

/** Один бакет агрегированной сводки. */
export interface SummaryBucket {
  key: string; // app_name | domain | category name
  total_ms: number;
  count: number; // сколько интервалов попало
  category_id?: number | null;
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
