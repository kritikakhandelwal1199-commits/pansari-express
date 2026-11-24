/**
 * Service Adapter Layer — the only place the apps talk to "outside world" services.
 *
 *   const adapters = createAdapters({ mode: 'mock' });
 *   await adapters.payment.createIntent(...)
 *
 * API HOLD MODE: every adapter resolves to a local mock/simulator. When a live
 * provider is approved, add it behind the same interface and switch `mode`
 * per adapter — no app code changes.
 */
import type { AuthAdapter } from './auth/AuthAdapter.js';
import { LocalMockAuthProvider, type LocalMockAuthConfig } from './auth/LocalMockAuthProvider.js';
import type { GeoAdapter } from './geo/GeoAdapter.js';
import { LocalGeoProvider, type LocalGeoConfig } from './geo/LocalGeoProvider.js';
import type { GstAdapter } from './gst/GstAdapter.js';
import { MockGstProvider, type MockGstConfig } from './gst/MockGstProvider.js';
import type { PaymentAdapter } from './payment/PaymentAdapter.js';
import { MockPaymentProvider, type MockPaymentConfig } from './payment/MockPaymentProvider.js';

export * from './payment/PaymentAdapter.js';
export * from './payment/MockPaymentProvider.js';
export * from './geo/GeoAdapter.js';
export * from './geo/LocalGeoProvider.js';
export * from './auth/AuthAdapter.js';
export * from './auth/LocalMockAuthProvider.js';
export * from './gst/GstAdapter.js';
export * from './gst/MockGstProvider.js';
export { renderInvoicePdf, ascii } from './gst/invoicePdf.js';

export interface AdapterConfig {
  payment?: Partial<MockPaymentConfig>;
  geo?: Partial<LocalGeoConfig>;
  /** Pass a FirebasePhoneAuthProvider (from "@pansari/adapters/firebase-auth") to use Firebase; defaults to the local mock. */
  auth?: AuthAdapter | Partial<LocalMockAuthConfig>;
  gst?: MockGstConfig;
}

export interface Adapters {
  payment: PaymentAdapter;
  geo: GeoAdapter;
  auth: AuthAdapter;
  gst: GstAdapter;
}

function isAuthAdapter(v: unknown): v is AuthAdapter {
  return !!v && typeof (v as AuthAdapter).sendOtp === 'function';
}

export function createAdapters(cfg: AdapterConfig = {}): Adapters {
  return {
    payment: new MockPaymentProvider(cfg.payment),
    geo: new LocalGeoProvider(cfg.geo),
    auth: isAuthAdapter(cfg.auth) ? cfg.auth : new LocalMockAuthProvider(cfg.auth ?? {}),
    gst: new MockGstProvider(cfg.gst ?? { mockSigningKey: 'mock-irp-local-signing-key-change-me-0123' }),
  };
}
