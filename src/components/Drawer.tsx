import type { ReactNode } from "react";
import { IconX } from "./icons";

interface DrawerProps {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Значок слева от заголовка (напр. <AppIcon/>). */
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

/** Выезжающая справа панель с подробностями. */
export function Drawer({ open, title, subtitle, icon, onClose, children }: DrawerProps) {
  return (
    <div className={"drawer" + (open ? " drawer--open" : "")} aria-hidden={!open}>
      <div className="drawer__overlay" onClick={onClose} />
      <aside className="drawer__panel" role="dialog" aria-label={title}>
        <header className="drawer__head">
          <div className="drawer__head-left">
            {icon && <span className="drawer__icon">{icon}</span>}
            <div className="drawer__heading">
              <span className="drawer__title">{title}</span>
              {subtitle && <span className="drawer__sub">{subtitle}</span>}
            </div>
          </div>
          <button className="btn btn--icon btn--ghost" onClick={onClose} title="Закрыть">
            <IconX />
          </button>
        </header>
        <div className="drawer__body">{open && children}</div>
      </aside>
    </div>
  );
}
