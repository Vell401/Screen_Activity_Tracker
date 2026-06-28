import type { ReactNode } from "react";

export interface BarItem {
  label: string;
  value: number;
  /** CSS-цвет полосы (var(--chart-x) или hex). */
  color?: string;
  /** Вторичная подпись под названием. */
  sub?: string;
  /** Иконка/значок слева (1-2 символа). */
  badge?: string;
  /** Произвольный значок слева (приоритет над badge), напр. <AppIcon/>. */
  icon?: ReactNode;
}

interface BarListProps {
  items: BarItem[];
  /** Форматтер значения справа. */
  format: (v: number) => string;
  /** Текст при пустом списке. */
  emptyText?: string;
  /** Максимум строк (остальное скрывается). */
  limit?: number;
  /** Клик по строке — открыть подробности. */
  onItemClick?: (item: BarItem) => void;
}

/** Горизонтальный список-рейтинг с заполняемыми полосами. */
export function BarList({
  items,
  format,
  emptyText = "Нет данных",
  limit,
  onItemClick,
}: BarListProps) {
  const shown = limit ? items.slice(0, limit) : items;
  const max = shown.reduce((m, i) => Math.max(m, i.value), 0) || 1;

  if (shown.length === 0) {
    return <p className="chart-empty">{emptyText}</p>;
  }

  return (
    <ul className="barlist">
      {shown.map((it, idx) => (
        <li
          className={"barlist__row" + (onItemClick ? " barlist__row--clickable" : "")}
          key={it.label + idx}
          onClick={onItemClick ? () => onItemClick(it) : undefined}
        >
          <div className="barlist__top">
            <span className="barlist__label" title={it.label}>
              {it.icon ? (
                <span className="barlist__icon">{it.icon}</span>
              ) : (
                it.badge && (
                  <span
                    className="barlist__badge"
                    style={{ background: it.color ?? "var(--chart-1)" }}
                  >
                    {it.badge}
                  </span>
                )
              )}
              <span className="barlist__name">{it.label}</span>
              {it.sub && <span className="barlist__sub">{it.sub}</span>}
            </span>
            <span className="barlist__value">{format(it.value)}</span>
          </div>
          <div className="barlist__track">
            <div
              className="barlist__fill"
              style={{
                width: `${Math.max(2, (it.value / max) * 100)}%`,
                background: it.color ?? "var(--chart-1)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
