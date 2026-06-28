import { useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { IconCheck, IconEdit, IconPlus, IconTrash } from "@/components/icons";
import { useAsyncData } from "@/lib/hooks";
import { useAppStore } from "@/stores/app";
import { useT, DEFAULT_CATEGORIES } from "@/lib/i18n";
import {
  deleteCategoryRule,
  getSummary,
  listCategoryRules,
  upsertCategoryRule,
} from "@/lib/tauri";
import type { CategoryMatchType, CategoryRule } from "@/types/activity";

/** Сентинел в выпадающем списке — «создать новую категорию». */
const NEW_CAT = "__new__";

const EMPTY: CategoryRule = {
  name: "",
  matchType: "app",
  pattern: "",
  color: "#5865f2",
  priority: 0,
};

export function CategoriesView() {
  const t = useT();
  const rules = useAsyncData(listCategoryRules, []);
  // Все приложения/домены за всё время — чтобы найти некатегоризованные.
  const apps = useAsyncData(() => getSummary({ from: 0, to: Date.now() }, "app"), []);
  const domains = useAsyncData(() => getSummary({ from: 0, to: Date.now() }, "domain"), []);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);

  const [draft, setDraft] = useState<CategoryRule>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [newCat, setNewCat] = useState(false);
  const [busy, setBusy] = useState(false);

  const list = rules.data ?? [];

  // Известные категории: локализованные дефолтные + из существующих правил.
  // Цвет привязан к категории (дефолтный — фиксированный, иначе — из правила).
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of DEFAULT_CATEGORIES) {
      const name = t(d.key);
      if (!map.has(name)) map.set(name, d.color);
    }
    for (const r of list) if (r.name && !map.has(r.name)) map.set(r.name, r.color ?? "#5865f2");
    return Array.from(map, ([name, color]) => ({ name, color }));
  }, [list, t]);
  const catColorMap = useMemo(
    () => new Map(categories.map((c) => [c.name, c.color])),
    [categories],
  );

  // Подходит ли элемент (app/domain) под какое-либо существующее правило.
  const isMatched = (item: string, kind: "app" | "domain") => {
    const it = item.toLowerCase();
    return list.some((r) => {
      const p = r.pattern.trim().toLowerCase();
      if (!p) return false;
      if (r.matchType === "app") return kind === "app" && it.includes(p);
      if (r.matchType === "domain") return kind === "domain" && it === p;
      if (r.matchType === "domain_suffix")
        return kind === "domain" && (it === p || it.endsWith("." + p));
      return false;
    });
  };

  // Некатегоризованные приложения/домены — наполнение «шаблона».
  const uncategorizedApps = useMemo(
    () =>
      (apps.data ?? [])
        .map((b) => b.key)
        .filter((k) => k && k !== "(unknown)" && !isMatched(k, "app")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apps.data, list],
  );
  const uncategorizedDomains = useMemo(
    () =>
      (domains.data ?? [])
        .map((b) => b.key)
        .filter(
          (k) =>
            k.includes(".") && !k.toLowerCase().endsWith(".exe") && !isMatched(k, "domain"),
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domains.data, list],
  );
  const templateOptions = draft.matchType === "app" ? uncategorizedApps : uncategorizedDomains;

  // Тип: без «домен/поддомен» для новых; для legacy-правил показываем как есть.
  const typeOptions: CategoryMatchType[] =
    draft.matchType === "domain_suffix" ? ["app", "domain", "domain_suffix"] : ["app", "domain"];

  const valid = draft.name.trim() !== "" && draft.pattern.trim() !== "";

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
    setNewCat(false);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await upsertCategoryRule({
        ...draft,
        name: draft.name.trim(),
        pattern: draft.pattern.trim(),
        id: editingId ?? undefined,
      });
      reset();
      rules.reload();
      apps.reload();
      domains.reload();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: CategoryRule) => {
    setDraft({ ...r, color: r.color ?? "#5865f2" });
    setEditingId(r.id ?? null);
    setNewCat(false);
  };

  const remove = async (id?: number) => {
    if (id == null) return;
    setBusy(true);
    try {
      await deleteCategoryRule(id);
      if (editingId === id) reset();
      rules.reload();
      apps.reload();
      domains.reload();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  // Выбор категории из списка. Выпадающий список НЕ исчезает — редактор новой
  // категории показывается отдельной строкой ниже.
  const onCatSelect = (value: string) => {
    if (value === NEW_CAT) {
      setNewCat(true);
      setDraft({ ...draft, name: "", color: "#5865f2" });
      return;
    }
    setNewCat(false);
    setDraft({ ...draft, name: value, color: catColorMap.get(value) ?? draft.color });
  };

  const matchHint =
    draft.matchType === "domain_suffix" ? t("match.domainHint") : t(`match.${draft.matchType}Hint`);

  return (
    <div className="cats">
      {/* Форма добавления/редактирования */}
      <Card title={editingId ? t("cats.editRule") : t("cats.newRule")} subtitle={t("cats.ruleSub")}>
        <div className="cats__form">
          <div className="field cats__f-name">
            <label className="field__label">{t("cats.category")}</label>
            <div className="cats__catrow">
              <span className="cat-dot" style={{ background: draft.color ?? "var(--accent)" }} />
              <select
                className="select"
                value={newCat ? NEW_CAT : catColorMap.has(draft.name) ? draft.name : ""}
                onChange={(e) => onCatSelect(e.target.value)}
              >
                <option value="" disabled>
                  {t("cats.selectCat")}
                </option>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
                <option value={NEW_CAT}>➕ {t("cats.newCat")}</option>
              </select>
            </div>
          </div>

          <div className="field cats__f-type">
            <label className="field__label">{t("cats.type")}</label>
            <select
              className="select"
              value={draft.matchType}
              onChange={(e) =>
                setDraft({ ...draft, matchType: e.target.value as CategoryMatchType })
              }
            >
              {typeOptions.map((k) => (
                <option key={k} value={k}>
                  {t(`match.${k}`)}
                </option>
              ))}
            </select>
          </div>

          <div className="field cats__f-pattern">
            <label className="field__label">{t("cats.pattern")}</label>
            <input
              className="input"
              list="cats-template-options"
              placeholder={draft.matchType === "app" ? "Code.exe / Telegram" : "github.com"}
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
            <datalist id="cats-template-options">
              {templateOptions.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>

          <div className="field cats__f-prio">
            <label className="field__label">{t("cats.priority")}</label>
            <input
              className="input"
              type="number"
              value={draft.priority}
              onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
            />
          </div>

          <div className="cats__f-actions">
            <button className="btn btn--primary" disabled={!valid || busy} onClick={save}>
              {editingId ? <IconCheck /> : <IconPlus />}
              {editingId ? t("cats.save") : t("cats.add")}
            </button>
            {editingId && (
              <button className="btn btn--ghost" onClick={reset} disabled={busy}>
                {t("cats.cancel")}
              </button>
            )}
          </div>
        </div>

        {/* Редактор новой категории — выпадающий список выше остаётся на месте. */}
        {newCat && (
          <div className="cats__newrow">
            <input
              className="input"
              placeholder={t("cats.newCatName")}
              autoFocus
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
            <input
              type="color"
              className="color-input"
              value={draft.color ?? "#5865f2"}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              title={t("cats.color")}
            />
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              onClick={() => {
                setNewCat(false);
                setDraft({ ...draft, name: "" });
              }}
            >
              {t("cats.cancel")}
            </button>
          </div>
        )}

        <p className="field__hint">
          {t("cats.hint", {
            match: matchHint,
            kind: draft.matchType === "app" ? t("cats.hintApps") : t("cats.hintSites"),
            n: templateOptions.length,
          })}
        </p>
      </Card>

      {/* Список правил */}
      <Card title={t("cats.rules")} subtitle={t("cats.rulesSub", { n: list.length })}>
        {rules.loading && !rules.data ? (
          <div className="loading-pad">
            <div className="spinner" />
          </div>
        ) : list.length === 0 ? (
          <p className="chart-empty">{t("cats.empty")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("cats.category")}</th>
                <th>{t("cats.type")}</th>
                <th>{t("cats.pattern")}</th>
                <th>{t("cats.priority")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="cat-dot" style={{ background: r.color ?? "var(--accent)" }} />
                    {r.name}
                  </td>
                  <td className="table__muted">{t(`match.${r.matchType}`)}</td>
                  <td>
                    <code>{r.pattern}</code>
                  </td>
                  <td className="table__num">{r.priority}</td>
                  <td>
                    <div className="cats__rowactions">
                      <button
                        className="btn btn--icon btn--ghost btn--sm"
                        onClick={() => startEdit(r)}
                        title={t("cats.edit")}
                      >
                        <IconEdit />
                      </button>
                      <button
                        className="btn btn--icon btn--ghost btn--sm"
                        onClick={() => remove(r.id)}
                        title={t("cats.delete")}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
