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
import { exportExtension, getExtensionStatus } from "@/lib/tauri";
import { formatDuration } from "@/lib/format";

export function ExtensionView() {
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
        title="Статус расширения"
        actions={
          <button
            className="btn btn--icon btn--ghost"
            onClick={() => status.reload()}
            title="Обновить статус"
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
              {connected ? "Расширение подключено" : "Расширение не подключено"}
            </span>
            <span className="ext__hero-sub">
              {connected
                ? s?.lastSeenMsAgo != null
                  ? `последний сигнал ${formatDuration(s.lastSeenMsAgo)} назад`
                  : "получаем данные вкладок"
                : "загрузите расширение в браузер (шаги ниже)"}
            </span>
          </div>
          <span className={"badge " + (connected ? "badge--on" : "badge--off")}>
            <span className="badge__dot" />
            {connected ? "online" : "offline"}
          </span>
        </div>

        {s?.lastUrl && (
          <div className="ext__lasturl">
            <span className="field__label">Последний URL</span>
            <code className="ext__url">{s.lastUrl}</code>
          </div>
        )}

        {error && <p className="ext__error">{error}</p>}
      </Card>

      {/* Шаги установки */}
      <Card title="Установка" subtitle="два шага — и браузерная активность попадёт в трекер">
        <ol className="ext__steps">
          {/* Шаг 1 */}
          <li className="ext__step">
            <span className={"ext__step-num" + (exportPath ? " ext__step-num--done" : "")}>
              {exportPath ? <IconCheck width={16} height={16} /> : "1"}
            </span>
            <div className="ext__step-body">
              <span className="ext__step-title">Скачать файлы расширения</span>
              <span className="ext__step-desc">
                Сохранит папку расширения в «Загрузки» и откроет её в проводнике.
              </span>
              <div className="ext__step-actions">
                <button
                  className="btn btn--primary btn--sm"
                  onClick={doExport}
                  disabled={busy}
                >
                  <IconDownload width={15} height={15} />
                  Скачать расширение
                </button>
              </div>
              {exportPath && (
                <div className="ext__path">
                  <code>{exportPath}</code>
                  <button
                    className="btn btn--icon btn--ghost btn--sm"
                    onClick={() => copy(exportPath)}
                    title="Скопировать путь"
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
              <span className="ext__step-title">Загрузить в браузер</span>
              <span className="ext__step-desc">
                Откройте страницу расширений → включите «Режим разработчика» →
                «Загрузить распакованное расширение» → выберите скачанную папку.
                Регистрация и права администратора не нужны.
              </span>
              <div className="ext__browsers">
                {[
                  ["Chrome", "chrome://extensions"],
                  ["Edge", "edge://extensions"],
                  ["Yandex", "browser://extensions"],
                  ["Brave", "brave://extensions"],
                ].map(([name, url]) => (
                  <button
                    key={name}
                    className="ext__chip"
                    onClick={() => copy(url)}
                    title={`Скопировать ${url}`}
                  >
                    <span>{name}</span>
                    <code>{url}</code>
                    <IconCopy width={13} height={13} />
                  </button>
                ))}
              </div>
            </div>
          </li>
        </ol>
      </Card>

      {/* Детали */}
      <Card title="Как это работает" subtitle="локально, без облака">
        <div className="ext__kv">
          <span className="field__label">Локальный сервер</span>
          <div className="ext__path">
            <code>
              {s?.serverRunning ? `127.0.0.1:${s.serverPort}` : "не запущен"}
            </code>
            <span className={"badge " + (s?.serverRunning ? "badge--on" : "badge--off")}>
              <span className="badge__dot" />
              {s?.serverRunning ? "работает" : "—"}
            </span>
          </div>
        </div>
        <p className="field__hint">
          Расширение находит локальный сервер приложения на 127.0.0.1 и шлёт туда
          URL активной вкладки. Связь только внутри вашего ПК — в интернет ничего
          не отправляется, реестр и админ-права не используются.
        </p>
      </Card>
    </div>
  );
}
