export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  slices: DonutSlice[];
  /** Подпись под крупным числом в центре. */
  centerLabel: string;
  /** Крупное число в центре (уже отформатировано). */
  centerValue: string;
  emptyText?: string;
  /** Клик по элементу легенды — открыть подробности. */
  onSliceClick?: (slice: DonutSlice) => void;
}

/** Кольцевая диаграмма (SVG) с легендой справа. */
export function Donut({
  slices,
  centerLabel,
  centerValue,
  emptyText = "Нет данных",
  onSliceClick,
}: DonutProps) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const size = 160;
  const stroke = 22;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  if (total <= 0) {
    return <p className="chart-empty">{emptyText}</p>;
  }

  let offset = 0;
  const segments = slices.map((s) => {
    const frac = s.value / total;
    const len = frac * c;
    const seg = {
      color: s.color,
      dash: `${len} ${c - len}`,
      dashoffset: -offset,
    };
    offset += len;
    return seg;
  });

  return (
    <div className="donut">
      <div className="donut__chart">
        <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke="var(--track)"
              strokeWidth={stroke}
            />
            {segments.map((seg, i) => (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={stroke}
                strokeDasharray={seg.dash}
                strokeDashoffset={seg.dashoffset}
                strokeLinecap="butt"
              />
            ))}
          </g>
        </svg>
        <div className="donut__center">
          <span className="donut__value">{centerValue}</span>
          <span className="donut__label">{centerLabel}</span>
        </div>
      </div>

      <ul className="donut__legend">
        {slices.map((s, i) => (
          <li
            className={
              "donut__legend-row" + (onSliceClick ? " donut__legend-row--clickable" : "")
            }
            key={s.label + i}
            onClick={onSliceClick ? () => onSliceClick(s) : undefined}
          >
            <span className="donut__dot" style={{ background: s.color }} />
            <span className="donut__legend-label" title={s.label}>
              {s.label}
            </span>
            <span className="donut__legend-pct">
              {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
