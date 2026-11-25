/**
 * Hermes has no Web Crypto. The shared code uses crypto.getRandomValues,
 * crypto.subtle.digest('SHA-256') and HMAC-SHA-256 (sign/verify), so this file
 * provides exactly those: random bytes from expo-crypto, SHA-256 + HMAC in plain JS.
 * Import it first, before anything from @pansari/*.
 */
import * as ExpoCrypto from 'expo-crypto';

import { hmacSha256, sha256 } from './sha256';

const bytes = (d: ArrayBuffer | ArrayBufferView) => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
interface RawKey { raw: Uint8Array }

const subtle = {
  async digest(alg: string | { name: string }, data: ArrayBuffer | ArrayBufferView) {
    const name = typeof alg === 'string' ? alg : alg.name;
    if (name !== 'SHA-256') throw new Error(`digest ${name} not supported`);
    return sha256(bytes(data)).buffer as ArrayBuffer;
  },
  async importKey(_fmt: 'raw', key: ArrayBuffer | ArrayBufferView): Promise<RawKey> {
    return { raw: bytes(key).slice() };
  },
  async sign(_alg: unknown, key: RawKey, data: ArrayBuffer | ArrayBufferView) {
    return hmacSha256(key.raw, bytes(data)).buffer as ArrayBuffer;
  },
  async verify(_alg: unknown, key: RawKey, sig: ArrayBuffer | ArrayBufferView, data: ArrayBuffer | ArrayBufferView) {
    const a = hmacSha256(key.raw, bytes(data));
    const b = bytes(sig);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
    return diff === 0;
  },
};

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown; subtle?: unknown } };
g.crypto ??= {};
if (!g.crypto.getRandomValues) g.crypto.getRandomValues = <T extends ArrayBufferView>(arr: T) => ExpoCrypto.getRandomValues(arr as never) as T;
if (!g.crypto.subtle) g.crypto.subtle = subtle;
