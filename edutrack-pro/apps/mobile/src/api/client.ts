import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

import type { AuthUser, LoginResponse } from '@edutrack/shared-types';

/**
 * API client for the mobile app.
 *
 * Deliberately the same contract as the web client: the same `/api/v1` endpoints,
 * the same `{ success, data }` envelope, the same one-shot refresh-and-replay on a
 * 401. Tokens live in the platform keychain (SecureStore), never in AsyncStorage,
 * because a stolen phone should not hand over a live session.
 */

const FALLBACK_BASE = 'http://10.0.2.2:4000/api/v1'; // Android emulator loopback

export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? FALLBACK_BASE;

const ACCESS_KEY = 'edutrack.accessToken';
const REFRESH_KEY = 'edutrack.refreshToken';
const EXPIRES_KEY = 'edutrack.expiresAt';

/** The signed-in account, exactly as the API describes it (shared-types AuthUser). */
export type SessionUser = AuthUser;

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: SessionUser;
}

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const secure = {
  async get(key: string): Promise<string | null> {
    try {
      return await SecureStore.getItemAsync(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await SecureStore.setItemAsync(key, value);
    } catch {
      /* keychain unavailable (e.g. web target): the session simply will not persist */
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      /* ignore */
    }
  },
};

let memory: StoredSession | null = null;
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export async function loadSession(): Promise<StoredSession | null> {
  if (memory) return memory;
  const [accessToken, refreshToken, expiresAt] = await Promise.all([secure.get(ACCESS_KEY), secure.get(REFRESH_KEY), secure.get(EXPIRES_KEY)]);
  if (!accessToken || !refreshToken) return null;
  memory = {
    accessToken,
    refreshToken,
    expiresAt: Number(expiresAt ?? 0),
    user: JSON.parse((await secure.get('edutrack.user')) ?? 'null') as SessionUser,
  };
  return memory;
}

export async function saveSession(session: StoredSession): Promise<void> {
  memory = session;
  await Promise.all([
    secure.set(ACCESS_KEY, session.accessToken),
    secure.set(REFRESH_KEY, session.refreshToken),
    secure.set(EXPIRES_KEY, String(session.expiresAt)),
    secure.set('edutrack.user', JSON.stringify(session.user)),
  ]);
}

export async function clearSession(): Promise<void> {
  memory = null;
  await Promise.all([ACCESS_KEY, REFRESH_KEY, EXPIRES_KEY, 'edutrack.user'].map((key) => secure.remove(key)));
}

function buildUrl(path: string, query?: Record<string, string | number | boolean | undefined | null>): string {
  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message =
      (payload as { message?: string | string[] } | null)?.message ??
      (response.status === 401 ? 'Your session has ended. Please sign in again.' : 'The request could not be completed.');
    throw new ApiError(Array.isArray(message) ? message.join(' ') : message, response.status, payload);
  }
  return ((payload as { data?: T } | null)?.data ?? (payload as T)) as T;
}

async function refreshSession(): Promise<boolean> {
  const session = await loadSession();
  if (!session?.refreshToken) return false;
  try {
    const response = await fetch(buildUrl('/auth/refresh'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken, clientType: 'MOBILE' }),
    });
    if (!response.ok) return false;
    const data = (await parse<LoginResponse>(response)) as LoginResponse;
    await saveSession({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + (data.expiresIn ?? 900) * 1000,
      user: data.user,
    });
    return true;
  } catch {
    return false;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  auth?: boolean;
  retryOn401?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, auth = true, retryOn401 = true } = options;
  const session = auth ? await loadSession() : null;

  const response = await fetch(buildUrl(path, query), {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 401 && auth && retryOn401) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, { ...options, retryOn401: false });
    await clearSession();
    onUnauthorized?.();
    throw new ApiError('Your session has ended. Please sign in again.', 401);
  }

  return parse<T>(response);
}

/** Multipart upload used for hand-ins (camera or library) and assessment evidence. */
export async function upload<T>(
  path: string,
  file: { uri: string; name: string; type: string },
  fields: Record<string, string> = {},
): Promise<T> {
  const session = await loadSession();
  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);

  const url = `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: form,
  });
  return parse<T>(response);
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload,
};
