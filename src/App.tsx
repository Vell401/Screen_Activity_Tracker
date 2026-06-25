import { Sidebar } from "@/components/Sidebar";
import { DashboardView } from "@/views/DashboardView";
import { CategoriesView } from "@/views/CategoriesView";
import { SettingsView } from "@/views/SettingsView";
import { useAppStore } from "@/stores/app";
import "./App.css";

export default function App() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const trackingEnabled = useAppStore((s) => s.trackingEnabled);

  return (
    <div className="app">
      <Sidebar
        active={view}
        onSelect={setView}
        trackingEnabled={trackingEnabled}
      />
      <main className="app__content">
        <header className="app__header">
          <h1 className="app__heading">
            {view === "dashboard" && "Дашборд"}
            {view === "categories" && "Категории"}
            {view === "settings" && "Настройки"}
          </h1>
        </header>
        <div className="app__scroll">
          {view === "dashboard" && <DashboardView />}
          {view === "categories" && <CategoriesView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>
    </div>
  );
}
