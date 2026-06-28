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
import { useT, type Lang } from "@/lib/i18n";
import type { RangePreset } from "@/lib/format";
import {
  getExtensionStatus,
  getSettings,
  setTrackingEnabled as setTrackingBackend,
} from "@/lib/tauri";
import "./App.css";

export default function App() {
  const t = useT();
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const range = useAppStore((s) => s.range);
  const setRange = useAppStore((s) => s.setRange);
  const setLang = useAppStore((s) => s.setLang);
  const trackingEnabled = useAppStore((s) => s.trackingEnabled);
  const setTracking = useAppStore((s) => s.setTrackingEnabled);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);

  // Синхронизируем флаг трекинга и язык из БД при старте.
  useEffect(() => {
    getSettings()
      .then((entries) => {
        const tr = entries.find((x) => x.key === "tracking_enabled");
        if (tr) setTracking(tr.value === "true" || tr.value === "1");
        const lng = entries.find((x) => x.key === "language");
        if (lng && (lng.value === "en" || lng.value === "ru")) setLang(lng.value as Lang);
      })
      .catch(() => {});
  }, [setTracking, setLang]);

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

  const titles: Record<string, string> = {
    dashboard: t("nav.dashboard"),
    activity: t("nav.activity"),
    categories: t("nav.categories"),
    extension: t("nav.extension"),
    settings: t("nav.settings"),
  };
  const rangeOptions: { value: RangePreset; label: string }[] = [
    { value: "today", label: t("range.today") },
    { value: "week", label: t("range.week") },
    { value: "month", label: t("range.month") },
  ];

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
          <h1 className="app__heading">{titles[view]}</h1>
          <div className="app__header-tools">
            {showRange && (
              <>
                <Segmented value={range} options={rangeOptions} onChange={setRange} />
                <button
                  className="btn btn--icon btn--ghost"
                  onClick={bumpRefresh}
                  title={t("header.refresh")}
                >
                  <IconRefresh />
                </button>
                <span className="app__divider" />
              </>
            )}
            <Toggle
              checked={trackingEnabled}
              onChange={toggleTracking}
              label={trackingEnabled ? t("header.trackingOn") : t("header.trackingOff")}
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
