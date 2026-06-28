/**
 * Screen Activity Tracker — Browser Connector (MV3 service worker).
 *
 * Транспорт: локальный HTTP-сервер приложения на 127.0.0.1. Шлём:
 *   - POST /heartbeat — URL/заголовок активной вкладки (для трекинга);
 *   - POST /favicon   — фавикон сайта (PNG), чтобы приложение показывало
 *     реальные иконки сайтов, само НЕ обращаясь в интернет.
 * В сеть наружу расширение ходит только за фавиконом уже открытого сайта.
 */

// Список портов должен совпадать с server::PORTS в приложении.
const PORTS = [35745, 35746, 35747, 35748];
let basePort = null;

// Домены, чьи фавиконы уже отправлены в этой сессии SW (чтобы не слать повторно).
const sentFavicons = new Set();

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
    await fetch(`http://127.0.0.1:${p}${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(payload),
    });
    return true;
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

/**
 * Скачать картинку по URL и нормализовать в PNG 48×48 → base64 (или null).
 * createImageBitmap в service worker не умеет SVG — такой источник бросит
 * ошибку, поэтому в sendFavicon ниже есть запасной /favicon.ico.
 */
async function rasterizeToPng(url) {
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const blob = await resp.blob();
  const bitmap = await createImageBitmap(blob);
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, size, size);
  const pngBlob = await canvas.convertToBlob({ type: "image/png" });
  const bytes = new Uint8Array(await pngBlob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Достать фавикон сайта и отправить приложению (один раз на домен за сессию).
 * Пробуем несколько источников по очереди: заявленный вкладкой favicon, затем
 * /favicon.ico на самом домене — это покрывает сайты с SVG-фавиконом (его
 * воркер не растрит) и вкладки без favIconUrl. Приложение хранит результат
 * локально и в интернет само не ходит.
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
      const png = await rasterizeToPng(url);
      if (png) {
        const ok = await post("/favicon", { domain, png });
        if (ok) return;
      }
    } catch (e) {
      /* недоступно/не растрится — пробуем следующий источник */
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
    post("/heartbeat", {
      type: "active",
      url: tab.url,
      title: tab.title || "",
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

chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete" || info.favIconUrl)) {
    report("updated");
  }
});

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
