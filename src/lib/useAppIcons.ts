/**
 * Иконки приложений/сайтов из ОБЩЕГО (модульного) кеша.
 *
 * Кеш живёт вне React, поэтому переживает перемонтирование компонентов и общий
 * для всех экземпляров `AppIcon`:
 *   - запросы дедуплицируются (один и тот же ключ грузится один раз);
 *   - принудительный повтор (ретрай для поздно приехавшего фавикона) троттлится;
 *   - при готовности ключа перерисовываются только подписанные на него компоненты.
 *
 * Иконки извлекаются на бэкенде (из .exe для приложений, из фавикона для сайтов)
 * и кешируются в SQLite + на диск; здесь — только чтение data URL по ключу.
 */
import { useCallback, useEffect, useReducer } from "react";
import { getAppIconData } from "@/lib/tauri";

/** Ключ -> data URL (готов) | null (пробовали, иконки нет). */
const cache = new Map<string, string | null>();
/** Ключи, по которым запрос уже в полёте. */
const inflight = new Set<string>();
/** Время последней попытки по ключу — для троттлинга принудительных повторов. */
const lastTry = new Map<string, number>();
/** Подписчики по ключу (компоненты, которым нужна перерисовка при готовности). */
const keyListeners = new Map<string, Set<() => void>>();

/** Не дёргать бэкенд по одному ключу чаще, чем раз в N мс (для force-ретраев). */
const FORCE_THROTTLE_MS = 5000;

const norm = (s: string) => s.trim().toLowerCase();

function notifyKey(key: string) {
  const set = keyListeners.get(key);
  if (set) for (const l of set) l();
}

function fetchIcon(key: string, force: boolean) {
  if (!key || inflight.has(key)) return;
  if (!force && cache.has(key)) return; // уже знаем результат
  if (force && Date.now() - (lastTry.get(key) ?? 0) < FORCE_THROTTLE_MS) return;
  inflight.add(key);
  lastTry.set(key, Date.now());
  getAppIconData(key)
    .then((url) => cache.set(key, url ?? null))
    .catch(() => cache.set(key, null))
    .finally(() => {
      inflight.delete(key);
      notifyKey(key);
    });
}

/**
 * Хук иконок. Принимает список ключей (имена процессов / "site:<домен>") и
 * возвращает `ensure(name, force?)` и `urlFor(name)`.
 */
export function useAppIcons(names: string[]) {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // Стабильная сигнатура списка ключей — пере-подписка только при его изменении.
  const keysSig = Array.from(new Set(names.map(norm).filter(Boolean))).sort().join("|");

  useEffect(() => {
    const ks = keysSig ? keysSig.split("|") : [];
    const cb = () => forceUpdate();
    for (const k of ks) {
      let set = keyListeners.get(k);
      if (!set) {
        set = new Set();
        keyListeners.set(k, set);
      }
      set.add(cb);
    }
    return () => {
      for (const k of ks) {
        const set = keyListeners.get(k);
        set?.delete(cb);
        if (set && set.size === 0) keyListeners.delete(k);
      }
    };
  }, [keysSig]);

  const ensure = useCallback((name: string, force = false) => {
    fetchIcon(norm(name), force);
  }, []);

  const urlFor = useCallback((name: string): string | undefined => {
    const key = norm(name);
    if (inflight.has(key)) return undefined; // грузится
    return cache.get(key) ?? undefined; // null/нет -> undefined
  }, []);

  return { ensure, urlFor };
}
