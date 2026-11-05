'use client';

/**
 * Browser API client.
 *
 * * Calls are relative (`/api/v1/...`) and proxied to the Nest API by the Next
 *   server, so no API host is exposed to the browser and there is no CORS setup.
 * * The browser never stores access or refresh tokens in JavaScript storage.
 *   The API sets HttpOnly SameSite cookies, and the Next proxy forwards them.
 *   On a 401 the client rotates the refresh cookie and retries once.
 * * Errors are normalised into `ApiError` with the API's message so screens can
 *   show the real reason (including validation details) instead of "failed".
 */

import type { Role } from './types';

export interface StoredSession {
  /** In-memory expiry hint only; credentials remain in HttpOnly cookies. */
  expiresAt: number;
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    schoolId: string;
    schoolName: string;
    membershipId?: string;
    permissions: string[];
    teacherProfileId?: string | null;
    parentProfileId?: string | null;
    timezone?: string;
    mustChangePassword?: boolean;
  };
}

let currentSession: StoredSession | null = null;

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
  get isAuthError() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403 || this.status === 401;
  }
}

export function loadSession(): StoredSession | null {
  return typeof window === 'undefined' ? null : currentSession;
}

/** Persist only non-secret user context in memory; HttpOnly cookies hold tokens. */
export function saveSession(session: StoredSession | null) {
  currentSession = session;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /** Raw body uploads (FormData) skip JSON encoding. */
  form?: FormData;
  signal?: AbortSignal;
  /** Set false for the sign-in call itself (no bearer token yet). */
  auth?: boolean;
};

let refreshInFlight: Promise<StoredSession | null> | null = null;
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null) {
  onSessionExpired = handler;
}

function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = path.startsWith('/api/') ? path : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function parse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(payload: any, fallback: string): { message: string; details?: unknown } {
  if (!payload) return { message: fallback };
  if (Array.isArray(payload.message)) return { message: payload.message.join('; '), details: payload.message };
  if (typeof payload.message === 'string') return { message: payload.message, details: payload.details };
  if (typeof payload === 'string') return { message: payload.slice(0, 300) };
  return { message: fallback };
}

async function refreshSession(): Promise<StoredSession | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientType: 'WEB' }),
          credentials: 'same-origin',
          cache: 'no-store',
        });
        if (!response.ok) throw new ApiError(response.status, 'Session expired');
        const payload = await parse(response);
        const data = payload?.data;
        if (!data?.user) throw new ApiError(401, 'Session expired');
        const next: StoredSession = {
          expiresAt: Date.now() + (data.expiresIn ?? 900) * 1000,
          user: data.user,
        };
        saveSession(next);
        return next;
      } catch {
        saveSession(null);
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
  const { method = 'GET', body, query, form, signal, auth = true } = options;
  const headers: Record<string, string> = {};
  if (!form) headers['Content-Type'] = 'application/json';

  const response = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    signal,
    credentials: 'same-origin',
    cache: 'no-store',
  });

  if (response.status === 401 && auth && !isRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, options, true);
    onSessionExpired?.();
    throw new ApiError(401, 'Your session has ended. Please sign in again.');
  }

  if (!response.ok) {
    const payload = await parse(response);
    const { message, details } = messageFrom(payload, `Request failed (${response.status})`);
    throw new ApiError(response.status, message, details);
  }

  if (response.status === 204) return undefined as T;
  const payload = await parse(response);
  // The API wraps every success in { success, data }.
  if (payload && typeof payload === 'object' && 'data' in payload) return payload.data as T;
  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], options: RequestOptions = {}) => request<T>(path, { ...options, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options: RequestOptions = {}) => request<T>(path, { ...options, method: 'PATCH', body }),
  del: <T>(path: string, options: RequestOptions = {}) => request<T>(path, { ...options, method: 'DELETE' }),
  upload: <T>(path: string, form: FormData, options: RequestOptions = {}) => request<T>(path, { ...options, method: 'POST', form }),
  /** Fetch a protected file as a blob URL (files are never public links). */
  async download(fileId: string, disposition: 'inline' | 'attachment' = 'inline') {
    const response = await fetch(`/api/v1/files/${fileId}/download?disposition=${disposition}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      const payload = await parse(response);
      const { message } = messageFrom(payload, 'That file could not be opened.');
      throw new ApiError(response.status, message);
    }
    return {
      blob: await response.blob(),
      contentType: response.headers.get('Content-Type') ?? 'application/octet-stream',
      fileName: response.headers.get('X-File-Name') ?? 'download',
    };
  },
  async objectUrl(fileId: string) {
    const { blob } = await api.download(fileId, 'inline');
    return URL.createObjectURL(blob);
  },
  /** CSV/text export that keeps the auth header (a plain <a href> cannot). */
  async exportText(path: string, query?: RequestOptions['query']) {
    const response = await fetch(buildUrl(path, query), {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new ApiError(response.status, 'Export failed');
    return response.text();
  },
};

export async function login(email: string, password: string) {
  const data = await api.post<AuthResult>(
    '/auth/login',
    { email, password, clientType: 'WEB' },
    { auth: false },
  );
  return persist(data);
}

export async function platformLogin(email: string, password: string) {
  const data = await api.post<AuthResult>(
    '/auth/platform/login',
    { email, password, clientType: 'WEB' },
    { auth: false },
  );
  return persist(data);
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    // Signing out locally must succeed even if the server call fails.
  }
  saveSession(null);
}

/* ==========================================================================
   Authentication & onboarding
   --------------------------------------------------------------------------
   Every call below talks to the real API (no mock data). Public endpoints run
   with `auth: false`; browser sessions use same-origin HttpOnly cookies rather
   than JavaScript-accessible token storage.
   ========================================================================== */

/** What the server allows an unauthenticated visitor to do. */
export interface OnboardingPolicy {
  /** Retained for older clients. */
  firstRunSetupEnabled: boolean;
  /** True when the installation has no school yet. */
  requiresSetup: boolean;
  schoolSelfRegistration: boolean;
  parentSelfRegistration: boolean;
  invitationRegistration: boolean;
  hint?: string;
}

export const fetchOnboardingPolicy = () => request<OnboardingPolicy>('/auth/setup-status', { auth: false });

export interface AuthResult {
  /** Present only for explicitly mobile clients; the web API omits these. */
  accessToken?: string;
  refreshToken?: string;
  expiresIn: number;
  user: StoredSession['user'];
}

function persist(result: AuthResult): StoredSession {
  const session: StoredSession = {
    expiresAt: Date.now() + (result.expiresIn ?? 900) * 1000,
    user: result.user,
  };
  saveSession(session);
  return session;
}

export interface SchoolRegistrationPayload {
  setupToken?: string;
  school: { name: string; code?: string; county?: string; phone?: string; email?: string; timezone?: string };
  admin: { fullName: string; email: string; phone?: string; password: string; confirmPassword: string };
  acceptTerms: true;
}

/** Creates the school and its first administrator in one server transaction. */
export async function registerSchool(payload: SchoolRegistrationPayload) {
  const data = await api.post<AuthResult & { school: { id: string; name: string; code: string | null } }>(
    '/auth/register/school',
    payload,
    { auth: false },
  );
  persist(data);
  return data;
}

export interface ParentRegistrationPayload {
  invitationToken?: string;
  schoolCode?: string;
  fullName: string;
  email: string;
  phone: string;
  relationship: string;
  password: string;
  confirmPassword: string;
  acceptTerms: true;
}

export interface ParentRegistrationResult {
  registered: boolean;
  verificationRequired: boolean;
  hasPendingLink: boolean;
  message: string;
}

/** Guardian self-registration; a learner link is only ever provisional here. */
export const registerParent = (payload: ParentRegistrationPayload) =>
  api.post<ParentRegistrationResult>('/auth/register/parent', payload, { auth: false });

export interface InvitationPreview {
  valid: boolean;
  message?: string;
  email?: string;
  fullName?: string;
  role?: Role;
  roleLabel?: string;
  schoolName?: string;
  learnerName?: string | null;
  relationship?: string | null;
  expiresAt?: string;
}

export const previewInvitation = (token: string) =>
  api.get<InvitationPreview>('/auth/invitations/preview', { token }, { auth: false });

export interface AcceptInvitationPayload {
  token: string;
  fullName?: string;
  phone?: string;
  password: string;
  confirmPassword: string;
}

/** Sets the invitee's own password and activates the account. */
export const acceptInvitation = (payload: AcceptInvitationPayload) =>
  api.post<{ activated: boolean; email: string; role: Role; message: string }>('/auth/invitations/accept', payload, {
    auth: false,
  });

/**
 * Asks for a reset link. The API answers identically for known and unknown
 * addresses, so this never reveals whether an account exists.
 */
export const requestPasswordReset = (email: string) =>
  api.post<{ message: string }>('/auth/password/forgot', { email }, { auth: false });

/** Completes a reset with the single-use token from the emailed link. */
export const resetPassword = (token: string, password: string) =>
  api.post<{ message: string }>('/auth/password/reset', { token, password }, { auth: false });

/** Changes the signed-in user's own password (requires the current one). */
export const changePassword = (currentPassword: string, newPassword: string) =>
  api.post<{ message: string }>('/auth/password/change', { currentPassword, newPassword });
