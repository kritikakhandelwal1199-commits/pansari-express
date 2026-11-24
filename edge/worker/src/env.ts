export interface RateLimitBinding {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  APP_VERSION: string;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_PROJECT_NUMBER: string;
  APP_CHECK_MODE: 'off' | 'monitor' | 'enforce';
  TURNSTILE_MODE: 'mock' | 'live';
  PUBLIC_WEB_BASE_URL: string;
  FUNCTIONS_BASE_URL: string;
  FIRESTORE_REST_BASE: string;
  QR_ACTIVE_KID: string;
  ALLOWED_ORIGINS: string;
  AUTH_EMULATOR: string;

  QR_HMAC_KEYS: string;
  EDGE_SHARED_SECRET: string;
  TURNSTILE_SECRET?: string;

  EPHEMERAL: KVNamespace;
  RL_STANDARD?: RateLimitBinding;
  RL_STRICT?: RateLimitBinding;
}

export function qrSecrets(env: Env): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.QR_HMAC_KEYS || '{}');
  } catch {
    throw new Error('QR_HMAC_KEYS is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('QR_HMAC_KEYS must be a JSON object');
  const out: Record<string, string> = {};
  for (const [kid, secret] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof secret === 'string' && secret.length >= 32) out[kid] = secret;
  }
  return out;
}
