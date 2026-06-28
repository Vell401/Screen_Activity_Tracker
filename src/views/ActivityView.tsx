import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { useAppStore } from "@/stores/app";
import { useAsyncData } from "@/lib/hooks";
import { ensureAppIcon, getActivities, listCategoryRules } from "@/lib/tauri";
import {
  appLabel,
  colorForKey,
  formatDateTime,
  formatDuration,
  rangeFor,
} from "@/lib/format";

export function ActivityView() {
  const range = useAppStore((s) => s.range);
  const refreshKey = useAppStore((s) => s.refreshKey);

  const acts = useAsyncData(
    () => {
      const rr = rangeFor(range);
      return getActivities({ from: rr.from, to: rr.to });
    },
    [range, refreshKey],
    15000,
  );
  const rules = useAsyncData(listCategoryRules, []);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [hideIdle, setHideIdle] = useState(false);

  const catColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const ru of rules.data ?? []) if (ru.color && !m.has(ru.name)) m.set(ru.name, ru.color);
    return m;
  }, [rules.data]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const a of acts.data ?? []) if (a.categoryName) set.add(a.categoryName);
    return Array.from(set).sort();
  }, [acts.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (acts.data ?? []).filter((a) => {
      if (hideIdle && a.isIdle) return false;
      if (category !== "all" && a.categoryName !== category) return false;
      if (q) {
        const hay = `${a.appName} ${a.domain ?? ""} ${a.windowTitle ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [acts.data, query, category, hideIdle]);

  // Префетч иконок для приложений из журнала.
  useEffect(() => {
    const names = new Set<string>();
    for (const a of filtered.slice(0, 100)) {
      if (a.appName) names.add(a.appName);
    }
    for (const n of names) {
      ensureAppIcon(n).catch(() => {});
    }
  }, [filtered]);

  const totalMs = filtered.reduce((s, a) => s + a.durationMs, 0);

  return (
    <div className="stack">
      <Card
        title="Журнал активности"
        subtitle={`${filtered.length} интервалов · ${formatDuration(totalMs)}`}
        actions={
          <div className="activity__filters">
            <input
              className="input activity__search"
              placeholder="Поиск: приложение, домен, заголовок…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              className="select activity__catsel"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="all">Все категории</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              className={"btn btn--sm" + (hideIdle ? " btn--primary" : "")}
              onClick={() => setHideIdle((v) => !v)}
            >
              {hideIdle ? "Простой скрыт" : "Скрыть простой"}
            </button>
          </div>
        }
      >
        {acts.loading && !acts.data ? (
          <div className="loading-pad">
            <div className="spinner" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="chart-empty">
            Ничего не найдено. Поработайте за ПК или ослабьте фильтры.
          </p>
        ) : (
          <div className="activity__tablewrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Длительность</th>
                  <th>Приложение</th>
                  <th>Домен / заголовок</th>
                  <th>Категория</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((a) => (
                  <tr key={a.id} className={a.isIdle ? "activity__idlerow" : ""}>
                    <td className="table__muted">{formatDateTime(a.startedAt)}</td>
                    <td className="table__num">{formatDuration(a.durationMs)}</td>
                    <td>{appLabel(a.appName)}</td>
                    <td className="cell-ellipsis" title={a.windowTitle ?? ""}>
                      {a.domain ? (
                        <span className="activity__domain">{a.domain}</span>
                      ) : (
                        <span className="table__muted">
                          {a.windowTitle ?? "—"}
                        </span>
                      )}
                    </td>
                    <td>
                      {a.categoryName ? (
                        <span>
                          <span
                            className="cat-dot"
                            style={{
                              background:
                                catColor.get(a.categoryName) ??
                                colorForKey(a.categoryName),
                            }}
                          />
                          {a.categoryName}
                        </span>
                      ) : a.isIdle ? (
                        <span className="badge badge--idle">простой</span>
                      ) : (
                        <span className="table__muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > 500 && (
              <p className="activity__more">
                Показаны первые 500 из {filtered.length}. Уточните фильтры.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
