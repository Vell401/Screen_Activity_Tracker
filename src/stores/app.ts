import { create } from "zustand";
import type { RangeSel } from "@/lib/format";
import { setFormatLang, startOfDay } from "@/lib/format";
// ВНИМАНИЕ: только типы из i18n. i18n импортирует useAppStore (значение) отсюда,
// поэтому импорт значения обратно создал бы рантайм-цикл и TDZ-ошибку при старте
// (initialTheme() выполняется сразу при create()). Дефолт темы инлайним строкой.
import type { Lang, Theme } from "@/lib/i18n";

/** Тема из localStorage-кеша (его же пишет applyTheme), иначе — по умолчанию. */
function initialTheme(): Theme {
  try {
    const v = localStorage.getItem("theme");
    if (v === "light" || v === "dark") return v;
  } catch {
    /* localStorage недоступен */
  }
  return "dark";
}

/** Применить тему к документу и закешировать для мгновенного применения на старте. */
function applyTheme(theme: Theme): void {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    /* localStorage недоступен */
  }
}

/** Активная вкладка навигации. */
export type ViewId =
  | "dashboard"
  | "activity"
  | "categories"
  | "extension"
  | "settings";

interface AppState {
  view: ViewId;
  setView: (view: ViewId) => void;

  /** Выбранный диапазон: пресет (today/week/month) или пользовательский ("custom"). */
  range: RangeSel;
  setRange: (range: RangeSel) => void;

  /** Границы пользовательского интервала (используются, когда range === "custom"). */
  customFrom: number;
  customTo: number;
  /** Задать пользовательский интервал и переключить range в "custom". */
  setCustomRange: (from: number, to: number) => void;

  /** Язык интерфейса (по умолчанию английский). */
  lang: Lang;
  setLang: (lang: Lang) => void;

  /** Тема оформления (тёмная по умолчанию). */
  theme: Theme;
  setTheme: (theme: Theme) => void;

  /** Включён ли capture engine (зеркало настройки в БД). */
  trackingEnabled: boolean;
  setTrackingEnabled: (enabled: boolean) => void;

  /** Счётчик ручного обновления — увеличиваем, чтобы перезагрузить данные. */
  refreshKey: number;
  bumpRefresh: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "dashboard",
  setView: (view) => set({ view }),

  range: "today",
  setRange: (range) => set({ range }),

  customFrom: startOfDay(Date.now()),
  customTo: Date.now(),
  setCustomRange: (from, to) => set({ customFrom: from, customTo: to, range: "custom" }),

  lang: "en",
  setLang: (lang) => {
    setFormatLang(lang);
    // Влияет на локаль нативных контролов (формат и календарь <input type="date">).
    if (typeof document !== "undefined") document.documentElement.lang = lang;
    set({ lang });
  },

  theme: initialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },

  trackingEnabled: true,
  setTrackingEnabled: (trackingEnabled) => set({ trackingEnabled }),

  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
