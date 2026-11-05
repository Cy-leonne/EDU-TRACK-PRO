'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from './api';

/** A tiny data-fetching hook: enough for this app, no extra dependency. */
export function useApiQuery<T>(path: string | null, options: { query?: Record<string, string | number | boolean | undefined | null>; enabled?: boolean; pollMs?: number } = {}) {
  const { query, enabled = true, pollMs } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(Boolean(enabled && path));
  const queryKey = useMemo(() => (query ? JSON.stringify(query) : ''), [query]);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `queryKey` is the serialised query: the effect depends on it (a string) and
  // never on the caller's object literal, which would change identity on every
  // render and re-fetch forever.
  const load = useCallback(
    async (silent = false) => {
      if (!path || !enabled) return;
      if (!silent) setLoading(true);
      setError(null);
      setErrorStatus(null);
      try {
        const params = queryKey ? (JSON.parse(queryKey) as Record<string, string>) : undefined;
        const result = await api.get<T>(path, params);
        if (mounted.current) setData(result);
      } catch (caught) {
        if (!mounted.current) return;
        // A cancelled request (the query changed, or the user navigated) is not
        // an error: leave the previous state untouched.
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        const message = caught instanceof ApiError ? caught.message : 'Something went wrong while loading this page.';
        setError(message);
        setErrorStatus(caught instanceof ApiError ? caught.status : null);
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [path, enabled, queryKey],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!pollMs || !path || !enabled) return;
    const timer = window.setInterval(() => void load(true), pollMs);
    return () => window.clearInterval(timer);
  }, [pollMs, path, enabled, load]);

  return { data, error, errorStatus, loading, reload: load, setData };
}

/** Submit helper: tracks in-flight state and surfaces the API message. */
export function useSubmit<TArgs extends unknown[], TResult>(handler: (...args: TArgs) => Promise<TResult>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        return await handler(...args);
      } catch (caught) {
        const message = caught instanceof ApiError ? caught.message : 'That action could not be completed.';
        setError(message);
        throw caught;
      } finally {
        setPending(false);
      }
    },
    [handler],
  );

  return { submit, pending, error, clearError: () => setError(null) };
}

/** Debounce a value (used by search boxes). */
export function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
