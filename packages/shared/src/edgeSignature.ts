/**
 * Worker → Cloud Function request signing. The edge worker has already verified
 * the Firebase ID token, App Check, Turnstile and rate limits; this signature lets
 * the function trust that the call really came through the edge (and was not
 * replayed), in addition to its own checks.
 *
 *   X-Edge-Timestamp: epoch seconds
 *   X-Edge-Signature: hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))
 */

const enc = new TextEncoder();
export const EDGE_MAX_SKEW_SECONDS = 120;

async function key(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('EDGE_SHARED_SECRET must be at least 32 characters');
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
function fromHex(h: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function signEdgeRequest(rawBody: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const ts = String(nowSeconds);
  const sig = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), enc.encode(`${ts}.${rawBody}`));
  return { 'X-Edge-Timestamp': ts, 'X-Edge-Signature': toHex(sig) };
}

export async function verifyEdgeRequest(rawBody: string, timestamp: string | undefined, signature: string | undefined, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > EDGE_MAX_SKEW_SECONDS) return false;
  const sig = fromHex(signature);
  if (!sig) return false;
  return crypto.subtle.verify('HMAC', await key(secret, ['verify']), sig, enc.encode(`${timestamp}.${rawBody}`));
}
