//! Определение браузера и извлечение URL/домена из заголовка окна.
//!
//! Стратегия (согласована на этапе планирования): расширение/Native Messaging
//! отложены. Вместо этого определяем браузер по имени процесса и пытаемся
//! вытащить URL или хотя бы домен из заголовка окна.
//!
//! Известные браузеры на Windows:
//!   chrome.exe, msedge.exe, browser.exe (Yandex), firefox.exe, opera.exe, brave.exe
//!
//! Заголовок вкладки обычно выглядит как "<Page Title> - <Browser Name>" или
//! "<Page Title> — <Browser Name>". Полный URL виден в title только у части
//! сайтов, поэтому надёжнее ориентироваться на домен: ищем в заголовке
//! известные домены или URL-паттерн.

/// Какой браузер определили (если это вообще браузер).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Browser {
    Chrome,
    Yandex,
    Other,
}

impl Browser {
    #[allow(dead_code)] // понадобится в Фазе 3 для записи activities.browser
    pub fn as_str(&self) -> &'static str {
        match self {
            Browser::Chrome => "chrome",
            Browser::Yandex => "yandex",
            Browser::Other => "other",
        }
    }
}

/// Результат разбора заголовка браузера.
#[derive(Debug, Clone)]
pub struct ParsedBrowser {
    #[allow(dead_code)] // поле browser пока не пишется в БД (Фаза 1); проставится в Фазе 3
    pub browser: Browser,
    /// URL, если удалось однозначно извлечь (редко).
    pub url: Option<String>,
    /// Домен, если удалось определить (например, telegram.org).
    pub domain: Option<String>,
}

/// Определить браузер по имени exe. Возвращает None, если это не браузер.
pub fn detect(app_name: &str) -> Option<Browser> {
    let lower = app_name.to_ascii_lowercase();
    if lower == "chrome.exe" || lower == "chrome" {
        Some(Browser::Chrome)
    } else if lower == "browser.exe" || lower == "browser" {
        // Yandex Browser подписан как browser.exe
        Some(Browser::Yandex)
    } else if matches!(
        lower.as_str(),
        "msedge.exe" | "firefox.exe" | "opera.exe" | "brave.exe"
    ) {
        Some(Browser::Other)
    } else {
        None
    }
}

/// Попытаться извлечь URL/домен из заголовка вкладки браузера.
///
/// Ищем:
///   1. Явный URL (http://... или https://...) — редкость, но берём если есть.
///   2. Полный домен с известным TLD — эвристикой по словам.
pub fn parse_title(title: &str) -> ParsedBrowser {
    // 1. Явный URL в заголовке.
    if let Some(url) = find_url(title) {
        let domain = url_domain(&url);
        return ParsedBrowser {
            // browser проставит вызывающий код
            browser: Browser::Other,
            url: Some(url.clone()),
            domain,
        };
    }
    ParsedBrowser {
        browser: Browser::Other,
        url: None,
        domain: None,
    }
}

/// Найти подстроку-URL в тексте.
fn find_url(text: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    for prefix in ["https://", "http://"] {
        if let Some(start) = lower.find(prefix) {
            let rest = &text[start..];
            // URL заканчивается на пробел/кавычку/конец строки.
            let end = rest
                .find(|c: char| c.is_whitespace() || c == '"' || c == '\'')
                .unwrap_or(rest.len());
            return Some(rest[..end].to_string());
        }
    }
    None
}

/// Вытащить registrable domain из URL (упрощённо: хост без www.).
fn url_domain(url: &str) -> Option<String> {
    let no_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(url);
    let host = no_scheme.split('/').next().unwrap_or(no_scheme);
    let host = host.split(':').next().unwrap_or(host);
    let host = host.trim_start_matches("www.");
    if host.is_empty() {
        None
    } else {
        Some(host.to_ascii_lowercase())
    }
}
