/** Форматирование длительностей, дат и палитра для графиков. */
import type { Lang } from "./i18n";

// Язык для локализации единиц/дат. Обновляется из стора при смене языка.
let LANG: Lang = "en";
export function setFormatLang(l: Lang): void {
  LANG = l;
}
const locale = () => (LANG === "ru" ? "ru-RU" : "en-US");

/** Человекочитаемая длительность: «2 ч 14 мин» / «2h 14m». */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return LANG === "ru" ? "0 с" : "0s";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (LANG === "ru") {
    if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
    if (m > 0) return s > 0 && m < 10 ? `${m} мин ${s} с` : `${m} мин`;
    return `${s} с`;
  }
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 && m < 10 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/** Очень компактно: «2ч14м», «30м», «12с», «0» — для подписей оси Y. */
export function formatDurationShort(ms: number): string {
  if (!ms || ms < 0) return "0";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const ru = LANG === "ru";
  if (h > 0)
    return m > 0 ? `${h}${ru ? "ч" : "h"}${m}${ru ? "м" : "m"}` : `${h}${ru ? "ч" : "h"}`;
  if (m > 0) return `${m}${ru ? "м" : "m"}`;
  return `${totalSec}${ru ? "с" : "s"}`;
}

/** Компактно: «2:14», «0:05» (часы:минуты) — для осей/мелких подписей. */
export function formatHm(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}:${m.toString().padStart(2, "0")}`;
}

/** Время «14:05». */
export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(locale(), {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Дата «25 июн». */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(locale(), {
    day: "numeric",
    month: "short",
  });
}

/** Дата+время «25 июн, 14:05». */
export function formatDateTime(ms: number): string {
  return `${formatDay(ms)}, ${formatTime(ms)}`;
}

/** Размер файла. */
export function formatBytes(bytes: number): string {
  const ru = LANG === "ru";
  if (bytes < 1024) return `${bytes} ${ru ? "Б" : "B"}`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} ${ru ? "КБ" : "KB"}`;
  return `${(kb / 1024).toFixed(1)} ${ru ? "МБ" : "MB"}`;
}

export type RangePreset = "today" | "week" | "month";

/** Границы диапазона [from, to] в unix ms по пресету. */
export function rangeFor(preset: RangePreset): { from: number; to: number } {
  const now = new Date();
  const to = now.getTime();
  const start = new Date(now);
  if (preset === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (preset === "week") {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
  }
  return { from: start.getTime(), to };
}

// Подписи диапазона перенесены в i18n: range.today / range.week / range.month.

/** Выбор диапазона: пресет или пользовательский интервал (день/промежуток). */
export type RangeSel = RangePreset | "custom";

/**
 * Границы активного диапазона. Для пресета — {@link rangeFor}; для "custom" —
 * заданные пользователем from/to (см. стор: customFrom/customTo).
 */
export function resolveRange(
  sel: RangeSel,
  customFrom: number,
  customTo: number,
): { from: number; to: number } {
  return sel === "custom" ? { from: customFrom, to: customTo } : rangeFor(sel);
}

/** Локальная полночь начала суток. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Локальный конец суток (23:59:59.999). */
export function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** Один и тот же календарный день (локально)? */
export function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** unix ms → значение для `<input type="date">` (локальная дата YYYY-MM-DD). */
export function toDateInput(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Значение `<input type="date">` (YYYY-MM-DD) → локальная полночь (NaN при ошибке). */
export function fromDateInput(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return NaN;
  return new Date(y, m - 1, d).getTime();
}

/**
 * Палитра для графиков (значения берём из theme.css через CSS-переменные).
 * Возвращаем var(...) — браузер подставит цвет темы.
 */
export const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

/** Детерминированный цвет по строковому ключу. */
export function colorForKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return CHART_VARS[h % CHART_VARS.length];
}

/** Короткое имя приложения без расширения .exe. */
export function appLabel(name: string): string {
  return name.replace(/\.exe$/i, "");
}
