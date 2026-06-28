/** Форматирование длительностей, дат и палитра для графиков. */

/** Человекочитаемая длительность: «2 ч 14 мин», «5 мин», «12 с», «0 с». */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "0 с";
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  if (m > 0) return s > 0 && m < 10 ? `${m} мин ${s} с` : `${m} мин`;
  return `${s} с`;
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
  return new Date(ms).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Дата «25 июн». */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString("ru-RU", {
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
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} КБ`;
  return `${(kb / 1024).toFixed(1)} МБ`;
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

export const RANGE_LABEL: Record<RangePreset, string> = {
  today: "Сегодня",
  week: "7 дней",
  month: "30 дней",
};

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
