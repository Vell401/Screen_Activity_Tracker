import { useState } from "react";
import { Card } from "@/components/Card";
import { Toggle } from "@/components/ui";
import { useAsyncData } from "@/lib/hooks";
import { useAppStore } from "@/stores/app";
import {
  chooseDbLocation,
  clearActivities,
  getAutostart,
  getDbInfo,
  getMinimizeToTray,
  getSettings,
  recategorize,
  setAutostart,
  setMinimizeToTray,
  setTrackingEnabled as setTrackingBackend,
  updateSettings,
} from "@/lib/tauri";
import { formatBytes, formatDay } from "@/lib/format";

const SAMPLE_OPTIONS = [
  { value: "500", label: "0,5 секунды" },
  { value: "1000", label: "1 секунда" },
  { value: "2000", label: "2 секунды" },
  { value: "5000", label: "5 секунд" },
];

const IDLE_OPTIONS = [
  { value: "30000", label: "30 секунд" },
  { value: "60000", label: "1 минута" },
  { value: "120000", label: "2 минуты" },
  { value: "300000", label: "5 минут" },
  { value: "600000", label: "10 минут" },
];

export function SettingsView() {
  const settings = useAsyncData(getSettings, []);
  const db = useAsyncData(getDbInfo, [], 4000);
  const trackingEnabled = useAppStore((s) => s.trackingEnabled);
  const setTracking = useAppStore((s) => s.setTrackingEnabled);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);

  // Система: трей при закрытии, автозапуск, путь к БД.
  const autostartQ = useAsyncData(getAutostart, []);
  const trayQ = useAsyncData(getMinimizeToTray, []);
  const [autostartLocal, setAutostartLocal] = useState<boolean | null>(null);
  const [trayLocal, setTrayLocal] = useState<boolean | null>(null);
  const autostartOn = autostartLocal ?? autostartQ.data ?? false;
  const trayOn = trayLocal ?? trayQ.data ?? true;

  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleAutostart = async () => {
    const next = !autostartOn;
    setAutostartLocal(next);
    try {
      await setAutostart(next);
    } catch {
      setAutostartLocal(!next);
    }
  };

  const toggleTray = async () => {
    const next = !trayOn;
    setTrayLocal(next);
    try {
      await setMinimizeToTray(next);
    } catch {
      setTrayLocal(!next);
    }
  };

  const changeDbLocation = async () => {
    try {
      await chooseDbLocation();
    } catch {
      /* отмена/ошибка диалога */
    }
  };

  const getVal = (key: string, fallback: string) =>
    settings.data?.find((s) => s.key === key)?.value ?? fallback;

  const setVal = async (key: string, value: string) => {
    await updateSettings([{ key, value }]);
    settings.reload();
  };

  const toggleTracking = async () => {
    const next = !trackingEnabled;
    setTracking(next);
    try {
      await setTrackingBackend(next);
    } catch {
      setTracking(!next);
    }
  };

  const doClear = async () => {
    setBusy(true);
    try {
      await clearActivities();
      setConfirmClear(false);
      db.reload();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  const doRecategorize = async () => {
    setBusy(true);
    try {
      await recategorize();
      bumpRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings">
      <Card title="Трекинг" subtitle="захват активности">
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">Захват активности</span>
            <span className="settings__row-desc">
              Когда включено — приложение записывает активное окно каждые
              несколько секунд.
            </span>
          </div>
          <Toggle checked={trackingEnabled} onChange={toggleTracking} />
        </div>

        <div className="settings__grid">
          <div className="field">
            <label className="field__label">Интервал опроса</label>
            <select
              className="select"
              value={getVal("sample_interval_ms", "5000")}
              onChange={(e) => setVal("sample_interval_ms", e.target.value)}
            >
              {SAMPLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field__hint">Чаще — точнее, но чуть больше нагрузка.</span>
          </div>

          <div className="field">
            <label className="field__label">Порог простоя (idle)</label>
            <select
              className="select"
              value={getVal("idle_threshold_ms", "120000")}
              onChange={(e) => setVal("idle_threshold_ms", e.target.value)}
            >
              {IDLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <span className="field__hint">
              Через сколько без ввода считать время простоем.
            </span>
          </div>
        </div>
      </Card>

      <Card title="Система" subtitle="запуск и окно">
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">Сворачивать в трей при закрытии</span>
            <span className="settings__row-desc">
              Крестик прячет окно в трей, трекинг продолжает работать. Полный
              выход — через меню в трее (правый клик по значку).
            </span>
          </div>
          <Toggle checked={trayOn} onChange={toggleTray} />
        </div>
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">Автозапуск с Windows</span>
            <span className="settings__row-desc">
              Запускать приложение при входе в систему (свёрнутым в трей).
            </span>
          </div>
          <Toggle checked={autostartOn} onChange={toggleAutostart} />
        </div>
      </Card>

      <Card title="Данные" subtitle="локальное хранилище SQLite">
        <div className="settings__stats">
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data?.activityCount ?? "—"}
            </span>
            <span className="settings__stat-lbl">записей</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data ? formatBytes(db.data.sizeBytes) : "—"}
            </span>
            <span className="settings__stat-lbl">размер БД</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data?.ruleCount ?? "—"}
            </span>
            <span className="settings__stat-lbl">правил</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data?.oldestMs ? formatDay(db.data.oldestMs) : "—"}
            </span>
            <span className="settings__stat-lbl">с даты</span>
          </div>
        </div>

        <div className="field">
          <label className="field__label">Файл базы данных</label>
          <code className="settings__path">{db.data?.path ?? "—"}</code>
          <button
            className="btn btn--sm"
            onClick={changeDbLocation}
            style={{ marginTop: 8, alignSelf: "flex-start" }}
          >
            Изменить расположение…
          </button>
          <span className="field__hint">
            Приложение перезапустится; текущая БД будет скопирована в выбранную папку.
          </span>
        </div>

        <div className="settings__actions">
          <button className="btn" onClick={doRecategorize} disabled={busy}>
            Пересчитать категории
          </button>

          {confirmClear ? (
            <div className="settings__confirm">
              <span>Удалить всю активность?</span>
              <button className="btn btn--danger btn--sm" onClick={doClear} disabled={busy}>
                Да, удалить
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmClear(false)}
                disabled={busy}
              >
                Отмена
              </button>
            </div>
          ) : (
            <button
              className="btn btn--danger"
              onClick={() => setConfirmClear(true)}
            >
              Очистить данные
            </button>
          )}
        </div>
      </Card>

      <Card title="О приложении" subtitle="Screen Activity Tracker">
        <p className="muted">
          Локальный трекер активности за ПК. Tauri + Rust + React + SQLite. Все
          данные хранятся только на вашем компьютере — ни AI, ни облака, ни
          телеметрии.
        </p>
      </Card>
    </div>
  );
}
