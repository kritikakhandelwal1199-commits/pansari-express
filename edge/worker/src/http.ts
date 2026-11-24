import type { Env } from './env.js';

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function allowedOrigin(req: Request, env: Env): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null;
  const list = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  return list.includes(origin) ? origin : null;
}

export function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = allowedOrigin(req, env);
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Firebase-AppCheck, CF-Turnstile-Response',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function json(req: Request, env: Env, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...corsHeaders(req, env) },
  });
}

export function errorResponse(req: Request, env: Env, err: unknown): Response {
  if (err instanceof HttpError) return json(req, env, err.status, { ok: false, error: err.code, message: err.message });
  console.error('unhandled', err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  return json(req, env, 500, { ok: false, error: 'INTERNAL' });
}

const MAX_BODY_BYTES = 16 * 1024;

export async function readJson<T>(req: Request): Promise<T> {
  const ct = req.headers.get('Content-Type') ?? '';
  if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE');
  const len = Number(req.headers.get('Content-Length') ?? '0');
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'BODY_TOO_LARGE');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, 'INVALID_JSON');
  }
}

export function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function requireId(v: unknown, field: string): string {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new HttpError(400, 'INVALID_INPUT', `${field} is invalid`);
  return v;
}
