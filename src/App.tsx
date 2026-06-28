import { useEffect } from "react";
import { Sidebar } from "@/components/Sidebar";
import { Segmented, Toggle } from "@/components/ui";
import { IconRefresh } from "@/components/icons";
import { DashboardView } from "@/views/DashboardView";
import { ActivityView } from "@/views/ActivityView";
import { CategoriesView } from "@/views/CategoriesView";
import { ExtensionView } from "@/views/ExtensionView";
import { SettingsView } from "@/views/SettingsView";
import { useAppStore } from "@/stores/app";
import { useAsyncData } from "@/lib/hooks";
import { RANGE_LABEL, type RangePreset } from "@/lib/format";
import {
  getExtensionStatus,
  getSettings,
  setTrackingEnabled as setTrackingBackend,
} from "@/lib/tauri";
import "./App.css";

const TITLES: Record<string, string> = {
  dashboard: "Дашборд",
  activity: "Активность",
  categories: "Категории",
  extension: "Расширение",
  settings: "Настройки",
};

const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: "today", label: RANGE_LABEL.today },
  { value: "week", label: RANGE_LABEL.week },
  { value: "month", label: RANGE_LABEL.month },
];

export default function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const range = useAppStore((s) => s.range);
  const setRange = useAppStore((s) => s.setRange);
  const trackingEnabled = useAppStore((s) => s.trackingEnabled);
  const setTracking = useAppStore((s) => s.setTrackingEnabled);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);

  // Синхронизируем флаг трекинга из БД при старте.
  useEffect(() => {
    getSettings()
      .then((entries) => {
        const e = entries.find((x) => x.key === "tracking_enabled");
        if (e) setTracking(e.value === "true" || e.value === "1");
      })
      .catch(() => {});
  }, [setTracking]);

  // Статус расширения — для индикатора в сайдбаре.
  const ext = useAsyncData(getExtensionStatus, [], 5000);
  const extensionConnected = ext.data?.connected ?? false;

  const toggleTracking = async () => {
    const next = !trackingEnabled;
    setTracking(next);
    try {
      await setTrackingBackend(next);
    } catch {
      setTracking(!next); // откат при ошибке
    }
  };

  const showRange = view === "dashboard" || view === "activity";

  return (
    <div className="app">
      <Sidebar
        active={view}
        onSelect={setView}
        trackingEnabled={trackingEnabled}
        extensionConnected={extensionConnected}
      />
      <main className="app__content">
        <header className="app__header">
          <h1 className="app__heading">{TITLES[view]}</h1>
          <div className="app__header-tools">
            {showRange && (
              <>
                <Segmented
                  value={range}
                  options={RANGE_OPTIONS}
                  onChange={setRange}
                />
                <button
                  className="btn btn--icon btn--ghost"
                  onClick={bumpRefresh}
                  title="Обновить"
                >
                  <IconRefresh />
                </button>
                <span className="app__divider" />
              </>
            )}
            <Toggle
              checked={trackingEnabled}
              onChange={toggleTracking}
              label={trackingEnabled ? "Трекинг вкл" : "Трекинг выкл"}
            />
          </div>
        </header>
        <div className="app__scroll">
          {view === "dashboard" && <DashboardView />}
          {view === "activity" && <ActivityView />}
          {view === "categories" && <CategoriesView />}
          {view === "extension" && <ExtensionView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
