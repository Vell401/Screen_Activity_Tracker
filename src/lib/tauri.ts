/**
 * Типизированные обёртки над Tauri IPC.
 * Все вызовы бэкенда проходят через этот модуль — единая точка,
 * где можно добавить логирование/обработку ошибок/кеш.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Activity,
  ActivityFilters,
  AppIcon,
  CategoryRule,
  CurrentActivity,
  DateRange,
  DbInfo,
  ExtensionStatus,
  SettingEntry,
  SummaryBucket,
  SummaryGroupBy,
} from "@/types/activity";

export async function getActivities(
  filters: ActivityFilters = {},
): Promise<Activity[]> {
  return invoke<Activity[]>("get_activities", { filters });
}

export async function getSummary(
  range: DateRange,
  groupBy: SummaryGroupBy,
): Promise<SummaryBucket[]> {
  return invoke<SummaryBucket[]>("get_summary", { range, groupBy });
}

export async function listCategoryRules(): Promise<CategoryRule[]> {
  return invoke<CategoryRule[]>("list_category_rules");
}

export async function upsertCategoryRule(
  rule: CategoryRule,
): Promise<CategoryRule> {
  return invoke<CategoryRule>("upsert_category_rule", { rule });
}

export async function deleteCategoryRule(id: number): Promise<void> {
  return invoke<void>("delete_category_rule", { id });
}

export async function getSettings(): Promise<SettingEntry[]> {
  return invoke<SettingEntry[]>("get_settings");
}

export async function updateSettings(entries: SettingEntry[]): Promise<void> {
  return invoke<void>("update_settings", { entries });
}

export async function setTrackingEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_tracking_enabled", { enabled });
}

// ----- live / обслуживание -------------------------------------------------

export async function getCurrentActivity(): Promise<CurrentActivity> {
  return invoke<CurrentActivity>("get_current_activity");
}

export async function getDbInfo(): Promise<DbInfo> {
  return invoke<DbInfo>("get_db_info");
}

export async function clearActivities(): Promise<void> {
  return invoke<void>("clear_activities");
}

export async function recategorize(): Promise<void> {
  return invoke<void>("recategorize");
}

// ----- система: трей, автозапуск, путь к БД ---------------------------------

/** Прятать ли окно в трей при закрытии. */
export async function getMinimizeToTray(): Promise<boolean> {
  return invoke<boolean>("get_minimize_to_tray");
}

export async function setMinimizeToTray(enabled: boolean): Promise<void> {
  return invoke<void>("set_minimize_to_tray", { enabled });
}

/** Включён ли автозапуск с Windows. */
export async function getAutostart(): Promise<boolean> {
  return invoke<boolean>("get_autostart");
}

export async function setAutostart(enabled: boolean): Promise<void> {
  return invoke<void>("set_autostart", { enabled });
}

/** Открыть диалог выбора папки для БД (приложение перезапустится при выборе). */
export async function chooseDbLocation(): Promise<void> {
  return invoke<void>("choose_db_location");
}

// ----- браузерное расширение -----------------------------------------------

export async function getExtensionStatus(): Promise<ExtensionStatus> {
  return invoke<ExtensionStatus>("get_extension_status");
}

export async function exportExtension(): Promise<string> {
  return invoke<string>("export_extension");
}

// ----- иконки приложений ---------------------------------------------------
//
// Реальные иконки извлекаются на бэкенде из .exe, кешируются на диск в
// data_dir/icons/<sha256>.png и в таблицу app_icons. Здесь два сценария:
//   - bulk-запросить метаданные (appName → AppIcon) и потом, при необходимости,
//     подтянуть PNG по требованию для <img src=data:...>.

/** Получить одну запись AppIcon по имени процесса (или null, если не закешировано). */
export async function getAppIcon(appName: string): Promise<AppIcon | null> {
  return invoke<AppIcon | null>("get_app_icon", { appName });
}

/** Bulk-запрос метаданных. */
export async function getAppIcons(appNames: string[]): Promise<AppIcon[]> {
  return invoke<AppIcon[]>("get_app_icons", { appNames });
}

/** Принудительно извлечь/переизвлечь иконку (синхронно). */
export async function ensureAppIcon(appName: string): Promise<AppIcon | null> {
  return invoke<AppIcon | null>("ensure_app_icon", { appName });
}

/** Вернуть PNG-данные иконки в виде data URL (`data:image/png;base64,...`). */
export async function getAppIconData(appName: string): Promise<string | null> {
  return invoke<string | null>("get_app_icon_data", { appName });
}
