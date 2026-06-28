import "./linechart.css";

import { useEffect, useMemo, useRef, useState } from "react";

/** Одна серия (линия) графика — значения по общим точкам оси X. */
export interface LineSeries {
  key: string;
  label: string;
  /** CSS-цвет линии (var(--chart-x) и т.п.). Для primary игнорируется (градиент). */
  color: string;
  /** Значения по точкам оси X (длина = xLabels.length). */
  values: number[];
  /** Основная линия: сине-фиолетовый градиент + заливка под кривой. */
  primary?: boolean;
}

interface LineChartProps {
  /** Одна или несколько серий с общей осью X. */
  series: LineSeries[];
  /** Подписи оси X (напр. «00:00» или «25 июн»). */
  xLabels: string[];
  /** Форматтер значения для тултипа, напр. «2 ч 14 мин». */
  format: (v: number) => string;
  /** Форматтер подписей оси Y (компактный). По умолчанию = format. */
  yFormat?: (v: number) => string;
  emptyText?: string;
  /** Показывать каждую N-ю подпись оси X (чтобы не слипались). */
  labelEvery?: number;
  /** Высота области графика в px. */
  height?: number;
  /** Индекс точки для постоянной подсветки (напр. текущий час). */
  highlightIndex?: number;
}

/** Отступы: слева — место под подписи оси Y. */
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const PAD_TOP = 16;
const PAD_BOTTOM = 12;
const GRID_LINES = 4;

/**
 * Монотонная кубическая интерполяция (Fritsch–Carlson) — без овершута:
 * нет провалов ниже базовой линии и лишних горбов. Работает по точкам {x,y}.
 */
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    dx.push(h);
    slope.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0);
  }

  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const a = m[i] / slope[i];
      const b = m[i + 1] / slope[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * slope[i];
        m[i + 1] = t * b * slope[i];
      }
    }
  }

  let d = `M ${xs[0]} ${ys[0]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i];
    const c1x = xs[i] + h / 3;
    const c1y = ys[i] + (m[i] * h) / 3;
    const c2x = xs[i + 1] - h / 3;
    const c2y = ys[i + 1] - (m[i + 1] * h) / 3;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xs[i + 1]} ${ys[i + 1]}`;
  }
  return d;
}

/** Плавный мультилинейный график активности (с осью Y и заливкой под основной кривой). */
export function LineChart({
  series,
  xLabels,
  format,
  yFormat,
  emptyText = "Нет данных",
  labelEvery = 1,
  height = 190,
  highlightIndex,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Ширину меряем по контейнеру: viewBox = пиксели 1:1 → без искажений stroke.
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ids = useMemo(() => {
    const r = Math.random().toString(36).slice(2);
    return { fill: `lc-fill-${r}`, stroke: `lc-stroke-${r}` };
  }, []);

  const n = xLabels.length;
  let max = 0;
  for (const s of series) for (const v of s.values) if (v > max) max = v;

  if (max <= 0 || n === 0) {
    return (
      <div className="linechart" ref={wrapRef}>
        <p className="chart-empty">{emptyText}</p>
      </div>
    );
  }

  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = height - PAD_TOP - PAD_BOTTOM;
  const step = n > 1 ? innerW / (n - 1) : 0;
  const xAt = (i: number) => PAD_LEFT + (n > 1 ? step * i : innerW / 2);
  const yAt = (v: number) => PAD_TOP + innerH * (1 - v / max);
  const baseY = height - PAD_BOTTOM;
  const yf = yFormat ?? format;

  const plots = series.map((s) => {
    const pts = s.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
    return { s, d: smoothPath(pts) };
  });
  const primary = plots.find((p) => p.s.primary) ?? plots[0];
  const areaPath =
    primary && n > 1
      ? `${primary.d} L ${xAt(n - 1)} ${baseY} L ${xAt(0)} ${baseY} Z`
      : "";

  const colorOf = (s: LineSeries) => (s.primary ? "var(--accent)" : s.color);

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(xAt(i) - vx);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    setHover(nearest);
  }

  const hi = hover;

  return (
    <div className="linechart" ref={wrapRef}>
      <svg
        ref={svgRef}
        className="linechart__svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={ids.fill} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
          {/* Сине-фиолетовый градиент основной линии. */}
          <linearGradient id={ids.stroke} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--chart-5)" />
            <stop offset="50%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--chart-7)" />
          </linearGradient>
        </defs>

        {/* Горизонтальная сетка + подписи оси Y. */}
        {Array.from({ length: GRID_LINES }, (_, i) => {
          const y = PAD_TOP + (innerH / (GRID_LINES - 1)) * i;
          const val = max * (1 - i / (GRID_LINES - 1));
          return (
            <g key={i}>
              <line
                className="linechart__grid"
                x1={PAD_LEFT}
                y1={y}
                x2={width - PAD_RIGHT}
                y2={y}
              />
              <text className="linechart__ylabel" x={PAD_LEFT - 6} y={y + 3} textAnchor="end">
                {yf(val)}
              </text>
            </g>
          );
        })}

        {/* Заливка под основной кривой. */}
        {primary && <path className="linechart__area" d={areaPath} fill={`url(#${ids.fill})`} />}

        {/* Линии категорий (под основной). */}
        {plots
          .filter((p) => !p.s.primary)
          .map((p) => (
            <path
              key={p.s.key}
              className="linechart__line linechart__line--cat"
              d={p.d}
              style={{ stroke: p.s.color }}
            />
          ))}

        {/* Основная линия — сине-фиолетовый градиент. */}
        {primary && (
          <path
            className="linechart__line linechart__line--primary linechart__line--draw"
            d={primary.d}
            stroke={`url(#${ids.stroke})`}
            pathLength={1000}
          />
        )}

        {/* Постоянная подсветка (текущий час/день) на основной линии. */}
        {primary &&
          highlightIndex != null &&
          highlightIndex >= 0 &&
          highlightIndex < n && (
            <circle
              className="linechart__pin"
              cx={xAt(highlightIndex)}
              cy={yAt(primary.s.values[highlightIndex])}
              r={4}
            />
          )}

        {/* Курсор: направляющая + точки по всем сериям. */}
        {hi != null && (
          <>
            <line
              className="linechart__guide"
              x1={xAt(hi)}
              y1={PAD_TOP}
              x2={xAt(hi)}
              y2={baseY}
            />
            {plots.map((p) => (
              <g key={`c-${p.s.key}`}>
                <circle
                  className="linechart__cursor-ring"
                  cx={xAt(hi)}
                  cy={yAt(p.s.values[hi])}
                  r={5}
                  style={{ stroke: colorOf(p.s) }}
                />
                <circle
                  className="linechart__cursor-dot"
                  cx={xAt(hi)}
                  cy={yAt(p.s.values[hi])}
                  r={2.5}
                  style={{ fill: colorOf(p.s) }}
                />
              </g>
            ))}
          </>
        )}
      </svg>

      {/* Плавающий тултип (HTML поверх SVG). */}
      {hi != null && (
        <div
          className="linechart__tip"
          style={{ left: `${(xAt(hi) / width) * 100}%` }}
        >
          <span className="linechart__tip-label">{xLabels[hi]}</span>
          {plots.map((p) => (
            <span className="linechart__tip-row" key={`t-${p.s.key}`}>
              <span className="linechart__tip-dot" style={{ background: colorOf(p.s) }} />
              {p.s.label && <span className="linechart__tip-name">{p.s.label}</span>}
              <span className="linechart__tip-val">{format(p.s.values[hi])}</span>
            </span>
          ))}
        </div>
      )}

      {/* Подписи оси X. */}
      <div
        className="linechart__labels"
        style={{ paddingLeft: PAD_LEFT, paddingRight: PAD_RIGHT }}
      >
        {xLabels.map((lab, i) => (
          <span className="linechart__label" key={lab + i}>
            {i % labelEvery === 0 ? lab : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
