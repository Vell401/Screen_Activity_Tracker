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
import {
  ensureAppIcon,
  getActivities,
  getRangeStats,
  getSummary,
  getTimeline,
  listCategoryRules,
} from "@/lib/tauri";
import {
  appLabel,
  CHART_VARS,
  colorForKey,
  formatDay,
  formatDuration,
  formatDurationShort,
  formatTime,
  fromDateInput,
  isSameLocalDay,
  rangeFor,
  resolveRange,
  startOfDay,
  type RangePreset,
} from "@/lib/format";
import type { Activity, TimelineBucket } from "@/types/activity";

const POLL = 30000;

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
  const customFrom = useAppStore((s) => s.customFrom);
  const customTo = useAppStore((s) => s.customTo);
  const refreshKey = useAppStore((s) => s.refreshKey);
  const r = useMemo(
    () => resolveRange(range, customFrom, customTo),
    [range, customFrom, customTo, refreshKey],
  );
  const deps = [range, customFrom, customTo, refreshKey];

  const stats = useAsyncData(() => getRangeStats(r), deps, POLL);
  const tl = useAsyncData(() => getTimeline(r, isSameLocalDay(r.from, r.to)), deps, POLL);
  const apps = useAsyncData(() => getSummary(r, "app"), deps, POLL);
  const domains = useAsyncData(() => getSummary(r, "domain"), deps, POLL);
  const cats = useAsyncData(() => getSummary(r, "category"), deps, POLL);
  const acts = useAsyncData(() => getActivities({ from: r.from, to: r.to }), deps, POLL);
  const rules = useAsyncData(listCategoryRules, deps, POLL);

  // Топ приложений — со своим фильтром периода (день/неделя/месяц/всё время).
  const [appsPeriod, setAppsPeriod] = useState<AppsPeriod>(
    range === "custom" ? "today" : range,
  );
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
  // KPI берём из SQL-агрегации (get_range_stats) — корректно и дёшево на любом
  // диапазоне (не зависит от обрезанного LIMIT-ом списка интервалов).
  const totalMs = stats.data?.totalMs ?? 0;
  const idleMs = stats.data?.idleMs ?? 0;
  const activeMs = totalMs - idleMs;
  const appCount = (apps.data ?? []).filter((b) => b.key !== "(unknown)").length;
  const switches = stats.data?.intervals ?? 0;
  const idlePct = totalMs > 0 ? Math.round((idleMs / totalMs) * 100) : 0;
  // Итог по загруженному списку — для панели подробностей (drill-down).
  const listTotalMs = list.reduce((s, a) => s + a.durationMs, 0);

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
    () =>
      seriesFromBuckets(
        tl.data ?? [],
        r.from,
        r.to,
        isSameLocalDay(r.from, r.to),
        selectedCats,
        catColor,
        t("dash.seriesTotal"),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tl.data, r.from, r.to, selectedCats, catColor],
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
          subtitle={
            isSameLocalDay(r.from, r.to) ? t("dash.timelineByHour") : t("dash.timelineByDay")
          }
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
            from={r.from}
            to={r.to}
            totalAll={listTotalMs}
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
  from,
  to,
  totalAll,
}: {
  kind: "app" | "domain" | "category";
  value: string;
  activities: Activity[];
  from: number;
  to: number;
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

  const timeline = buildTimelineSeries(filtered, from, to, new Set(), new Map(), t("dash.seriesTotal"));
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
  from: number,
  to: number,
  selected: Set<string>,
  catColor: Map<string, string>,
  totalLabel: string,
): { xLabels: string[]; series: LineSeries[]; labelEvery: number; highlightIndex: number } {
  let buckets: number;
  let labelOf: (i: number) => string;
  let indexOf: (startedAt: number) => number;
  let labelEvery: number;
  let highlightIndex: number;

  // Один календарный день → разбивка по часам; иначе → по дням.
  if (isSameLocalDay(from, to)) {
    buckets = 25; // часы 00..24 (24:00 замыкает сутки)
    labelOf = (h) => `${String(h).padStart(2, "0")}:00`;
    indexOf = (ms) => new Date(ms).getHours();
    labelEvery = 3;
    // Подсветка текущего часа — только когда смотрим сегодняшний день.
    highlightIndex = isSameLocalDay(from, Date.now()) ? new Date().getHours() : -1;
  } else {
    const start = startOfDay(from);
    const days = Math.max(1, Math.floor((startOfDay(to) - start) / 86400000) + 1);
    buckets = days;
    labelOf = (i) => formatDay(start + i * 86400000);
    indexOf = (ms) => Math.floor((ms - start) / 86400000);
    labelEvery = days > 14 ? 5 : 1;
    // Подсветка сегодняшнего дня, если он в диапазоне; иначе — последний бакет.
    const idxNow = Math.floor((Date.now() - start) / 86400000);
    highlightIndex = idxNow >= 0 && idxNow < days ? idxNow : days - 1;
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

// ----- построение серий из агрегированных бакетов (основной таймлайн) -----
// Данные уже сгруппированы в SQL (get_timeline): по часам "00".."23" или по
// датам "YYYY-MM-DD", с разбивкой по категориям. Здесь только раскладываем их
// на оси и собираем выбранные категории — без выгрузки сырых интервалов.
function seriesFromBuckets(
  rows: TimelineBucket[],
  from: number,
  to: number,
  hourly: boolean,
  selected: Set<string>,
  catColor: Map<string, string>,
  totalLabel: string,
): { xLabels: string[]; series: LineSeries[]; labelEvery: number; highlightIndex: number } {
  let count: number;
  let labelOf: (i: number) => string;
  let indexOf: (bucket: string) => number;
  let labelEvery: number;
  let highlightIndex: number;

  if (hourly) {
    count = 25; // часы 00..24 (24:00 замыкает сутки)
    labelOf = (h) => `${String(h).padStart(2, "0")}:00`;
    indexOf = (b) => parseInt(b, 10);
    labelEvery = 3;
    highlightIndex = isSameLocalDay(from, Date.now()) ? new Date().getHours() : -1;
  } else {
    const start = startOfDay(from);
    const days = Math.max(1, Math.floor((startOfDay(to) - start) / 86400000) + 1);
    count = days;
    labelOf = (i) => formatDay(start + i * 86400000);
    indexOf = (b) => Math.round((fromDateInput(b) - start) / 86400000);
    labelEvery = days > 14 ? 5 : 1;
    const idxNow = Math.floor((Date.now() - start) / 86400000);
    highlightIndex = idxNow >= 0 && idxNow < days ? idxNow : days - 1;
  }

  const total: number[] = new Array(count).fill(0);
  const perCat = new Map<string, number[]>();
  for (const name of selected) perCat.set(name, new Array(count).fill(0) as number[]);

  for (const row of rows) {
    const idx = indexOf(row.bucket);
    if (idx < 0 || idx >= count) continue;
    total[idx] += row.ms;
    if (row.category && perCat.has(row.category)) perCat.get(row.category)![idx] += row.ms;
  }

  const xLabels = Array.from({ length: count }, (_, i) => labelOf(i));
  const series: LineSeries[] = [
    { key: "__total", label: totalLabel, color: "var(--accent)", values: total, primary: true },
  ];
  for (const name of selected) {
    series.push({
      key: name,
      label: name,
      color: catColor.get(name) ?? colorForKey(name),
      values: perCat.get(name) ?? (new Array(count).fill(0) as number[]),
    });
  }
  return { xLabels, series, labelEvery, highlightIndex };
}
