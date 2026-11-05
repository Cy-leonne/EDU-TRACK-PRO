import { NextRequest } from 'next/server';

/**
 * Server-side proxy from the browser to the Nest API.
 *
 * Why a route handler instead of `rewrites()` in next.config.mjs: Next evaluates
 * `rewrites()` when the app is **built**, so the API origin would be frozen into
 * the image. Reading `API_INTERNAL_URL` per request means one image can be built
 * once and deployed against any API host (dev, staging, production), and the
 * test suite can point it at an isolated API without rebuilding.
 *
 * The browser only ever talks to this origin, so there is no CORS surface and no
 * API host in client bundles. Authentication headers and cookies pass through
 * untouched, and file downloads stream back with their original content type and
 * disposition headers.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

function apiOrigin() {
  return (process.env.API_INTERNAL_URL || 'http://127.0.0.1:4000').replace(/\/$/, '');
}

async function proxy(request: NextRequest, context: { params: { path?: string[] } }) {
  const path = (context.params.path ?? []).join('/');
  const target = `${apiOrigin()}/api/v1/${path}${request.nextUrl.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  // The upstream sees its own host, not the browser's.
  headers.delete('origin');
  headers.delete('referer');

  const method = request.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch (error) {
    // The API being unreachable is a 503 with a clean message — never a stack
    // trace, and never a silent success.
    return Response.json(
      { success: false, statusCode: 503, error: 'ServiceUnavailable', message: 'The school records service is not reachable right now. Please try again shortly.' },
      { status: 503 },
    );
  }

  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    // Set-Cookie is handled separately because multiple session cookies must not
    // be collapsed into a single comma-joined header.
    if (!HOP_BY_HOP.has(lower) && lower !== 'content-encoding' && lower !== 'set-cookie') responseHeaders.set(key, value);
  });
  const getSetCookie = (upstream.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = getSetCookie?.call(upstream.headers) ?? (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie') as string] : []);
  for (const cookie of cookies) responseHeaders.append('set-cookie', cookie);

  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: responseHeaders });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
