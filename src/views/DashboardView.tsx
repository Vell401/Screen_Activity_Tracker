import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { AppIcon } from "@/components/AppIcon";
import { Segmented } from "@/components/ui";
import { Stat } from "@/components/charts/Stat";
import { BarList, type BarItem } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { LineChart, type LinePoint } from "@/components/charts/LineChart";
import { useAppStore } from "@/stores/app";
import { useAsyncData } from "@/lib/hooks";
import { ensureAppIcon, getActivities, getSummary, listCategoryRules } from "@/lib/tauri";
import {
  appLabel,
  CHART_VARS,
  colorForKey,
  formatDuration,
  formatTime,
  rangeFor,
  type RangePreset,
} from "@/lib/format";
import type { Activity } from "@/types/activity";

const POLL = 15000;

// Период для карточки «Топ приложений» — независимый от глобального диапазона.
type AppsPeriod = RangePreset | "all";
const APPS_PERIOD_OPTIONS: { value: AppsPeriod; label: string }[] = [
  { value: "today", label: "День" },
  { value: "week", label: "Неделя" },
  { value: "month", label: "Месяц" },
  { value: "all", label: "Всё" },
];
function rangeForApps(p: AppsPeriod): { from: number; to: number } {
  return p === "all" ? { from: 0, to: Date.now() } : rangeFor(p);
}

export function DashboardView() {
  const range = useAppStore((s) => s.range);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const r = useMemo(() => rangeFor(range), [range, refreshKey]);
  const deps = [range, refreshKey];

  const apps = useAsyncData(() => getSummary(rangeFor(range), "app"), deps, POLL);
  const domains = useAsyncData(() => getSummary(rangeFor(range), "domain"), deps, POLL);
  const cats = useAsyncData(() => getSummary(rangeFor(range), "category"), deps, POLL);
  const acts = useAsyncData(
    () => {
      const rr = rangeFor(range);
      return getActivities({ from: rr.from, to: rr.to });
    },
    deps,
    POLL,
  );
  const rules = useAsyncData(listCategoryRules, deps, POLL);

  // Топ приложений — со своим фильтром периода (день/неделя/месяц/всё время).
  const [appsPeriod, setAppsPeriod] = useState<AppsPeriod>(range);
  const topApps = useAsyncData(
    () => getSummary(rangeForApps(appsPeriod), "app"),
    [appsPeriod, refreshKey],
    POLL,
  );

  // Префетч реальных иконок для приложений, которые есть в топе / недавних,
  // но ещё не закешированы на бэкенде. Это безопасно дёргать повторно —
  // бэкенд пропускает уже закешированные имена.
  useEffect(() => {
    const names = new Set<string>();
    for (const b of apps.data ?? []) {
      if (b.key && b.key !== "(unknown)") names.add(b.key);
    }
    for (const b of topApps.data ?? []) {
      if (b.key && b.key !== "(unknown)") names.add(b.key);
    }
    for (const a of (acts.data ?? []).slice(0, 30)) {
      if (a.appName) names.add(a.appName);
    }
    for (const n of names) {
      ensureAppIcon(n).catch(() => {});
    }
  }, [apps.data, topApps.data, acts.data]);

  // ----- производные метрики из интервалов -----
  const list = acts.data ?? [];
  const totalMs = list.reduce((s, a) => s + a.durationMs, 0);
  const idleMs = list.filter((a) => a.isIdle).reduce((s, a) => s + a.durationMs, 0);
  const activeMs = totalMs - idleMs;
  const appCount = (apps.data ?? []).filter((b) => b.key !== "(unknown)").length;
  const switches = list.length;
  const idlePct = totalMs > 0 ? Math.round((idleMs / totalMs) * 100) : 0;

  // ----- цвета категорий из правил -----
  const catColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const ru of rules.data ?? []) {
      if (ru.color && !map.has(ru.name)) map.set(ru.name, ru.color);
    }
    return map;
  }, [rules.data]);

  // ----- топ приложений (по выбранному периоду карточки) -----
  const topAppBars: BarItem[] = (topApps.data ?? [])
    .filter((b) => b.key !== "(unknown)")
    .slice(0, 8)
    .map((b, i) => ({
      label: appLabel(b.key),
      value: b.totalMs,
      color: CHART_VARS[i % CHART_VARS.length],
      icon: <AppIcon name={b.key} size={24} />,
    }));

  // ----- топ доменов (только реальные домены) -----
  const domainBars: BarItem[] = (domains.data ?? [])
    .filter((b) => b.key.includes(".") && !b.key.toLowerCase().endsWith(".exe"))
    .slice(0, 8)
    .map((b) => ({
      label: b.key,
      value: b.totalMs,
      color: colorForKey(b.key),
      icon: <AppIcon name={b.key} domain={b.key} size={24} />,
    }));

  // ----- категории (донат) -----
  const catSlices = (cats.data ?? [])
    .filter((b) => b.totalMs > 0)
    .map((b) => ({
      label: b.key,
      value: b.totalMs,
      color: catColor.get(b.key) ?? colorForKey(b.key),
    }));

  // ----- таймлайн (плавный граф) -----
  const timeline = useMemo(
    () => buildTimeline(list, range, r.from),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acts.data, range],
  );

  const recent = list.slice(0, 10);
  const appsLoading = topApps.loading && !topApps.data;

  // Drill-down: выбранный элемент для панели подробностей.
  const [detail, setDetail] = useState<{
    kind: "app" | "domain" | "category";
    value: string;
  } | null>(null);

  const detailKindLabel = { app: "Приложение", domain: "Домен", category: "Категория" };

  return (
    <>
      <div className="dash">
        {/* KPI */}
        <div className="statgrid">
          <Stat
            label="Активное время"
            value={formatDuration(activeMs)}
            hint={`всего за период: ${formatDuration(totalMs)}`}
            accent
          />
          <Stat
            label="Простой"
            value={formatDuration(idleMs)}
            hint={`${idlePct}% от общего времени`}
          />
          <Stat label="Приложений" value={String(appCount)} hint="уникальных за период" />
          <Stat label="Интервалов" value={String(switches)} hint="смен окна/вкладки" />
        </div>

        {/* Таймлайн — герой во всю ширину */}
        <Card
          title="Таймлайн активности"
          subtitle={range === "today" ? "по часам, активное время" : "по дням, активное время"}
        >
          <LineChart
            points={timeline.points}
            format={formatDuration}
            labelEvery={timeline.labelEvery}
            height={220}
            emptyText="Пока нет активности за период"
          />
        </Card>

        {/* Топы */}
        <div className="dash__row dash__row--split">
          <Card
            title="Топ приложений"
            actions={
              <Segmented
                compact
                value={appsPeriod}
                options={APPS_PERIOD_OPTIONS}
                onChange={setAppsPeriod}
              />
            }
          >
            {appsLoading ? (
              <div className="loading-pad">
                <div className="spinner" />
              </div>
            ) : (
              <BarList
                items={topAppBars}
                format={formatDuration}
                emptyText="Нет данных за период"
                onItemClick={(it) => setDetail({ kind: "app", value: it.label })}
              />
            )}
          </Card>
          <Card title="Топ доменов" subtitle="требует расширения или URL в заголовке">
            <BarList
              items={domainBars}
              format={formatDuration}
              emptyText="Нет данных о доменах. Установите расширение во вкладке «Расширение»."
              onItemClick={(it) => setDetail({ kind: "domain", value: it.label })}
            />
          </Card>
        </div>

        {/* Категории + недавнее */}
        <div className="dash__row dash__row--split">
          <Card title="По категориям" subtitle="распределение времени">
            <Donut
              slices={catSlices}
              centerLabel="всего"
              centerValue={formatDuration(catSlices.reduce((s, x) => s + x.value, 0))}
              emptyText="Нет категоризированных данных"
              onSliceClick={(s) => setDetail({ kind: "category", value: s.label })}
            />
          </Card>
          <Card title="Недавняя активность" subtitle="последние интервалы">
            {recent.length === 0 ? (
              <p className="chart-empty">Пока пусто</p>
            ) : (
              <ul className="recent">
                {recent.map((a) => (
                  <li className="recent__row" key={a.id}>
                    <span className="recent__time">{formatTime(a.startedAt)}</span>
                    <AppIcon name={a.appName} domain={a.domain} size={22} />
                    <span className="recent__app" title={a.windowTitle ?? a.appName}>
                      {a.domain ?? appLabel(a.appName)}
                      {a.isIdle && <span className="badge badge--idle">простой</span>}
                    </span>
                    <span className="recent__dur">{formatDuration(a.durationMs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Drawer
        open={!!detail}
        title={detail?.value ?? ""}
        subtitle={detail ? detailKindLabel[detail.kind] : ""}
        icon={
          detail ? (
            <AppIcon
              name={detail.value}
              domain={detail.kind === "domain" ? detail.value : null}
              size={38}
            />
          ) : undefined
        }
        onClose={() => setDetail(null)}
      >
        {detail && (
          <DetailBody
            kind={detail.kind}
            value={detail.value}
            activities={list}
            range={range}
            from={r.from}
            totalAll={totalMs}
          />
        )}
      </Drawer>
    </>
  );
}

// ----- содержимое панели подробностей -----
function DetailBody({
  kind,
  value,
  activities,
  range,
  from,
  totalAll,
}: {
  kind: "app" | "domain" | "category";
  value: string;
  activities: Activity[];
  range: string;
  from: number;
  totalAll: number;
}) {
  const filtered = activities.filter((a) => {
    if (kind === "app") return appLabel(a.appName) === value;
    if (kind === "domain") return a.domain === value;
    return a.categoryName === value;
  });

  const total = filtered.reduce((s, a) => s + a.durationMs, 0);
  const idle = filtered.filter((a) => a.isIdle).reduce((s, a) => s + a.durationMs, 0);
  const active = total - idle;
  const share = totalAll > 0 ? Math.round((total / totalAll) * 100) : 0;

  // Топ вложенных сущностей: окна (app), страницы (domain), приложения (category).
  const groups = new Map<string, number>();
  for (const a of filtered) {
    let key: string;
    if (kind === "app") key = a.windowTitle ?? "(без заголовка)";
    else if (kind === "domain") key = a.windowTitle ?? a.url ?? a.domain ?? "—";
    else key = appLabel(a.appName);
    groups.set(key, (groups.get(key) ?? 0) + a.durationMs);
  }
  const topInner: BarItem[] = Array.from(groups.entries())
    .map(([label, v]) => ({
      label,
      value: v,
      color: colorForKey(label),
      icon: kind === "category" ? <AppIcon name={label} size={22} /> : undefined,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const timeline = buildTimeline(filtered, range, from);
  const innerTitle =
    kind === "app" ? "Окна" : kind === "domain" ? "Страницы" : "Приложения";

  return (
    <div className="detail">
      <div className="statgrid detail__stats">
        <Stat label="Всего" value={formatDuration(total)} hint={`${share}% от периода`} accent />
        <Stat label="Активно" value={formatDuration(active)} />
        <Stat label="Простой" value={formatDuration(idle)} />
        <Stat label="Интервалов" value={String(filtered.length)} />
      </div>

      <div className="detail__section">
        <span className="detail__h">Таймлайн</span>
        <LineChart points={timeline.points} format={formatDuration} labelEvery={timeline.labelEvery} height={150} />
      </div>

      <div className="detail__section">
        <span className="detail__h">{innerTitle}</span>
        <BarList items={topInner} format={formatDuration} emptyText="Нет данных" />
      </div>
    </div>
  );
}

// ----- построение точек таймлайна -----
function buildTimeline(
  list: Activity[],
  range: string,
  from: number,
): { points: LinePoint[]; labelEvery: number } {
  if (range === "today") {
    // 25 точек: часы 00..24. Точка 24:00 — нулевая, замыкает сутки справа,
    // чтобы ось всегда читалась как полный день 00:00–24:00.
    const points: LinePoint[] = Array.from({ length: 25 }, (_, h) => ({
      label: String(h),
      value: 0,
    }));
    for (const a of list) {
      if (a.isIdle) continue;
      const h = new Date(a.startedAt).getHours();
      if (h >= 0 && h < 24) points[h].value += a.durationMs;
    }
    const nowH = new Date().getHours();
    if (points[nowH]) points[nowH].highlight = true;
    return { points, labelEvery: 3 };
  }

  const days = range === "week" ? 7 : 30;
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const points: LinePoint[] = Array.from({ length: days }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return {
      label: d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }),
      value: 0,
    };
  });
  for (const a of list) {
    if (a.isIdle) continue;
    const idx = Math.floor((a.startedAt - start.getTime()) / 86400000);
    if (idx >= 0 && idx < days) points[idx].value += a.durationMs;
  }
  if (points.length) points[points.length - 1].highlight = true;
  return { points, labelEvery: days > 14 ? 5 : 1 };
}
