import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { Drawer } from "@/components/Drawer";
import { AppIcon } from "@/components/AppIcon";
import { Segmented } from "@/components/ui";
import { Stat } from "@/components/charts/Stat";
import { BarList, type BarItem } from "@/components/charts/BarList";
import { Donut } from "@/components/charts/Donut";
import { LineChart, type LineSeries } from "@/components/charts/LineChart";
import { useAppStore } from "@/stores/app";
import { useAsyncData } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { ensureAppIcon, getActivities, getSummary, listCategoryRules } from "@/lib/tauri";
import {
  appLabel,
  CHART_VARS,
  colorForKey,
  formatDay,
  formatDuration,
  formatDurationShort,
  formatTime,
  rangeFor,
  type RangePreset,
} from "@/lib/format";
import type { Activity } from "@/types/activity";

const POLL = 15000;

// Период для карточки «Топ приложений» — независимый от глобального диапазона.
type AppsPeriod = RangePreset | "all";
const APPS_PERIODS: { value: AppsPeriod; key: string }[] = [
  { value: "today", key: "period.day" },
  { value: "week", key: "period.week" },
  { value: "month", key: "period.month" },
  { value: "all", key: "period.all" },
];
function rangeForApps(p: AppsPeriod): { from: number; to: number } {
  return p === "all" ? { from: 0, to: Date.now() } : rangeFor(p);
}

export function DashboardView() {
  const t = useT();
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

  // Префетч реальных иконок для приложений из топа/недавних.
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

  // ----- категории для детализации таймлайна (чекбоксы) -----
  const timelineCats = useMemo(
    () =>
      (cats.data ?? [])
        .filter((b) => b.totalMs > 0 && b.key !== "Без категории" && b.key !== "Uncategorized")
        .map((b) => ({ name: b.key, color: catColor.get(b.key) ?? colorForKey(b.key) })),
    [cats.data, catColor],
  );
  const [selectedCats, setSelectedCats] = useState<Set<string>>(new Set());
  const toggleCat = (name: string) =>
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

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

  // ----- таймлайн (мультисерийный) -----
  const timeline = useMemo(
    () => buildTimelineSeries(list, range, r.from, selectedCats, catColor, t("dash.seriesTotal")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [acts.data, range, selectedCats, catColor],
  );

  const recent = list.slice(0, 10);
  const appsLoading = topApps.loading && !topApps.data;

  // Drill-down: выбранный элемент для панели подробностей.
  const [detail, setDetail] = useState<{
    kind: "app" | "domain" | "category";
    value: string;
  } | null>(null);

  const appsPeriodOptions = APPS_PERIODS.map((o) => ({ value: o.value, label: t(o.key) }));

  return (
    <>
      <div className="dash">
        {/* KPI */}
        <div className="statgrid">
          <Stat
            label={t("dash.activeTime")}
            value={formatDuration(activeMs)}
            hint={t("dash.activeTimeHint", { v: formatDuration(totalMs) })}
            accent
          />
          <Stat
            label={t("dash.idle")}
            value={formatDuration(idleMs)}
            hint={t("dash.idleHint", { p: idlePct })}
          />
          <Stat label={t("dash.apps")} value={String(appCount)} hint={t("dash.appsHint")} />
          <Stat label={t("dash.intervals")} value={String(switches)} hint={t("dash.intervalsHint")} />
        </div>

        {/* Таймлайн — герой во всю ширину */}
        <Card
          title={t("dash.timeline")}
          subtitle={range === "today" ? t("dash.timelineByHour") : t("dash.timelineByDay")}
        >
          {timelineCats.length > 0 && (
            <div className="tl-cats">
              <span className="tl-cats__hint">{t("dash.detail")}</span>
              {timelineCats.map((c) => {
                const on = selectedCats.has(c.name);
                return (
                  <button
                    key={c.name}
                    className={"tl-cat" + (on ? " tl-cat--on" : "")}
                    onClick={() => toggleCat(c.name)}
                    style={on ? { borderColor: c.color } : undefined}
                  >
                    <span
                      className="tl-cat__dot"
                      style={{ background: c.color, opacity: on ? 1 : 0.5 }}
                    />
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
          <LineChart
            series={timeline.series}
            xLabels={timeline.xLabels}
            format={formatDuration}
            yFormat={formatDurationShort}
            labelEvery={timeline.labelEvery}
            highlightIndex={timeline.highlightIndex}
            height={220}
            emptyText={t("dash.timelineEmpty")}
          />
        </Card>

        {/* Топы */}
        <div className="dash__row dash__row--split">
          <Card
            title={t("dash.topApps")}
            actions={
              <Segmented
                compact
                value={appsPeriod}
                options={appsPeriodOptions}
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
                emptyText={t("dash.noDataPeriod")}
                onItemClick={(it) => setDetail({ kind: "app", value: it.label })}
              />
            )}
          </Card>
          <Card title={t("dash.topDomains")} subtitle={t("dash.topDomainsSub")}>
            <BarList
              items={domainBars}
              format={formatDuration}
              emptyText={t("dash.domainsEmpty")}
              onItemClick={(it) => setDetail({ kind: "domain", value: it.label })}
            />
          </Card>
        </div>

        {/* Категории + недавнее */}
        <div className="dash__row dash__row--split">
          <Card title={t("dash.byCategory")} subtitle={t("dash.byCategorySub")}>
            <Donut
              slices={catSlices}
              centerLabel={t("dash.total")}
              centerValue={formatDuration(catSlices.reduce((s, x) => s + x.value, 0))}
              emptyText={t("dash.catsEmpty")}
              onSliceClick={(s) => setDetail({ kind: "category", value: s.label })}
            />
          </Card>
          <Card title={t("dash.recent")} subtitle={t("dash.recentSub")}>
            {recent.length === 0 ? (
              <p className="chart-empty">{t("dash.recentEmpty")}</p>
            ) : (
              <ul className="recent">
                {recent.map((a) => (
                  <li className="recent__row" key={a.id}>
                    <span className="recent__time">{formatTime(a.startedAt)}</span>
                    <AppIcon name={a.appName} domain={a.domain} size={22} />
                    <span className="recent__app" title={a.windowTitle ?? a.appName}>
                      {a.domain ?? appLabel(a.appName)}
                      {a.isIdle && <span className="badge badge--idle">{t("badge.idle")}</span>}
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
        subtitle={detail ? t(`kind.${detail.kind}`) : ""}
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
  const t = useT();
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
    if (kind === "app") key = a.windowTitle ?? "—";
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

  const timeline = buildTimelineSeries(filtered, range, from, new Set(), new Map(), t("dash.seriesTotal"));
  const innerTitle =
    kind === "app" ? t("detail.windows") : kind === "domain" ? t("detail.pages") : t("detail.apps");

  return (
    <div className="detail">
      <div className="statgrid detail__stats">
        <Stat label={t("detail.total")} value={formatDuration(total)} hint={t("detail.totalHint", { p: share })} accent />
        <Stat label={t("detail.active")} value={formatDuration(active)} />
        <Stat label={t("detail.idle")} value={formatDuration(idle)} />
        <Stat label={t("detail.intervals")} value={String(filtered.length)} />
      </div>

      <div className="detail__section">
        <span className="detail__h">{t("detail.timeline")}</span>
        <LineChart
          series={timeline.series}
          xLabels={timeline.xLabels}
          format={formatDuration}
          yFormat={formatDurationShort}
          labelEvery={timeline.labelEvery}
          highlightIndex={timeline.highlightIndex}
          height={150}
        />
      </div>

      <div className="detail__section">
        <span className="detail__h">{innerTitle}</span>
        <BarList items={topInner} format={formatDuration} emptyText={t("detail.noData")} />
      </div>
    </div>
  );
}

// ----- построение серий таймлайна -----
// Основная линия — суммарное активное время по бакетам (часы/дни). Плюс по
// одной линии на каждую выбранную категорию. Ось X: «HH:00» для дня, даты — иначе.
function buildTimelineSeries(
  list: Activity[],
  range: string,
  from: number,
  selected: Set<string>,
  catColor: Map<string, string>,
  totalLabel: string,
): { xLabels: string[]; series: LineSeries[]; labelEvery: number; highlightIndex: number } {
  let buckets: number;
  let labelOf: (i: number) => string;
  let indexOf: (startedAt: number) => number;
  let labelEvery: number;
  let highlightIndex: number;

  if (range === "today") {
    buckets = 25; // часы 00..24 (24:00 замыкает сутки)
    labelOf = (h) => `${String(h).padStart(2, "0")}:00`;
    indexOf = (ms) => new Date(ms).getHours();
    labelEvery = 3;
    highlightIndex = new Date().getHours();
  } else {
    const days = range === "week" ? 7 : 30;
    buckets = days;
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    labelOf = (i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return formatDay(d.getTime());
    };
    indexOf = (ms) => Math.floor((ms - start.getTime()) / 86400000);
    labelEvery = days > 14 ? 5 : 1;
    highlightIndex = days - 1;
  }

  const total: number[] = new Array(buckets).fill(0);
  const perCat = new Map<string, number[]>();
  for (const name of selected) perCat.set(name, new Array(buckets).fill(0) as number[]);

  for (const a of list) {
    if (a.isIdle) continue;
    const idx = indexOf(a.startedAt);
    if (idx < 0 || idx >= buckets) continue;
    total[idx] += a.durationMs;
    const cn = a.categoryName ?? null;
    if (cn && perCat.has(cn)) perCat.get(cn)![idx] += a.durationMs;
  }

  const xLabels = Array.from({ length: buckets }, (_, i) => labelOf(i));
  const series: LineSeries[] = [
    { key: "__total", label: totalLabel, color: "var(--accent)", values: total, primary: true },
  ];
  for (const name of selected) {
    series.push({
      key: name,
      label: name,
      color: catColor.get(name) ?? colorForKey(name),
      values: perCat.get(name) ?? (new Array(buckets).fill(0) as number[]),
    });
  }
  return { xLabels, series, labelEvery, highlightIndex };
}
