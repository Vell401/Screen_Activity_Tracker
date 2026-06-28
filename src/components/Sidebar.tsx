import "./Sidebar.css";
import type { ReactNode } from "react";
import type { ViewId } from "@/stores/app";
import {
  IconActivity,
  IconDashboard,
  IconPuzzle,
  IconSettings,
  IconTags,
} from "./icons";

interface SidebarProps {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  trackingEnabled: boolean;
  /** Расширение подключено (для бейджа на пункте «Расширение»). */
  extensionConnected: boolean;
}

const NAV: { id: ViewId; label: string; icon: ReactNode }[] = [
  { id: "dashboard", label: "Дашборд", icon: <IconDashboard /> },
  { id: "activity", label: "Активность", icon: <IconActivity /> },
  { id: "categories", label: "Категории", icon: <IconTags /> },
  { id: "extension", label: "Расширение", icon: <IconPuzzle /> },
  { id: "settings", label: "Настройки", icon: <IconSettings /> },
];

export function Sidebar({
  active,
  onSelect,
  trackingEnabled,
  extensionConnected,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">SAT</span>
        <div className="sidebar__brandtext">
          <span className="sidebar__title">Activity Tracker</span>
          <span className="sidebar__subtitle">локально · без облака</span>
        </div>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={
              "sidebar__item" +
              (active === item.id ? " sidebar__item--active" : "")
            }
            onClick={() => onSelect(item.id)}
          >
            <span className="sidebar__icon">{item.icon}</span>
            <span className="sidebar__label">{item.label}</span>
            {item.id === "extension" && extensionConnected && (
              <span className="sidebar__pip" title="Расширение подключено" />
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar__footer">
        <span
          className={
            "sidebar__status" +
            (trackingEnabled ? " sidebar__status--on" : " sidebar__status--off")
          }
        >
          <span className="sidebar__dot" />
          {trackingEnabled ? "Трекинг активен" : "Трекинг на паузе"}
        </span>
      </div>
    </aside>
  );
}
