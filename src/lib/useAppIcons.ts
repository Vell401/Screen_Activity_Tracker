/**
 * Хук для подгрузки реальных иконок приложений.
 *
 * Использует двухуровневый подход:
 *   1. Bulk-запрос метаданных (AppIcon) по списку имён.
 *   2. По требованию подтягиваем PNG-данные (`data:image/png;base64,...`) для
 *      конкретного имени, лениво.
 *
 * Кеш в памяти: `dataUrls: Map<appName, string|null>` — после первой
 * удачной/неудачной попытки повторно не дёргаем бэкенд.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getAppIconData, getAppIcons } from "@/lib/tauri";

interface IconState {
  /** Метаданные иконок, загруженные bulk-запросом. */
  meta: Map<string, { iconHash: string; updatedAt: number }>;
  /** Data URLs по имени процесса (null = пытались, но не нашли). */
  dataUrls: Map<string, string | null>;
  /** Какие имена сейчас грузятся. */
  loading: Set<string>;
}

const EMPTY_STATE: IconState = {
  meta: new Map(),
  dataUrls: new Map(),
  loading: new Set(),
};

/**
 * Хук принимает массив имён процессов и возвращает:
 *   - `metaFor(name)` — есть ли метаданные в БД
 *   - `urlFor(name)`  — data URL или null
 *   - `ensure(name)`   — подтянуть data URL по требованию (если ещё не)
 *   - `reload(names)`  — перезагрузить метаданные по списку
 */
export function useAppIcons(names: string[]) {
  const [state, setState] = useState<IconState>(EMPTY_STATE);
  const mountedRef = useRef(true);

  // Нормализация имён: lower-case + trim, как на бэкенде.
  const norm = (s: string) => s.trim().toLowerCase();

  // Поддерживаем стабильный список уникальных имён.
  const uniqKey = Array.from(new Set(names.map(norm).filter(Boolean))).sort().join("|");
  const uniqNames = uniqKey ? uniqKey.split("|") : [];

  // Bulk-загрузка метаданных при изменении списка имён.
  useEffect(() => {
    mountedRef.current = true;
    if (uniqNames.length === 0) {
      setState((s) => ({ ...s, meta: new Map() }));
      return;
    }
    let cancelled = false;
    getAppIcons(uniqNames)
      .then((rows) => {
        if (cancelled || !mountedRef.current) return;
        setState((s) => {
          const next = new Map(s.meta);
          for (const r of rows) {
            next.set(norm(r.appName), { iconHash: r.iconHash, updatedAt: r.updatedAt });
          }
          // Убираем из meta имена, которых больше нет в списке.
          const keep = new Set(uniqNames.map(norm));
          for (const k of Array.from(next.keys())) {
            if (!keep.has(k)) next.delete(k);
          }
          return { ...s, meta: next };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // uniqKey стабилен по содержимому → пере-запрос только при изменении списка.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqKey]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const ensure = useCallback((name: string, force = false) => {
    const key = norm(name);
    if (!key) return;
    // `force` позволяет перепроверить кеш для домена, чей фавикон мог приехать
    // от расширения уже после первой (неудачной) попытки.
    let shouldFetch = false;
    setState((s) => {
      if (s.loading.has(key)) return s; // уже грузится
      if (!force && s.dataUrls.has(key)) return s; // уже пытались
      shouldFetch = true;
      const loading = new Set(s.loading);
      loading.add(key);
      return { ...s, loading };
    });
    if (!shouldFetch) return;
    getAppIconData(key)
      .then((url) => {
        if (!mountedRef.current) return;
        setState((s) => {
          const dataUrls = new Map(s.dataUrls);
          dataUrls.set(key, url ?? null);
          const loading = new Set(s.loading);
          loading.delete(key);
          return { ...s, dataUrls, loading };
        });
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setState((s) => {
          const dataUrls = new Map(s.dataUrls);
          dataUrls.set(key, null);
          const loading = new Set(s.loading);
          loading.delete(key);
          return { ...s, dataUrls, loading };
        });
      });
  }, []);

  const urlFor = useCallback(
    (name: string): string | undefined | "loading" => {
      const key = norm(name);
      if (state.loading.has(key)) return "loading";
      if (state.dataUrls.has(key)) return state.dataUrls.get(key) ?? undefined;
      return undefined;
    },
    [state.dataUrls, state.loading],
  );

  const metaFor = useCallback(
    (name: string) => state.meta.get(norm(name)),
    [state.meta],
  );

  const reload = useCallback((nextNames: string[]) => {
    if (nextNames.length === 0) return;
    getAppIcons(nextNames.map(norm))
      .then((rows) => {
        if (!mountedRef.current) return;
        setState((s) => {
          const next = new Map(s.meta);
          for (const r of rows) {
            next.set(norm(r.appName), { iconHash: r.iconHash, updatedAt: r.updatedAt });
          }
          return { ...s, meta: next };
        });
      })
      .catch(() => {});
  }, []);

  return { metaFor, urlFor, ensure, reload };
}