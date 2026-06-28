import "./Sidebar.css";
import type { ReactNode } from "react";
import type { ViewId } from "@/stores/app";
import { useT } from "@/lib/i18n";
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

const NAV: { id: ViewId; key: string; icon: ReactNode }[] = [
  { id: "dashboard", key: "nav.dashboard", icon: <IconDashboard /> },
  { id: "activity", key: "nav.activity", icon: <IconActivity /> },
  { id: "categories", key: "nav.categories", icon: <IconTags /> },
  { id: "extension", key: "nav.extension", icon: <IconPuzzle /> },
  { id: "settings", key: "nav.settings", icon: <IconSettings /> },
];

export function Sidebar({
  active,
  onSelect,
  trackingEnabled,
  extensionConnected,
}: SidebarProps) {
  const t = useT();
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <img className="sidebar__logo" src="/logo.png" alt="Screen Activity Tracker" />
        <div className="sidebar__brandtext">
          <span className="sidebar__title">Activity Tracker</span>
          <span className="sidebar__subtitle">{t("brand.subtitle")}</span>
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
            <span className="sidebar__label">{t(item.key)}</span>
            {item.id === "extension" && extensionConnected && (
              <span className="sidebar__pip" title={t("sidebar.extConnected")} />
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
          {trackingEnabled ? t("sidebar.trackingActive") : t("sidebar.trackingPaused")}
        </span>
      </div>
    </aside>
  );
}
