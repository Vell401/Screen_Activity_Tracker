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

  const run = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (mounted.current) {
        setData(result);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
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
    const id = setInterval(() => run(false), pollMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, ...deps]);

  const reload = useCallback(() => run(false), [run]);
  return { data, loading, error, reload };
}
