import type { Env, RateLimitBinding } from './env.js';
import { HttpError } from './http.js';

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

/**
 * Fallback limiter for local dev when the Rate Limiting binding is absent.
 * Per-isolate only — production uses the RL_* bindings in wrangler.toml.
 */
class MemoryLimiter implements RateLimitBinding {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private max: number, private windowMs: number) {}
  async limit({ key }: { key: string }) {
    const now = Date.now();
    const e = this.hits.get(key);
    if (!e || e.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.hits.clear();
      return { success: true };
    }
    e.count += 1;
    return { success: e.count <= this.max };
  }
}

const memStandard = new MemoryLimiter(60, 60_000);
const memStrict = new MemoryLimiter(10, 60_000);

export type LimitTier = 'standard' | 'strict';

/** Throws 429 if any of the keys is over its limit. Keys like `ip:1.2.3.4:qr-session`, `uid:abc:qr-session`. */
export async function rateLimit(env: Env, tier: LimitTier, keys: string[]): Promise<void> {
  const binding = tier === 'strict' ? env.RL_STRICT ?? memStrict : env.RL_STANDARD ?? memStandard;
  const results = await Promise.all(keys.map((key) => binding.limit({ key })));
  if (results.some((r) => !r.success)) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests, slow down');
}

/* ------------------------------------------------------------------ */
/* Cloudflare Turnstile                                                */
/* ------------------------------------------------------------------ */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Accepted only when TURNSTILE_MODE=mock (API hold mode). */
export const MOCK_TURNSTILE_PASS = 'mock-turnstile-pass';

export async function verifyTurnstile(env: Env, token: unknown, ip: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) throw new HttpError(400, 'TURNSTILE_REQUIRED');
  if (env.TURNSTILE_MODE === 'mock') {
    if (token !== MOCK_TURNSTILE_PASS) throw new HttpError(403, 'TURNSTILE_FAILED');
    return;
  }
  if (!env.TURNSTILE_SECRET) throw new HttpError(500, 'TURNSTILE_MISCONFIGURED');
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  form.append('remoteip', ip);
  const res = await fetcher(SITEVERIFY, { method: 'POST', body: form });
  if (!res.ok) throw new HttpError(503, 'TURNSTILE_UNAVAILABLE');
  const out = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
  if (!out.success) throw new HttpError(403, 'TURNSTILE_FAILED');
}
