import { Card } from "@/components/Card";

/**
 * Заглушка дашборда. Наполнение данными — Фаза 3 (после capture engine).
 * Сейчас просто показывает, что каркас запустился и IPC-обёртки на месте.
 */
export function DashboardView() {
  return (
    <div className="view">
      <Card title="Сводка за день">
        <p className="muted">
          Здесь появятся KPI: общее время активности, топ приложений и доменов,
          распределение по категориям. Данные начнут наполняться после запуска
          capture engine (Фаза 1).
        </p>
      </Card>

      <Card title="Топ приложений">
        <p className="muted">График топа приложений по суммарному времени.</p>
      </Card>

      <Card title="Топ доменов">
        <p className="muted">
          Браузерная активность, сгруппированная по домену (telegram.org,
          github.com и т.д.).
        </p>
      </Card>
    </div>
  );
}
