/**
 * Role-based access control.
 *
 * Roles live ONLY in Firebase Auth custom claims (signed into the ID token by
 * the server). Any `role` field stored in Firestore is a display mirror and is
 * never used for authorisation — not by security rules, not by functions, not
 * by the edge worker.
 */

export const ROLES = [
  'super_admin',
  'seller',
  'staff',
  'rider',
  'compliance',
  'customer',
  'temp_qr_guest',
] as const;

export type Role = (typeof ROLES)[number];

/** Roles that only a super admin may grant through `setUserRole`. */
export const ASSIGNABLE_ROLES: readonly Role[] = [
  'super_admin',
  'seller',
  'staff',
  'rider',
  'compliance',
  'customer',
];

/**
 * Shape of the custom claims we put on a Firebase user.
 * Keep the total claim payload well under Firebase's 1000-byte limit.
 */
export interface PansariClaims {
  role?: Role;
  /** Seller / staff: the vendor (business) they belong to. */
  vendorId?: string;
  /** Staff: stores they may operate. Seller: optional subset (empty = all of vendor). */
  storeIds?: string[];
  /** temp_qr_guest: the single physical store this anonymous session is scoped to. */
  scopedStoreId?: string;
  /** temp_qr_guest: session expiry, epoch seconds. */
  qrExp?: number;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/** Max stores a staff member can be attached to (claims size guard). */
export const MAX_STAFF_STORES = 20;

/** Anonymous walk-in session length after scanning a store QR. */
export const QR_GUEST_SESSION_SECONDS = 2 * 60 * 60;

/** Walk-in cart reservation window. */
export const TEMP_CART_TTL_SECONDS = 10 * 60;

/** Counter checkout token lifetime (shown as QR to the cashier). */
export const CHECKOUT_TOKEN_TTL_SECONDS = 10 * 60;
