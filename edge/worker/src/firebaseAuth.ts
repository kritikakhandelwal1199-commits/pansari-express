import { isRole, type PansariClaims, type Role } from '@pansari/shared';
import type { Env } from './env.js';
import { HttpError } from './http.js';
import { decodeJwt, verifyRs256 } from './jwt.js';

export const FIREBASE_ID_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const APP_CHECK_JWKS = 'https://firebaseappcheck.googleapis.com/v1/jwks';

export interface VerifiedUser {
  uid: string;
  provider: string;
  isAnonymous: boolean;
  phone: string | null;
  claims: PansariClaims;
  /** Effective role, mirroring the logic in firestore.rules. */
  role: Role | 'anonymous';
  rawToken: string;
}

type Fetcher = (url: string) => Promise<Response>;

function effectiveRole(claimRole: unknown, isAnonymous: boolean): Role | 'anonymous' {
  if (claimRole === 'temp_qr_guest') return isAnonymous ? 'temp_qr_guest' : 'customer';
  if (isRole(claimRole)) return claimRole;
  return isAnonymous ? 'anonymous' : 'customer';
}

export async function verifyFirebaseIdToken(req: Request, env: Env, fetcher: Fetcher = fetch, nowSeconds = Math.floor(Date.now() / 1000)): Promise<VerifiedUser> {
  const h = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(h);
  if (!m) throw new HttpError(401, 'AUTH_REQUIRED');
  const token = m[1]!;

  let p: Record<string, unknown>;
  if (env.AUTH_EMULATOR === 'true') {
    // Auth emulator issues unsigned tokens (alg "none"). Dev only.
    const d = decodeJwt(token);
    if (d.header.alg !== 'none') p = await verifyRs256(token, FIREBASE_ID_JWKS, fetcher);
    else p = d.payload;
  } else {
    p = await verifyRs256(token, FIREBASE_ID_JWKS, fetcher);
  }

  const projectId = env.FIREBASE_PROJECT_ID;
  const skew = 60;
  if (p.aud !== projectId) throw new HttpError(401, 'TOKEN_BAD_AUDIENCE');
  if (p.iss !== `https://securetoken.google.com/${projectId}`) throw new HttpError(401, 'TOKEN_BAD_ISSUER');
  if (typeof p.exp !== 'number' || p.exp < nowSeconds - skew) throw new HttpError(401, 'TOKEN_EXPIRED');
  if (typeof p.iat !== 'number' || p.iat > nowSeconds + skew) throw new HttpError(401, 'TOKEN_FUTURE');
  if (typeof p.auth_time !== 'number' || p.auth_time > nowSeconds + skew) throw new HttpError(401, 'TOKEN_BAD_AUTH_TIME');
  if (typeof p.sub !== 'string' || p.sub.length === 0 || p.sub.length > 128) throw new HttpError(401, 'TOKEN_BAD_SUBJECT');

  const fb = (p.firebase ?? {}) as { sign_in_provider?: string };
  const provider = fb.sign_in_provider ?? 'unknown';
  const isAnonymous = provider === 'anonymous';
  const claims: PansariClaims = {
    role: isRole(p.role) ? p.role : undefined,
    vendorId: typeof p.vendorId === 'string' ? p.vendorId : undefined,
    storeIds: Array.isArray(p.storeIds) ? (p.storeIds.filter((s) => typeof s === 'string') as string[]) : undefined,
    scopedStoreId: typeof p.scopedStoreId === 'string' ? p.scopedStoreId : undefined,
    qrExp: typeof p.qrExp === 'number' ? p.qrExp : undefined,
  };

  return {
    uid: p.sub,
    provider,
    isAnonymous,
    phone: typeof p.phone_number === 'string' ? p.phone_number : null,
    claims,
    role: effectiveRole(p.role, isAnonymous),
    rawToken: token,
  };
}

/**
 * Firebase App Check (device attestation). Modes:
 *  off      – skip
 *  monitor  – verify if present, log failures, never block
 *  enforce  – missing/invalid token → 401
 */
export async function verifyAppCheck(req: Request, env: Env, fetcher: Fetcher = fetch, nowSeconds = Math.floor(Date.now() / 1000)): Promise<{ appId: string | null; verified: boolean }> {
  if (env.APP_CHECK_MODE === 'off') return { appId: null, verified: false };
  const token = req.headers.get('X-Firebase-AppCheck');
  const fail = (code: string) => {
    if (env.APP_CHECK_MODE === 'enforce') throw new HttpError(401, code);
    console.warn('app-check', code);
    return { appId: null, verified: false };
  };
  if (!token) return fail('APP_CHECK_REQUIRED');
  try {
    const p = await verifyRs256(token, APP_CHECK_JWKS, fetcher);
    const num = env.FIREBASE_PROJECT_NUMBER;
    const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
    if (p.iss !== `https://firebaseappcheck.googleapis.com/${num}`) return fail('APP_CHECK_BAD_ISSUER');
    if (!aud.includes(`projects/${num}`) && !aud.includes(`projects/${env.FIREBASE_PROJECT_ID}`)) return fail('APP_CHECK_BAD_AUDIENCE');
    if (typeof p.exp !== 'number' || p.exp < nowSeconds) return fail('APP_CHECK_EXPIRED');
    return { appId: typeof p.sub === 'string' ? p.sub : null, verified: true };
  } catch (e) {
    if (e instanceof HttpError && env.APP_CHECK_MODE === 'enforce') throw new HttpError(401, 'APP_CHECK_INVALID');
    return fail('APP_CHECK_INVALID');
  }
}

export function requireRole(user: VerifiedUser, ...roles: (Role | 'anonymous')[]): void {
  if (!roles.includes(user.role)) throw new HttpError(403, 'FORBIDDEN_ROLE');
}
