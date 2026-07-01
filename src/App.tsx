import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
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
import { useT, type Lang, type Theme } from "@/lib/i18n";
import {
  endOfDay,
  fromDateInput,
  resolveRange,
  startOfDay,
  toDateInput,
  type RangeSel,
} from "@/lib/format";
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
  const customFrom = useAppStore((s) => s.customFrom);
  const customTo = useAppStore((s) => s.customTo);
  const setCustomRange = useAppStore((s) => s.setCustomRange);
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);
  const setTheme = useAppStore((s) => s.setTheme);
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
        const th = entries.find((x) => x.key === "theme");
        if (th && (th.value === "dark" || th.value === "light")) setTheme(th.value as Theme);
      })
      .catch(() => {});
  }, [setTracking, setLang, setTheme]);

  // Окно вернуло фокус — развернули из трея, из панели задач или просто
  // переключились обратно (см. lib.rs: show_main + WindowEvent::Focused).
  // Данные могли устареть, пока опрос был на паузе; обновляем сразу.
  useEffect(() => {
    const unlisten = listen("app-resumed", () => bumpRefresh());
    return () => {
      unlisten.then((f) => f());
    };
  }, [bumpRefresh]);

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
  const rangeOptions: { value: RangeSel; label: string }[] = [
    { value: "today", label: t("range.today") },
    { value: "week", label: t("range.week") },
    { value: "month", label: t("range.month") },
    { value: "all", label: t("period.all") },
  ];

  const showRange = view === "dashboard" || view === "activity";
  // Текущие границы (пресет или пользовательские) — отражаем их в полях даты.
  const resolved = resolveRange(range, customFrom, customTo);

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
                <div className="app__range">
                  <input
                    type="date"
                    lang={lang}
                    className={"dateinput" + (range === "custom" ? " dateinput--active" : "")}
                    value={toDateInput(resolved.from)}
                    max={toDateInput(resolved.to)}
                    title={t("range.from")}
                    onChange={(e) => {
                      const f = fromDateInput(e.target.value);
                      if (Number.isNaN(f)) return;
                      const from = startOfDay(f);
                      setCustomRange(from, from > resolved.to ? endOfDay(f) : resolved.to);
                    }}
                  />
                  <span className="app__rangesep">–</span>
                  <input
                    type="date"
                    lang={lang}
                    className={"dateinput" + (range === "custom" ? " dateinput--active" : "")}
                    value={toDateInput(resolved.to)}
                    min={toDateInput(resolved.from)}
                    max={toDateInput(Date.now())}
                    title={t("range.to")}
                    onChange={(e) => {
                      const tms = fromDateInput(e.target.value);
                      if (Number.isNaN(tms)) return;
                      const to = endOfDay(tms);
                      setCustomRange(to < resolved.from ? startOfDay(tms) : resolved.from, to);
                    }}
                  />
                </div>
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
