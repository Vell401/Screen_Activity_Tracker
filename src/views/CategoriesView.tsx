import { useState } from "react";
import { Card } from "@/components/Card";
import { IconCheck, IconEdit, IconPlus, IconTrash } from "@/components/icons";
import { useAsyncData } from "@/lib/hooks";
import { useAppStore } from "@/stores/app";
import {
  deleteCategoryRule,
  listCategoryRules,
  upsertCategoryRule,
} from "@/lib/tauri";
import type { CategoryMatchType, CategoryRule } from "@/types/activity";

const MATCH_LABELS: Record<CategoryMatchType, string> = {
  app: "Приложение",
  domain: "Домен",
  domain_suffix: "Домен и поддомены",
};

const MATCH_HINTS: Record<CategoryMatchType, string> = {
  app: "совпадение по имени процесса, напр. Code.exe или Telegram",
  domain: "точный домен, напр. github.com",
  domain_suffix: "домен и все поддомены, напр. jetbrains.com",
};

const EMPTY: CategoryRule = {
  name: "",
  matchType: "app",
  pattern: "",
  color: "#5865f2",
  priority: 0,
};

export function CategoriesView() {
  const rules = useAsyncData(listCategoryRules, []);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);

  const [draft, setDraft] = useState<CategoryRule>(EMPTY);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const valid = draft.name.trim() !== "" && draft.pattern.trim() !== "";

  const reset = () => {
    setDraft(EMPTY);
    setEditingId(null);
  };

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await upsertCategoryRule({ ...draft, id: editingId ?? undefined });
      reset();
      rules.reload();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: CategoryRule) => {
    setDraft({ ...r, color: r.color ?? "#5865f2" });
    setEditingId(r.id ?? null);
  };

  const remove = async (id?: number) => {
    if (id == null) return;
    setBusy(true);
    try {
      await deleteCategoryRule(id);
      if (editingId === id) reset();
      rules.reload();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  const list = rules.data ?? [];

  return (
    <div className="cats">
      {/* Форма добавления/редактирования */}
      <Card
        title={editingId ? "Редактировать правило" : "Новое правило"}
        subtitle="приложение/домен → категория"
      >
        <div className="cats__form">
          <div className="field cats__f-name">
            <label className="field__label">Категория</label>
            <input
              className="input"
              placeholder="Напр. Разработка"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>

          <div className="field cats__f-type">
            <label className="field__label">Тип</label>
            <select
              className="select"
              value={draft.matchType}
              onChange={(e) =>
                setDraft({ ...draft, matchType: e.target.value as CategoryMatchType })
              }
            >
              {(Object.keys(MATCH_LABELS) as CategoryMatchType[]).map((k) => (
                <option key={k} value={k}>
                  {MATCH_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="field cats__f-pattern">
            <label className="field__label">Шаблон</label>
            <input
              className="input"
              placeholder="Code.exe / github.com / jetbrains.com"
              value={draft.pattern}
              onChange={(e) => setDraft({ ...draft, pattern: e.target.value })}
            />
          </div>

          <div className="field cats__f-color">
            <label className="field__label">Цвет</label>
            <input
              type="color"
              className="color-input"
              value={draft.color ?? "#5865f2"}
              onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            />
          </div>

          <div className="field cats__f-prio">
            <label className="field__label">Приоритет</label>
            <input
              className="input"
              type="number"
              value={draft.priority}
              onChange={(e) =>
                setDraft({ ...draft, priority: Number(e.target.value) || 0 })
              }
            />
          </div>

          <div className="cats__f-actions">
            <button
              className="btn btn--primary"
              disabled={!valid || busy}
              onClick={save}
            >
              {editingId ? <IconCheck /> : <IconPlus />}
              {editingId ? "Сохранить" : "Добавить"}
            </button>
            {editingId && (
              <button className="btn btn--ghost" onClick={reset} disabled={busy}>
                Отмена
              </button>
            )}
          </div>
        </div>
        <p className="field__hint">{MATCH_HINTS[draft.matchType]}. Выше приоритет — раньше срабатывает при конфликте.</p>
      </Card>

      {/* Список правил */}
      <Card title="Правила" subtitle={`${list.length} шт. · изменения применяются ко всем записям`}>
        {rules.loading && !rules.data ? (
          <div className="loading-pad">
            <div className="spinner" />
          </div>
        ) : list.length === 0 ? (
          <p className="chart-empty">Правил пока нет. Добавьте первое выше.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Категория</th>
                <th>Тип</th>
                <th>Шаблон</th>
                <th>Приоритет</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span
                      className="cat-dot"
                      style={{ background: r.color ?? "var(--accent)" }}
                    />
                    {r.name}
                  </td>
                  <td className="table__muted">{MATCH_LABELS[r.matchType]}</td>
                  <td>
                    <code>{r.pattern}</code>
                  </td>
                  <td className="table__num">{r.priority}</td>
                  <td>
                    <div className="cats__rowactions">
                      <button
                        className="btn btn--icon btn--ghost btn--sm"
                        onClick={() => startEdit(r)}
                        title="Редактировать"
                      >
                        <IconEdit />
                      </button>
                      <button
                        className="btn btn--icon btn--ghost btn--sm"
                        onClick={() => remove(r.id)}
                        title="Удалить"
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
