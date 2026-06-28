//! Локальный HTTP-сервер приёма данных от браузерного расширения.
//!
//! Транспорт «расширение → приложение» без native messaging. Эндпоинты:
//!   - `GET  /status`   — проверка, что сервер жив (расширение ищет порт);
//!   - `POST /heartbeat`— {type,url,title}: пишем `browser_heartbeat.json`
//!     (см. [`crate::bridge`]); capture loop читает этот же файл;
//!   - `POST /favicon`  — {domain, png(base64)}: сохраняем фавикон сайта в кеш
//!     иконок (`app_icons[домен]` + PNG на диске). Приложение само в интернет
//!     не ходит — байты приносит расширение.
//!
//! Сервер мини-ручной (только std::net): один клиент (расширение), простые
//! запросы. CORS открыт.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use serde::Deserialize;

use crate::bridge::{self, BrowserHeartbeat};
use crate::state::AppState;

/// Порты, которые пробуем по очереди. ДОЛЖНЫ совпадать со списком в расширении
/// (`resources/extension/background.js`).
pub const PORTS: &[u16] = &[35745, 35746, 35747, 35748];

/// Максимальный размер тела POST (фавикон в base64 — десятки КБ).
const MAX_BODY: usize = 1024 * 1024;

/// Таймаут чтения/записи одного соединения. Защищает от клиента, который
/// прислал завышенный Content-Length (или молчит): без него read_exact/read_line
/// блокировались бы навсегда.
const IO_TIMEOUT: Duration = Duration::from_secs(5);

/// Heartbeat активной вкладки.
#[derive(Deserialize)]
struct Incoming {
    #[serde(rename = "type", default)]
    kind: String,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

/// Фавикон сайта от расширения.
#[derive(Deserialize)]
struct FaviconMsg {
    #[serde(default)]
    domain: String,
    /// PNG в base64 (возможно с data-URL префиксом).
    #[serde(default)]
    png: String,
}

/// Запустить сервер в фоновом потоке. Биндит первый свободный порт из [`PORTS`].
pub fn spawn(state: Arc<AppState>) {
    std::thread::spawn(move || {
        let bound = PORTS
            .iter()
            .find_map(|&p| TcpListener::bind(("127.0.0.1", p)).ok().map(|l| (l, p)));

        let (listener, port) = match bound {
            Some(x) => x,
            None => {
                log::warn!("local heartbeat server: нет свободного порта из {PORTS:?}");
                return;
            }
        };

        state.server_port.store(port, Ordering::SeqCst);
        log::info!("local heartbeat server on http://127.0.0.1:{port}");

        for stream in listener.incoming().flatten() {
            // Каждое соединение — в отдельном потоке, чтобы один медленный или
            // зависший клиент не блокировал приём остальных запросов. Таймауты
            // ниже гарантируют, что и сам поток-обработчик не зависнет навсегда.
            let st = state.clone();
            std::thread::spawn(move || handle(stream, &st));
        }
    });
}

fn handle(mut stream: TcpStream, state: &AppState) {
    // Без таймаутов клиент с Content-Length больше реально присланного тела
    // (или вовсе молчащий) подвесил бы read_exact/read_line навсегда.
    let _ = stream.set_read_timeout(Some(IO_TIMEOUT));
    let _ = stream.set_write_timeout(Some(IO_TIMEOUT));

    let peer = match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    };
    let mut reader = BufReader::new(peer);

    // Строка запроса: "METHOD PATH HTTP/1.1".
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let path = parts.next().unwrap_or("");

    // Заголовки: ищем Content-Length, читаем до пустой строки.
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).is_err() {
            break;
        }
        if line == "\r\n" || line == "\n" || line.is_empty() {
            break;
        }
        let lower = line.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }

    let read_body = |reader: &mut BufReader<TcpStream>| -> Vec<u8> {
        let n = content_length.min(MAX_BODY);
        let mut body = vec![0u8; n];
        if n > 0 {
            let _ = reader.read_exact(&mut body);
        }
        body
    };

    match (method, path) {
        ("OPTIONS", _) => respond(&mut stream, 204, "", ""),
        ("GET", p) if p.starts_with("/status") => {
            respond(&mut stream, 200, "application/json", "{\"ok\":true}")
        }
        ("POST", p) if p.starts_with("/heartbeat") => {
            let body = read_body(&mut reader);
            if let Ok(msg) = serde_json::from_slice::<Incoming>(&body) {
                let hb = BrowserHeartbeat {
                    kind: msg.kind,
                    url: msg.url,
                    title: msg.title,
                    ts: bridge::now_ms(),
                };
                let _ = bridge::write(&bridge::heartbeat_path(&state.data_dir), &hb);
            }
            respond(&mut stream, 200, "application/json", "{\"ok\":true}");
        }
        ("POST", p) if p.starts_with("/favicon") => {
            let body = read_body(&mut reader);
            if let Ok(msg) = serde_json::from_slice::<FaviconMsg>(&body) {
                if let Some(png) = base64_decode(&msg.png) {
                    store_favicon(state, &msg.domain, &png);
                }
            }
            respond(&mut stream, 200, "application/json", "{\"ok\":true}");
        }
        _ => respond(&mut stream, 404, "text/plain", "not found"),
    }
}

/// Сохранить фавикон сайта в кеш иконок (ключ — домен).
fn store_favicon(state: &AppState, domain: &str, png: &[u8]) {
    // Санити: непустой PNG разумного размера.
    if png.len() < 8 || png.len() > 512 * 1024 {
        return;
    }
    // PNG-сигнатура (расширение нормализует фавикон в PNG через canvas).
    if png[..8] != [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a] {
        return;
    }
    let key = domain.trim().to_ascii_lowercase();
    if key.is_empty() {
        return;
    }

    let hash = crate::icons::sha256_hex(png);
    if crate::icons::write_to_disk(&state.data_dir, &hash, png).is_err() {
        return;
    }
    let icon = crate::db::AppIcon {
        app_name: key,
        icon_hash: hash,
        source: "favicon".to_string(),
        width: 0,
        updated_at: bridge::now_ms(),
    };
    let _ = crate::db::with_conn(&state.db, |c| crate::db::upsert_app_icon(c, &icon));
}

/// Минимальный base64-декодер (стандартный алфавит). Срезает data-URL префикс,
/// игнорирует пробелы/перевод строки, останавливается на паддинге.
fn base64_decode(input: &str) -> Option<Vec<u8>> {
    let s = match input.find("base64,") {
        Some(i) => &input[i + 7..],
        None => input,
    };
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() / 4 * 3);
    let mut buf = 0u32;
    let mut bits = 0u32;
    for &c in s.as_bytes() {
        if c == b'=' {
            break;
        }
        let Some(v) = val(c) else { continue };
        buf = (buf << 6) | v as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

fn respond(stream: &mut TcpStream, code: u16, content_type: &str, body: &str) {
    let status = match code {
        200 => "200 OK",
        204 => "204 No Content",
        404 => "404 Not Found",
        _ => "200 OK",
    };
    let mut resp = format!(
        "HTTP/1.1 {status}\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Access-Control-Allow-Methods: POST, GET, OPTIONS\r\n\
         Access-Control-Allow-Headers: Content-Type\r\n\
         Connection: close\r\n"
    );
    if !content_type.is_empty() {
        resp.push_str(&format!("Content-Type: {content_type}\r\n"));
    }
    resp.push_str(&format!("Content-Length: {}\r\n\r\n{}", body.len(), body));
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();
}
