import { create } from "zustand";
import type { ViewId } from "@/components/Sidebar";

interface AppState {
  /** Активная вкладка навигации. */
  view: ViewId;
  setView: (view: ViewId) => void;

  /** Включён ли capture engine. */
  trackingEnabled: boolean;
  setTrackingEnabled: (enabled: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  view: "dashboard",
  setView: (view) => set({ view }),

  // По умолчанию считаем включённым — реальное состояние подтянется из БД в Фазе 3.
  trackingEnabled: true,
  setTrackingEnabled: (trackingEnabled) => set({ trackingEnabled }),
}));
