/**
 * Типизированные обёртки над Tauri IPC.
 * Все вызовы бэкенда проходят через этот модуль — единая точка,
 * где можно добавить логирование/обработку ошибок/кеш.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  Activity,
  ActivityFilters,
  CategoryRule,
  DateRange,
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
  return invoke<SummaryBucket[]>("get_summary", {
    range,
    groupBy: groupBy,
  });
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

export async function updateSettings(
  entries: SettingEntry[],
): Promise<void> {
  return invoke<void>("update_settings", { entries });
}

export async function setTrackingEnabled(enabled: boolean): Promise<void> {
  return invoke<void>("set_tracking_enabled", { enabled });
}
