import "./appicon.css";
import { useEffect, useRef } from "react";
import { colorForKey, appLabel } from "@/lib/format";
import { useAppIcons } from "@/lib/useAppIcons";

/**
 * AppIcon — маленькая узнаваемая иконка для приложения или веб-домена.
 *
 * Приоритет рендера:
 *   1. Реальная PNG-иконка из кеша бэкенда (data URL, лениво по требованию)
 *   2. Известный SVG-глиф для популярных приложений/доменов
 *   3. Монограмма-fallback на детерминированном цвете
 *
 * На бэкенде иконки извлекаются из .exe (Windows), кешируются в SQLite
 * (`app_icons`) и в файлах `data_dir/icons/<sha256>.png`. Здесь мы только
 * отображаем — никаких сетевых запросов.
 */

interface AppIconProps {
  /** Имя процесса/приложения, напр. "chrome.exe", "Code.exe". */
  name: string;
  /** Домен вкладки браузера, напр. "youtube.com" — имеет приоритет для глифа. */
  domain?: string | null;
  /** Сторона плитки в px (по умолчанию 28). */
  size?: number;
}

/** Параметры узнаваемого глифа: фон плитки + внутренний рисунок. */
interface Glyph {
  /** CSS-фон плитки (бренд-цвет допустим только здесь). */
  bg: string;
  /** Содержимое SVG (viewBox 0 0 24 24). */
  body: JSX.Element;
}

/** Нормализуем доменное имя к ключу реестра: без www., в нижнем регистре. */
function normDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

/** Нормализуем имя приложения: нижний регистр без расширения .exe. */
function normName(name: string): string {
  return appLabel(name).trim().toLowerCase();
}

/** Главная «метка» домена для монограммы: github.com → "github". */
function domainLabel(domain: string): string {
  const host = normDomain(domain);
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 1) return host;
  return parts[parts.length - 2] ?? host;
}

/** 1–2 заглавные буквы для монограммы. */
function initials(label: string): string {
  const clean = label.replace(/[^a-zA-Zа-яА-Я0-9]/g, "");
  if (!clean) return "?";
  const upper = clean.toUpperCase();
  const words = label.split(/[\s._-]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return upper.slice(0, 2);
}

// --- Реестр известных глифов --------------------------------------------

const C = "currentColor";

/** Кольцо-«орбита» для браузеров (общий мотив). */
function ringMark(extra?: JSX.Element): JSX.Element {
  return (
    <>
      <circle cx="12" cy="12" r="7.5" fill="none" stroke={C} strokeWidth="2.4" />
      {extra}
    </>
  );
}

const GLYPHS: Record<string, Glyph> = {
  chrome: {
    bg: "radial-gradient(circle at 50% 50%, #4285f4 0 38%, #34a853 38% 70%, #fbbc05 70% 100%)",
    body: (
      <g fill="none">
        <circle cx="12" cy="12" r="9" fill="#fff" opacity="0.12" />
        <circle cx="12" cy="12" r="4.1" fill="#fff" />
        <circle cx="12" cy="12" r="2.6" fill="#1a73e8" />
      </g>
    ),
  },
  edge: {
    bg: "linear-gradient(135deg, #35c1f1 0%, #2d8cff 55%, #0b65d8 100%)",
    body: <g fill="none">{ringMark(<path d="M6 14a6 6 0 0 0 10 1.5" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />)}</g>,
  },
  firefox: {
    bg: "linear-gradient(135deg, #ff9500 0%, #ff5b2e 50%, #e3326b 100%)",
    body: (
      <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M18 8.5A7.5 7.5 0 1 0 19 14c-1-3-3.5-3.5-5-2.5" />
        <circle cx="12" cy="12" r="2.1" fill="#fff" stroke="none" />
      </g>
    ),
  },
  yandex: {
    bg: "linear-gradient(135deg, #ff4d4d 0%, #d61f1f 100%)",
    body: (
      <text x="12" y="17.5" textAnchor="middle" fontFamily="var(--font-sans)" fontWeight="800" fontSize="16" fill="#fff">
        Я
      </text>
    ),
  },
  opera: {
    bg: "linear-gradient(135deg, #ff5f5f 0%, #d6002b 100%)",
    body: <ellipse cx="12" cy="12" rx="4.6" ry="6.4" fill="#fff" />,
  },
  brave: {
    bg: "linear-gradient(135deg, #ff7a33 0%, #e8460f 100%)",
    body: (
      <path
        d="M12 3.5l5.5 2.2-1 7.3L12 20.5 7.5 13l-1-7.3L12 3.5z"
        fill="#fff"
        opacity="0.95"
      />
    ),
  },
  vivaldi: {
    bg: "linear-gradient(135deg, #ff5a5a 0%, #e1132d 100%)",
    body: (
      <path d="M5 8l4 9 3-6 3 6 4-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  vscode: {
    bg: "linear-gradient(135deg, #2aa3ef 0%, #1e7fd6 100%)",
    body: (
      <path
        d="M16.5 4.5L8 12l8.5 7.5V13l-4.5 -1 4.5-1V4.5zM6.2 9.4L4 11l2.2 1 1.4-1.6-1.4-1z"
        fill="#fff"
      />
    ),
  },
  telegram: {
    bg: "linear-gradient(135deg, #37bdf2 0%, #1d93d2 100%)",
    body: (
      <path
        d="M19 6.2L4.8 11.6c-.7.3-.7.9 0 1.1l3.6 1.1 1.4 4.3c.2.5.5.6.9.2l2-1.9 3.6 2.7c.5.3 1 .1 1.1-.5l2.2-11c.1-.7-.3-1-.9-.7zM9.2 13.6l7.1-4.4-5.8 5.2-.2 2.4-1.1-3.2z"
        fill="#fff"
      />
    ),
  },
  discord: {
    bg: "linear-gradient(135deg, #7480ff 0%, #5865f2 100%)",
    body: (
      <g fill="#fff">
        <ellipse cx="9" cy="13" rx="1.5" ry="1.9" />
        <ellipse cx="15" cy="13" rx="1.5" ry="1.9" />
        <path d="M7.5 7.2c1.4-.7 2.9-1 4.5-1s3.1.3 4.5 1c2 2.4 2.7 5.6 2.6 9-1.3 1-2.7 1.7-4.2 2l-.9-1.6c.7-.2 1.4-.5 2-.9-.2-.1-.3-.2-.5-.3a11 11 0 0 1-7.6 0l-.5.3c.6.4 1.3.7 2 .9L10 18.2c-1.5-.3-2.9-1-4.2-2-.1-3.4.6-6.6 2.6-9z" />
      </g>
    ),
  },
  steam: {
    bg: "linear-gradient(135deg, #2a4b66 0%, #0f1b2b 100%)",
    body: (
      <g fill="none">
        <circle cx="9" cy="9.5" r="3.1" fill="none" stroke="#fff" strokeWidth="1.9" />
        <circle cx="15.5" cy="15.5" r="2.4" fill="#fff" />
        <path d="M3.5 14l4 1.7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
      </g>
    ),
  },
  spotify: {
    bg: "linear-gradient(135deg, #2dd56a 0%, #1db954 100%)",
    body: (
      <g fill="none" stroke="#06351c" strokeWidth="2" strokeLinecap="round">
        <path d="M6.5 9c3.5-1 7.5-.6 10.5 1" />
        <path d="M7 12.4c3-.8 6.2-.4 8.6 1" />
        <path d="M7.5 15.6c2.4-.6 5-.3 6.9.9" />
      </g>
    ),
  },
  figma: {
    bg: "linear-gradient(135deg, #2c2c34 0%, #18181c 100%)",
    body: (
      <g>
        <circle cx="14.2" cy="12" r="2.5" fill="#1abcfe" />
        <path d="M9.8 4.5h2.4v5H9.8a2.5 2.5 0 1 1 0-5z" fill="#f24e1e" />
        <path d="M12.2 4.5h2.3a2.5 2.5 0 1 1 0 5h-2.3v-5z" fill="#ff7262" />
        <path d="M9.8 9.5h2.4v5H9.8a2.5 2.5 0 1 1 0-5z" fill="#a259ff" />
        <path d="M9.8 14.5h2.4v2.5a2.5 2.5 0 1 1-2.4-2.5z" fill="#0acf83" />
      </g>
    ),
  },
  notion: {
    bg: "linear-gradient(135deg, #f4f4f2 0%, #e3e3df 100%)",
    body: (
      <g fill="none" stroke="#1a1a1a" strokeWidth="2.1" strokeLinejoin="round" strokeLinecap="round">
        <rect x="5.5" y="4.5" width="13" height="15" rx="1.5" />
        <path d="M9 16V8l6 8V8" />
      </g>
    ),
  },
  youtube: {
    bg: "linear-gradient(135deg, #ff4242 0%, #d80f0f 100%)",
    body: <path d="M10 8.5l6 3.5-6 3.5v-7z" fill="#fff" />,
  },
  claude: {
    bg: "linear-gradient(135deg, #e08a6a 0%, #c15f3c 100%)",
    body: (
      <g stroke="#fff" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="3.8" x2="12" y2="20.2" />
        <line x1="3.8" y1="12" x2="20.2" y2="12" />
        <line x1="6.2" y1="6.2" x2="17.8" y2="17.8" />
        <line x1="17.8" y1="6.2" x2="6.2" y2="17.8" />
      </g>
    ),
  },
  huggingface: {
    bg: "linear-gradient(135deg, #ffd75e 0%, #ffb800 100%)",
    body: (
      <g>
        <circle cx="9.2" cy="11" r="1.35" fill="#3a2c00" />
        <circle cx="14.8" cy="11" r="1.35" fill="#3a2c00" />
        <path d="M8.4 14.2c1.2 1.7 6 1.7 7.2 0" fill="none" stroke="#3a2c00" strokeWidth="1.7" strokeLinecap="round" />
      </g>
    ),
  },
  github: {
    bg: "linear-gradient(135deg, #3a3f47 0%, #1b1f24 100%)",
    body: (
      <path
        d="M12 4.2a7.8 7.8 0 0 0-2.5 15.2c.4.1.5-.2.5-.4v-1.4c-2.2.5-2.7-1-2.7-1-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.8 1.2.8.7 1.2 1.9.9 2.4.7.1-.5.3-.9.5-1.1-1.8-.2-3.6-.9-3.6-3.9 0-.9.3-1.6.8-2.1-.1-.2-.4-1 .1-2.1 0 0 .7-.2 2.2.8a7.5 7.5 0 0 1 4 0c1.5-1 2.2-.8 2.2-.8.5 1.1.2 1.9.1 2.1.5.5.8 1.2.8 2.1 0 3-1.8 3.7-3.6 3.9.3.3.6.8.6 1.6v2.4c0 .2.1.5.6.4A7.8 7.8 0 0 0 12 4.2z"
        fill="#fff"
      />
    ),
  },
  google: {
    bg: "linear-gradient(135deg, #f6f7f9 0%, #e6e8eb 100%)",
    body: (
      <path
        d="M12 10.4v3.2h4.5c-.2 1.1-1.5 3.3-4.5 3.3a5 5 0 1 1 0-10c1.5 0 2.6.6 3.2 1.2l2.2-2.1A8 8 0 1 0 12 20a7.6 7.6 0 0 0 7.8-8c0-.6-.1-1.1-.2-1.6H12z"
        fill="#4285f4"
      />
    ),
  },
  vk: {
    bg: "linear-gradient(135deg, #4a8ff0 0%, #0a6ee0 100%)",
    body: (
      <path
        d="M5 8.5h2.4c.2 2.3 1.2 4.1 2 4.1.5 0 .6-.3.6-1.6V8.6c0-.1.1-.1.2-.1H13c.2 0 .3.1.3.3v3.4c0 .2.1.4.3.4.3 0 .6-.3 1.2-1 .8-1 1.3-2.4 1.5-3 0 0 .1-.1.2-.1h2.2c.3 0 .4.1.3.4-.3 1.1-1.3 2.6-2 3.4-.2.2-.2.3 0 .6.5.5 1.4 1.4 1.8 2.1.2.3 0 .6-.3.6h-2.2c-.3 0-.5-.2-1-.7-.4-.4-.8-.9-1.3-.9-.3 0-.4.2-.4.6v1c0 .3-.1.4-.7.4-1.7 0-3.5-1-4.8-2.9-1.9-2.6-2.4-4.6-2.4-5 0-.2 0-.3.3-.3z"
        fill="#fff"
      />
    ),
  },
  x: {
    bg: "linear-gradient(135deg, #2a2a2a 0%, #050505 100%)",
    body: (
      <path
        d="M6 5h3.2l3 4.2L15.8 5H19l-5.3 6.6L19.4 19h-3.2l-3.3-4.6L8.6 19H5.4l5.6-7L6 5z"
        fill="#fff"
      />
    ),
  },
};

/** Алиасы → канонический ключ реестра. */
const ALIASES: Record<string, keyof typeof GLYPHS> = {
  "chrome": "chrome",
  "google chrome": "chrome",
  "msedge": "edge",
  "edge": "edge",
  "microsoft edge": "edge",
  "firefox": "firefox",
  "mozilla firefox": "firefox",
  "browser": "yandex",
  "yandex": "yandex",
  "yandexbrowser": "yandex",
  "opera": "opera",
  "opera_gx": "opera",
  "brave": "brave",
  "vivaldi": "vivaldi",
  "code": "vscode",
  "vscode": "vscode",
  "code - insiders": "vscode",
  "telegram": "telegram",
  "telegram desktop": "telegram",
  "discord": "discord",
  "steam": "steam",
  "spotify": "spotify",
  "figma": "figma",
  "notion": "notion",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "github.com": "github",
  "google.com": "google",
  "vk.com": "vk",
  "x.com": "x",
  "twitter.com": "x",
  // Bare second-level-domain ключи — для доменного fallback по SLD
  // (yandex.ru → "yandex", web.telegram.org → "telegram" и т.п.).
  "youtube": "youtube",
  "youtu": "youtube",
  "github": "github",
  "google": "google",
  "vk": "vk",
  "x": "x",
  "twitter": "x",
  "claude": "claude",
  "claude.ai": "claude",
  "anthropic": "claude",
  "huggingface": "huggingface",
  "huggingface.co": "huggingface",
};

/** Находим глиф по нормализованному ключу (домен/имя), если он известен. */
function lookup(key: string): Glyph | undefined {
  const canonical = ALIASES[key];
  return canonical ? GLYPHS[canonical] : undefined;
}

/**
 * Иконка приложения/домена.
 *
 * Приоритет:
 *   1. Реальный PNG из кеша бэкенда (data URL).
 *   2. SVG-глиф для известных имён/доменов.
 *   3. Монограмма на детерминированном градиенте.
 */
export function AppIcon({ name, domain, size = 28 }: AppIconProps): JSX.Element {
  const radius = Math.round(size * 0.28);

  const dom = domain ? normDomain(domain) : "";
  const appNorm = normName(name);
  // Ключ кеша бэкенда: lower-case + trim, но БЕЗ среза ".exe" — точно как
  // `icons::normalize_app_name` в Rust. Иначе промах кеша (иконки «не грузятся»).
  const iconKey = name.trim().toLowerCase();
  // Сначала ищем глиф по полному хосту, затем — по SLD (второй уровень домена),
  // чтобы yandex.ru/web.telegram.org/support.claude.com тоже находили бренд-глиф.
  const domGlyph = dom ? lookup(dom) ?? lookup(domainLabel(dom)) : undefined;
  const appGlyph = lookup(appNorm);

  // Запрашиваем реальную иконку для процесса. Это хук — вызывается всегда.
  const { ensure, urlFor } = useAppIcons([iconKey]);
  const realUrl = urlFor(iconKey);
  const requestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!iconKey) return;
    if (requestedRef.current === iconKey) return;
    requestedRef.current = iconKey;
    ensure(iconKey);
  }, [iconKey, ensure]);

  // Фавикон домена может приехать от расширения уже после первого рендера —
  // несколько раз перепроверяем кеш, пока не появится (или не сдадимся).
  const realUrlRef = useRef(realUrl);
  realUrlRef.current = realUrl;
  useEffect(() => {
    if (!iconKey || !domain) return;
    let tries = 0;
    const id = window.setInterval(() => {
      const cur = realUrlRef.current;
      if (typeof cur === "string" && cur.startsWith("data:")) {
        window.clearInterval(id);
        return;
      }
      tries += 1;
      ensure(iconKey, true);
      if (tries >= 6) window.clearInterval(id);
    }, 6000);
    return () => window.clearInterval(id);
  }, [iconKey, domain, ensure]);

  const renderGlyph = (g: Glyph) => (
    <span
      className="app-icon app-icon--glyph"
      style={{ width: size, height: size, borderRadius: radius, background: g.bg }}
      aria-hidden="true"
    >
      <svg className="app-icon__svg" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        {g.body}
      </svg>
    </span>
  );

  // 1) Реальный PNG из кеша: фавикон сайта (для доменов) или иконка .exe.
  if (typeof realUrl === "string" && realUrl.startsWith("data:image")) {
    return (
      <img
        className="app-icon app-icon--real"
        src={realUrl}
        width={size}
        height={size}
        style={{ borderRadius: radius }}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }

  // 2) Глиф известного домена.
  if (domGlyph) return renderGlyph(domGlyph);

  // 3) Глиф известного приложения.
  if (appGlyph) return renderGlyph(appGlyph);

  // 4) Монограмма-fallback.
  const label = dom ? domainLabel(dom) : appLabel(name);
  const mono = initials(label);
  const color = colorForKey(dom || name);
  const fontSize = Math.round(size * (mono.length > 1 ? 0.4 : 0.52));

  return (
    <span
      className="app-icon app-icon__mono"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize,
        background: `linear-gradient(135deg, ${color} 0%, color-mix(in srgb, ${color} 60%, #000) 100%)`,
      }}
      aria-hidden="true"
    >
      {mono}
    </span>
  );
}