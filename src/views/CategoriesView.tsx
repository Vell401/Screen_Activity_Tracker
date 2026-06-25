import { Card } from "@/components/Card";

/** Заглушка управления категориями. CRUD правил — Фаза 2. */
export function CategoriesView() {
  return (
    <div className="view">
      <Card title="Категории">
        <p className="muted">
          Здесь будет CRUD правил сопоставления: домен/процесс → категория.
          Например: <code>telegram.org</code> → «Мессенджеры»,{" "}
          <code>*.jetbrains.com</code> → «Разработка».
        </p>
      </Card>
    </div>
  );
}
