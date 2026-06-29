//! Модели данных. Зеркало src/types/activity.ts — изменения синхронны.
//!
//! Имена полей в camelCase (serde rename_all), чтобы совпадать с TS-контрактом
//! без ручных атрибутов на каждом поле.

use serde::{Deserialize, Serialize};

/// Один интервал активности (строка activities).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
    pub app_name: String,
    pub window_title: Option<String>,
    pub browser: Option<String>,
    pub url: Option<String>,
    pub domain: Option<String>,
    pub category_id: Option<i64>,
    /// Имя категории, подтянутое через LEFT JOIN при выборке. Опционально —
    /// есть не во всех запросах.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub category_name: Option<String>,
    pub is_idle: bool,
}

impl Activity {
    /// Создать "пустую" заглушку для вставки из capture engine.
    /// Все поля времени/идентификаторов проставляются в момент записи.
    pub fn new(
        started_at: i64,
        ended_at: i64,
        app_name: String,
        window_title: Option<String>,
        browser: Option<String>,
        url: Option<String>,
        domain: Option<String>,
        category_id: Option<i64>,
        is_idle: bool,
    ) -> Self {
        let duration_ms = ended_at - started_at;
        Self {
            id: 0,
            started_at,
            ended_at,
            duration_ms,
            app_name,
            window_title,
            browser,
            url,
            domain,
            category_id,
            category_name: None,
            is_idle,
        }
    }
}

/// Тип сопоставления правила категории.
/// Строки — намеренно, чтобы не возиться с enum-кодировкой в IPC и БД.
#[allow(dead_code)] // TODO: использовать для валидации match_type в upsert_rule
pub type CategoryMatchType = String;

/// Правило категоризации.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryRule {
    pub id: Option<i64>,
    pub name: String,
    pub match_type: String,
    pub pattern: String,
    pub color: Option<String>,
    pub priority: i64,
}

/// Фильтры выборки для get_activities / get_summary.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityFilters {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub app_name: Option<String>,
    pub domain: Option<String>,
    pub category_id: Option<i64>,
    pub is_idle: Option<bool>,
}

/// Группировка агрегации.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SummaryGroupBy {
    App,
    Domain,
    Category,
}

/// Один бакет агрегированной сводки.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryBucket {
    pub key: String,
    pub total_ms: i64,
    pub count: i64,
    pub category_id: Option<i64>,
}

/// Диапазон дат.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DateRange {
    pub from: i64,
    pub to: i64,
}

/// Агрегированные показатели за диапазон (KPI дашборда). Считаются в SQL, без
/// выгрузки строк, поэтому корректны и дёшевы даже на годах данных.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RangeStats {
    pub total_ms: i64,
    pub idle_ms: i64,
    pub intervals: i64,
}

/// Бакет таймлайна: ключ (час "00".."23" или дата "YYYY-MM-DD"), имя категории
/// ("" — без категории) и сумма активного времени за бакет.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineBucket {
    pub bucket: String,
    pub category: String,
    pub ms: i64,
}

/// Пара ключ-значение в settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
}

/// Текущая (живая) активность для виджета «Сейчас» на дашборде.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentActivity {
    pub app_name: String,
    pub window_title: Option<String>,
    pub domain: Option<String>,
    pub url: Option<String>,
    pub browser: Option<String>,
    pub is_idle: bool,
    pub category_name: Option<String>,
    pub tracking_enabled: bool,
}

/// Сведения о хранилище для вкладки «Настройки».
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: i64,
    pub activity_count: i64,
    pub rule_count: i64,
    /// unix ms самой ранней записи (None — данных нет).
    pub oldest_ms: Option<i64>,
}
