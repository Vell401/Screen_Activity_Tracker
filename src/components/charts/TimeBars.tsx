export interface TimeBar {
  /** Подпись под столбцом (час «14» или день «25.06»). */
  label: string;
  value: number;
  /** Подсветить столбец (например, текущий час). */
  highlight?: boolean;
}

interface TimeBarsProps {
  bars: TimeBar[];
  format: (v: number) => string;
  emptyText?: string;
  /** Показывать каждую N-ю подпись (чтобы не слипались). */
  labelEvery?: number;
}

/** Вертикальная гистограмма активности по времени. */
export function TimeBars({
  bars,
  format,
  emptyText = "Нет данных",
  labelEvery = 1,
}: TimeBarsProps) {
  const max = bars.reduce((m, b) => Math.max(m, b.value), 0);

  if (max <= 0) {
    return <p className="chart-empty">{emptyText}</p>;
  }

  return (
    <div className="timebars">
      {bars.map((b, i) => (
        <div className="timebars__col" key={b.label + i}>
          <div className="timebars__barwrap">
            <span className="timebars__tip">{format(b.value)}</span>
            <div
              className={
                "timebars__bar" + (b.highlight ? " timebars__bar--hot" : "")
              }
              style={{ height: `${(b.value / max) * 100}%` }}
            />
          </div>
          <span className="timebars__label">
            {i % labelEvery === 0 ? b.label : ""}
          </span>
        </div>
      ))}
    </div>
  );
}
