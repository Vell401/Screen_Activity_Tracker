import "./linechart.css";

import { useEffect, useMemo, useRef, useState } from "react";

export interface LinePoint {
  /** Подпись под точкой на оси X (час «14» или день «25.06»). */
  label: string;
  value: number;
  /** Постоянно подсветить точку (например, текущий час). */
  highlight?: boolean;
}

interface LineChartProps {
  points: LinePoint[];
  /** Форматтер значения для тултипа, напр. «2 ч 14 мин». */
  format: (v: number) => string;
  emptyText?: string;
  /** Показывать каждую N-ю подпись оси X (чтобы не слипались). */
  labelEvery?: number;
  /** Высота области графика в px. */
  height?: number;
}

/** Геометрия одной точки в координатах viewBox (= пиксели контейнера). */
interface PlotPoint {
  x: number;
  y: number;
  point: LinePoint;
}

/** Внутренние отступы, чтобы линия/точки не липли к краям. */
const PAD_X = 10;
const PAD_TOP = 16;
const PAD_BOTTOM = 12;
/** Количество горизонтальных линий сетки. */
const GRID_LINES = 4;

/**
 * Монотонная кубическая интерполяция (Fritsch–Carlson).
 * В отличие от Catmull-Rom не «выстреливает» за пределы значений: нет провалов
 * ниже базовой линии и лишних горбов на резких пиках — кривая ровная и красивая.
 */
function smoothPath(pts: PlotPoint[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (n === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);

  // Секущие наклоны между соседними точками.
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    dx.push(h);
    slope.push(h !== 0 ? (ys[i + 1] - ys[i]) / h : 0);
  }

  // Касательные в точках.
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    // На локальных экстремумах/плато касательная = 0 → нет овершута.
    m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }

  // Ограничение монотонности (круг радиуса 3 в пространстве α,β).
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

  // Кубические кривые Безье из эрмитовых касательных.
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

/** Плавный линейный график активности с заливкой под кривой. */
export function LineChart({
  points,
  format,
  emptyText = "Нет данных",
  labelEvery = 1,
  height = 190,
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // Ширину меряем по контейнеру: viewBox = пиксели 1:1 → без искажений stroke/кругов.
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

  const max = points.reduce((m, p) => Math.max(m, p.value), 0);

  const gradId = useMemo(
    () => `linechart-fill-${Math.random().toString(36).slice(2)}`,
    [],
  );

  // Геометрия точек в пиксельных координатах.
  const plot = useMemo<PlotPoint[]>(() => {
    if (points.length === 0 || max <= 0) return [];
    const innerW = width - PAD_X * 2;
    const innerH = height - PAD_TOP - PAD_BOTTOM;
    const step = points.length > 1 ? innerW / (points.length - 1) : 0;
    return points.map((point, i) => ({
      x: PAD_X + (points.length > 1 ? step * i : innerW / 2),
      y: PAD_TOP + innerH * (1 - point.value / max),
      point,
    }));
  }, [points, max, height, width]);

  const linePath = useMemo(() => smoothPath(plot), [plot]);
  const areaPath = useMemo(() => {
    if (plot.length === 0) return "";
    const base = height - PAD_BOTTOM;
    const first = plot[0];
    const last = plot[plot.length - 1];
    return `${linePath} L ${last.x} ${base} L ${first.x} ${base} Z`;
  }, [linePath, plot, height]);

  if (max <= 0) {
    return (
      <div className="linechart" ref={wrapRef}>
        <p className="chart-empty">{emptyText}</p>
      </div>
    );
  }

  const baseY = height - PAD_BOTTOM;
  const active = hover !== null ? plot[hover] : null;

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg || plot.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * width;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < plot.length; i++) {
      const dist = Math.abs(plot[i].x - vx);
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    setHover(nearest);
  }

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
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Горизонтальная сетка. */}
        {Array.from({ length: GRID_LINES }, (_, i) => {
          const y = PAD_TOP + ((height - PAD_TOP - PAD_BOTTOM) / (GRID_LINES - 1)) * i;
          return (
            <line
              key={i}
              className="linechart__grid"
              x1={PAD_X}
              y1={y}
              x2={width - PAD_X}
              y2={y}
            />
          );
        })}

        {/* Заливка под кривой. */}
        <path className="linechart__area" d={areaPath} fill={`url(#${gradId})`} />

        {/* Сама кривая (с анимацией прорисовки). */}
        <path
          className="linechart__line linechart__line--draw"
          d={linePath}
          pathLength={1000}
        />

        {/* Постоянные «горящие» точки. */}
        {plot.map((p, i) =>
          p.point.highlight ? (
            <circle key={`pin-${i}`} className="linechart__pin" cx={p.x} cy={p.y} r={4} />
          ) : null,
        )}

        {/* Курсор: направляющая + акцентная точка. */}
        {active && (
          <>
            <line
              className="linechart__guide"
              x1={active.x}
              y1={PAD_TOP}
              x2={active.x}
              y2={baseY}
            />
            <circle className="linechart__cursor-ring" cx={active.x} cy={active.y} r={6} />
            <circle className="linechart__cursor-dot" cx={active.x} cy={active.y} r={3} />
          </>
        )}
      </svg>

      {/* Плавающий тултип (HTML поверх SVG). */}
      {active && (
        <div
          className="linechart__tip"
          style={{ left: `${(active.x / width) * 100}%` }}
        >
          <span className="linechart__tip-label">{active.point.label}</span>
          <span className="linechart__tip-value">{format(active.point.value)}</span>
        </div>
      )}

      {/* Подписи оси X. */}
      <div className="linechart__labels">
        {points.map((p, i) => (
          <span className="linechart__label" key={p.label + i}>
            {i % labelEvery === 0 ? p.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
