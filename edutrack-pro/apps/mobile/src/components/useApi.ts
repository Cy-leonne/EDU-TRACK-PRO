import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

/** Tiny data hook: fetch on mount, expose reload + error, no cache on device. */
export function useApi<T>(path: string | null, query?: Record<string, string | number | boolean | undefined | null>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState<string | null>(null);
  const key = query ? JSON.stringify(query) : '';

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get<T>(path, query ? (JSON.parse(key) as Record<string, string>) : undefined));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this screen.');
    } finally {
      setLoading(false);
    }
  }, [key, path, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}
