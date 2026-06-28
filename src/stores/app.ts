import { create } from "zustand";
import type { RangePreset } from "@/lib/format";

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

  /** Выбранный диапазон дат для дашборда/активности. */
  range: RangePreset;
  setRange: (range: RangePreset) => void;

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

  trackingEnabled: true,
  setTrackingEnabled: (trackingEnabled) => set({ trackingEnabled }),

  refreshKey: 0,
  bumpRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),
}));
