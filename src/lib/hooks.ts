/** Небольшие хуки для загрузки данных с периодическим обновлением. */
import { useCallback, useEffect, useRef, useState } from "react";

/** Вызывать `fn` каждые `delayMs` мс (0/undefined — выключено). */
export function useInterval(fn: () => void, delayMs: number | null) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (delayMs == null) return;
    const id = setInterval(() => saved.current(), delayMs);
    return () => clearInterval(id);
  }, [delayMs]);
}

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Загрузка асинхронных данных с авто-перезапросом.
 * `deps` — при изменении перезагружает. `pollMs` — фоновое обновление.
 */
export function useAsyncData<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  pollMs: number | null = null,
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mounted = useRef(true);
  // Поколение запроса: результат устаревшего запроса (например, начатого до
  // смены deps/диапазона) игнорируется, чтобы не перетереть свежие данные.
  const genRef = useRef(0);

  const run = useCallback(async (showSpinner: boolean) => {
    const myGen = ++genRef.current;
    if (showSpinner) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (mounted.current && myGen === genRef.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current && myGen === genRef.current) setError(String(e));
    } finally {
      if (mounted.current && myGen === genRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    run(true);
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (pollMs == null) return;
    // Не опрашиваем, когда окно скрыто/свёрнуто в трей — лишняя фоновая нагрузка.
    // При возврате фокуса сразу обновляемся.
    const id = setInterval(() => {
      if (!document.hidden) run(false);
    }, pollMs);
    const onVisible = () => {
      if (!document.hidden) run(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, ...deps]);

  const reload = useCallback(() => run(false), [run]);
  return { data, loading, error, reload };
}
