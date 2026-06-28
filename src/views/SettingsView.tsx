import { useState } from "react";
import { Card } from "@/components/Card";
import { Segmented, Toggle } from "@/components/ui";
import { useAsyncData } from "@/lib/hooks";
import { useAppStore } from "@/stores/app";
import { useT, LANGS, type Lang } from "@/lib/i18n";
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

const SAMPLE_OPTIONS = ["500", "1000", "2000", "5000"];
const IDLE_OPTIONS = ["30000", "60000", "120000", "300000", "600000"];

export function SettingsView() {
  const t = useT();
  const settings = useAsyncData(getSettings, []);
  const db = useAsyncData(getDbInfo, [], 4000);
  const trackingEnabled = useAppStore((s) => s.trackingEnabled);
  const setTracking = useAppStore((s) => s.setTrackingEnabled);
  const bumpRefresh = useAppStore((s) => s.bumpRefresh);
  const lang = useAppStore((s) => s.lang);
  const setLang = useAppStore((s) => s.setLang);

  // Система: трей при закрытии, автозапуск, путь к БД.
  const autostartQ = useAsyncData(getAutostart, []);
  const trayQ = useAsyncData(getMinimizeToTray, []);
  const [autostartLocal, setAutostartLocal] = useState<boolean | null>(null);
  const [trayLocal, setTrayLocal] = useState<boolean | null>(null);
  const autostartOn = autostartLocal ?? autostartQ.data ?? false;
  const trayOn = trayLocal ?? trayQ.data ?? true;

  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState(false);

  const getVal = (key: string, fallback: string) =>
    settings.data?.find((s) => s.key === key)?.value ?? fallback;

  const setVal = async (key: string, value: string) => {
    await updateSettings([{ key, value }]);
    settings.reload();
  };

  const changeLang = async (l: Lang) => {
    setLang(l);
    try {
      await updateSettings([{ key: "language", value: l }]);
    } catch {
      /* ignore */
    }
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
      <Card title={t("set.language")} subtitle={t("set.languageSub")}>
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">{t("set.language")}</span>
            <span className="settings__row-desc">{t("set.languageDesc")}</span>
          </div>
          <Segmented value={lang} options={LANGS} onChange={changeLang} />
        </div>
      </Card>

      <Card title={t("set.tracking")} subtitle={t("set.trackingSub")}>
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">{t("set.capture")}</span>
            <span className="settings__row-desc">{t("set.captureDesc")}</span>
          </div>
          <Toggle checked={trackingEnabled} onChange={toggleTracking} />
        </div>

        <div className="settings__grid">
          <div className="field">
            <label className="field__label">{t("set.sample")}</label>
            <select
              className="select"
              value={getVal("sample_interval_ms", "5000")}
              onChange={(e) => setVal("sample_interval_ms", e.target.value)}
            >
              {SAMPLE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {t(`set.sample${v}`)}
                </option>
              ))}
            </select>
            <span className="field__hint">{t("set.sampleHint")}</span>
          </div>

          <div className="field">
            <label className="field__label">{t("set.idle")}</label>
            <select
              className="select"
              value={getVal("idle_threshold_ms", "120000")}
              onChange={(e) => setVal("idle_threshold_ms", e.target.value)}
            >
              {IDLE_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {t(`set.idle${v}`)}
                </option>
              ))}
            </select>
            <span className="field__hint">{t("set.idleHint")}</span>
          </div>
        </div>
      </Card>

      <Card title={t("set.system")} subtitle={t("set.systemSub")}>
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">{t("set.tray")}</span>
            <span className="settings__row-desc">{t("set.trayDesc")}</span>
          </div>
          <Toggle checked={trayOn} onChange={toggleTray} />
        </div>
        <div className="settings__row">
          <div className="settings__row-text">
            <span className="settings__row-title">{t("set.autostart")}</span>
            <span className="settings__row-desc">{t("set.autostartDesc")}</span>
          </div>
          <Toggle checked={autostartOn} onChange={toggleAutostart} />
        </div>
      </Card>

      <Card title={t("set.data")} subtitle={t("set.dataSub")}>
        <div className="settings__stats">
          <div className="settings__stat">
            <span className="settings__stat-val">{db.data?.activityCount ?? "—"}</span>
            <span className="settings__stat-lbl">{t("set.records")}</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data ? formatBytes(db.data.sizeBytes) : "—"}
            </span>
            <span className="settings__stat-lbl">{t("set.dbSize")}</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">{db.data?.ruleCount ?? "—"}</span>
            <span className="settings__stat-lbl">{t("set.rules")}</span>
          </div>
          <div className="settings__stat">
            <span className="settings__stat-val">
              {db.data?.oldestMs ? formatDay(db.data.oldestMs) : "—"}
            </span>
            <span className="settings__stat-lbl">{t("set.since")}</span>
          </div>
        </div>

        <div className="field">
          <label className="field__label">{t("set.dbFile")}</label>
          <code className="settings__path">{db.data?.path ?? "—"}</code>
          <button
            className="btn btn--sm"
            onClick={changeDbLocation}
            style={{ marginTop: 8, alignSelf: "flex-start" }}
          >
            {t("set.changeLocation")}
          </button>
          <span className="field__hint">{t("set.changeHint")}</span>
        </div>

        <div className="settings__actions">
          <button className="btn" onClick={doRecategorize} disabled={busy}>
            {t("set.recategorize")}
          </button>

          {confirmClear ? (
            <div className="settings__confirm">
              <span>{t("set.confirmClear")}</span>
              <button className="btn btn--danger btn--sm" onClick={doClear} disabled={busy}>
                {t("set.confirmYes")}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmClear(false)}
                disabled={busy}
              >
                {t("cats.cancel")}
              </button>
            </div>
          ) : (
            <button className="btn btn--danger" onClick={() => setConfirmClear(true)}>
              {t("set.clear")}
            </button>
          )}
        </div>
      </Card>

      <Card title={t("set.about")} subtitle="Screen Activity Tracker">
        <p className="muted">{t("set.aboutText")}</p>
      </Card>
    </div>
  );
}
