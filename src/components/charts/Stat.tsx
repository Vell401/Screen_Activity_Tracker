import type { ReactNode } from "react";

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  /** Акцентная (градиентная) карточка для ключевого KPI. */
  accent?: boolean;
  icon?: ReactNode;
}

/** KPI-карточка: крупное число + подпись. */
export function Stat({ label, value, hint, accent, icon }: StatProps) {
  return (
    <div className={"stat" + (accent ? " stat--accent" : "")}>
      {icon && <span className="stat__icon">{icon}</span>}
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint && <span className="stat__hint">{hint}</span>}
    </div>
  );
}
