import { Card } from "@/components/Card";

/** Заглушка настроек. Управление settings — Фаза 3. */
export function SettingsView() {
  return (
    <div className="view">
      <Card title="Настройки">
        <p className="muted">
          Здесь будут настройки: интервал опроса, порог простоя (idle),
          пауза/возобновление трекинга, путь к БД.
        </p>
      </Card>
    </div>
  );
}
