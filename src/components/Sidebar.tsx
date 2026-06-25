import "./Sidebar.css";

export type ViewId = "dashboard" | "categories" | "settings";

interface SidebarProps {
  active: ViewId;
  onSelect: (view: ViewId) => void;
  trackingEnabled: boolean;
}

const NAV: { id: ViewId; label: string }[] = [
  { id: "dashboard", label: "Дашборд" },
  { id: "categories", label: "Категории" },
  { id: "settings", label: "Настройки" },
];

export function Sidebar({ active, onSelect, trackingEnabled }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__logo">SAT</span>
        <span className="sidebar__title">Activity Tracker</span>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={
              "sidebar__item" + (active === item.id ? " sidebar__item--active" : "")
            }
            onClick={() => onSelect(item.id)}
          >
            {item.label}
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
