import { useState } from "react";
import { Card } from "@/components/Card";
import {
  IconCheck,
  IconCopy,
  IconDownload,
  IconPuzzle,
  IconRefresh,
} from "@/components/icons";
import { useAsyncData } from "@/lib/hooks";
import { useT } from "@/lib/i18n";
import { exportExtension, getExtensionStatus } from "@/lib/tauri";
import { formatDuration } from "@/lib/format";

// Все браузеры на движке Chromium — расширение в них работает одинаково.
const BROWSERS: [string, string][] = [
  ["Chrome", "chrome://extensions"],
  ["Edge", "edge://extensions"],
  ["Yandex", "browser://extensions"],
  ["Opera", "opera://extensions"],
  ["Brave", "brave://extensions"],
  ["Vivaldi", "vivaldi://extensions"],
];

export function ExtensionView() {
  const t = useT();
  const status = useAsyncData(getExtensionStatus, [], 3000);
  const [busy, setBusy] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const s = status.data;
  const connected = s?.connected ?? false;

  const doExport = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = await exportExtension();
      setExportPath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
  };

  return (
    <div className="ext">
      {/* Статус */}
      <Card
        title={t("ext.status")}
        actions={
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => status.reload()}
            title={t("ext.refreshStatus")}
          >
            <IconRefresh />
          </button>
        }
      >
        <div className={"ext__hero" + (connected ? " ext__hero--ok" : "")}>
          <div className="ext__hero-icon">
            <IconPuzzle width={28} height={28} />
          </div>
          <div className="ext__hero-text">
            <span className="ext__hero-title">
              {connected ? t("ext.connected") : t("ext.notConnected")}
            </span>
            <span className="ext__hero-sub">
              {connected
                ? s?.lastSeenMsAgo != null
                  ? t("ext.lastSignal", { v: formatDuration(s.lastSeenMsAgo) })
                  : t("ext.receiving")
                : t("ext.loadHint")}
            </span>
          </div>
          <span className={"badge " + (connected ? "badge--on" : "badge--off")}>
            <span className="badge__dot" />
            {connected ? t("ext.online") : t("ext.offline")}
          </span>
        </div>

        {s?.lastUrl && (
          <div className="ext__lasturl">
            <span className="field__label">{t("ext.lastUrl")}</span>
            <code className="ext__url">{s.lastUrl}</code>
          </div>
        )}

        {error && <p className="ext__error">{error}</p>}
      </Card>

      {/* Шаги установки */}
      <Card title={t("ext.install")} subtitle={t("ext.installSub")}>
        <ol className="ext__steps">
          {/* Шаг 1 */}
          <li className="ext__step">
            <span className={"ext__step-num" + (exportPath ? " ext__step-num--done" : "")}>
              {exportPath ? <IconCheck width={16} height={16} /> : "1"}
            </span>
            <div className="ext__step-body">
              <span className="ext__step-title">{t("ext.step1")}</span>
              <span className="ext__step-desc">{t("ext.step1Desc")}</span>
              <div className="ext__step-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={doExport}
                  disabled={busy}
                >
                  <IconDownload width={15} height={15} />
                  {t("ext.download")}
                </button>
              </div>
              {exportPath && (
                <div className="ext__path">
                  <code>{exportPath}</code>
                  <button
                    className="btn btn--icon btn--ghost btn--sm"
                    onClick={() => copy(exportPath)}
                    title={t("ext.copyPath")}
                  >
                    <IconCopy width={14} height={14} />
                  </button>
                </div>
              )}
            </div>
          </li>

          {/* Шаг 2 */}
          <li className="ext__step">
            <span className="ext__step-num">2</span>
            <div className="ext__step-body">
              <span className="ext__step-title">{t("ext.step2")}</span>
              <span className="ext__step-desc">{t("ext.step2Desc")}</span>
              <div className="ext__browsers">
                {BROWSERS.map(([name, url]) => (
                  <button
                    key={name}
                    className="ext__chip"
                    onClick={() => copy(url)}
                    title={`${t("ext.copyPath")}: ${url}`}
                  >
                    <span>{name}</span>
                    <code>{url}</code>
                    <IconCopy width={13} height={13} />
                  </button>
                ))}
              </div>
              <p className="field__hint">{t("ext.firefoxNote")}</p>
            </div>
          </li>
        </ol>
      </Card>

      {/* Детали */}
      <Card title={t("ext.how")} subtitle={t("ext.howSub")}>
        <div className="ext__kv">
          <span className="field__label">{t("ext.localServer")}</span>
          <div className="ext__path">
            <code>
              {s?.serverRunning ? `127.0.0.1:${s.serverPort}` : t("ext.notRunning")}
            </code>
            <span className={"badge " + (s?.serverRunning ? "badge--on" : "badge--off")}>
              <span className="badge__dot" />
              {s?.serverRunning ? t("ext.running") : "—"}
            </span>
          </div>
        </div>
        <p className="field__hint">{t("ext.howHint")}</p>
      </Card>
    </div>
  );
}
