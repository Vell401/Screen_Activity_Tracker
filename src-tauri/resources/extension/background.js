/**
 * Screen Activity Tracker — Browser Connector (MV3 service worker).
 *
 * Транспорт: локальный HTTP-сервер приложения на 127.0.0.1. Шлём:
 *   - POST /heartbeat — URL/заголовок активной вкладки (для трекинга);
 *   - POST /favicon   — байты фавикона сайта как есть (PNG/ICO/JPEG/GIF/WebP/
 *     SVG — какой формат сайт отдал, такой и шлём, без перекодирования), чтобы
 *     приложение показывало реальные иконки сайтов, само НЕ обращаясь в интернет.
 * В сеть наружу расширение ходит только за фавиконом уже открытого сайта.
 */

// Список портов должен совпадать с server::PORTS в приложении.
const PORTS = [35745, 35746, 35747, 35748];
let basePort = null;

// Домены, чьи фавиконы уже отправлены в этой сессии SW (чтобы не слать повторно).
const sentFavicons = new Set();
// Состояние media по вкладкам. URL/заголовки здесь не храним дополнительно:
// они уже передаются существующим heartbeat активной вкладки.
const mediaByTab = new Map();
const MEDIA_FRESH_MS = 10_000;

async function findServer() {
  if (basePort) return basePort;
  for (const p of PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${p}/status`, { method: "GET" });
      if (r.ok) {
        basePort = p;
        return p;
      }
    } catch (e) {
      /* порт закрыт — пробуем следующий */
    }
  }
  return null;
}

async function post(path, payload) {
  const p = await findServer();
  if (!p) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${p}${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (e) {
    basePort = null; // сервер мог перезапуститься на другом порту.
    return false;
  }
}

/** hostname без www., в нижнем регистре — как domain в приложении. */
function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (e) {
    return "";
  }
}

/** Хост без буквенной части (IP-адрес и т.п.) — фавикон тянуть бессмысленно. */
function isIpish(host) {
  return !/[a-z]/i.test(host);
}

/** Максимальный размер тела — совпадает с гейтом на бэкенде (server.rs). */
const MAX_FAVICON_BYTES = 512 * 1024;

/**
 * Скачать байты по URL как есть → base64 (или null). Раньше здесь была
 * растеризация в PNG через OffscreenCanvas/createImageBitmap — но
 * createImageBitmap в service worker принципиально не декодирует SVG (нет
 * DOM), из-за чего сайты с одним только SVG-фавиконом молча оставались без
 * иконки. Теперь просто пересылаем байты как есть — приложение само
 * определяет формат по содержимому (icons::sniff_image_mime) и отдаёт
 * правильный MIME для <img src>; браузер/webview рендерит любой формат сам.
 */
async function fetchAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  if (buf.byteLength < 8 || buf.byteLength > MAX_FAVICON_BYTES) return null;
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Достать фавикон сайта и отправить приложению (один раз на домен за сессию).
 * Пробуем несколько источников по очереди: заявленный вкладкой favicon, затем
 * /favicon.ico на самом домене — это покрывает вкладки без favIconUrl.
 * Приложение хранит результат локально и в интернет само не ходит.
 */
async function sendFavicon(domain, favUrl) {
  if (!domain || isIpish(domain)) return;
  if (sentFavicons.has(domain)) return;
  sentFavicons.add(domain);
  const candidates = [];
  if (favUrl && /^(https?:|data:)/.test(favUrl)) candidates.push(favUrl);
  candidates.push(`https://${domain}/favicon.ico`);
  candidates.push(`http://${domain}/favicon.ico`);
  for (const url of candidates) {
    try {
      const data = await fetchAsBase64(url);
      if (data) {
        const ok = await post("/favicon", { domain, data });
        if (ok) return;
      }
    } catch (e) {
      /* недоступно — пробуем следующий источник */
    }
  }
  // Ни один источник не сработал — позволим повторить позже.
  sentFavicons.delete(domain);
}

async function report(reason) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab || !tab.url) {
      post("/heartbeat", { type: "idle", ts: Date.now() });
      return;
    }
    const media = mediaByTab.get(tab.id);
    const mediaPlaying = Boolean(media?.playing && Date.now() - media.updatedAt < MEDIA_FRESH_MS);
    post("/heartbeat", {
      type: "active",
      url: tab.url,
      title: tab.title || "",
      mediaPlaying,
      ts: Date.now(),
      reason,
    });
    // Параллельно — фавикон сайта (fire-and-forget). Пытаемся даже без
    // favIconUrl у вкладки — sendFavicon сам сходит за /favicon.ico.
    const dom = domainOf(tab.url);
    if (dom) sendFavicon(dom, tab.favIconUrl || null);
  } catch (e) {
    /* ignore */
  }
}

chrome.tabs.onActivated.addListener(() => report("activated"));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "loading") mediaByTab.delete(tabId);
  if (tab.active && (info.url || info.status === "complete" || info.favIconUrl)) {
    report("updated");
  }
});

chrome.tabs.onRemoved.addListener((tabId) => mediaByTab.delete(tabId));

chrome.windows.onFocusChanged.addListener((winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) {
    post("/heartbeat", { type: "blur", ts: Date.now() });
  } else {
    report("focus");
  }
});

// Heartbeat + keepalive: будит SW и держит данные свежими.
chrome.alarms.create("ping", { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "ping") report("ping");
});

// Ручной реконнект из popup.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg && msg.type === "media-state" && _s.tab?.id !== undefined) {
    mediaByTab.set(_s.tab.id, { playing: msg.playing === true, updatedAt: Date.now() });
    report("media");
    return false;
  }
  if (msg && msg.cmd === "reconnect") {
    basePort = null;
    report("manual");
    sendResponse({ ok: true });
  }
  return true;
});

chrome.runtime.onStartup.addListener(() => report("startup"));
chrome.runtime.onInstalled.addListener(() => report("installed"));
report("load");
