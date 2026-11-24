/**
 * Pure role-assignment logic (no Firebase imports) so it can be unit tested.
 */
import { ASSIGNABLE_ROLES, MAX_STAFF_STORES, type PansariClaims, type Role } from '@pansari/shared';

export interface RoleChangeInput {
  uid: string;
  role: Role;
  vendorId?: string | null;
  storeIds?: string[] | null;
}

export interface RoleDeps {
  vendorExists(vendorId: string): Promise<boolean>;
  storeVendor(storeId: string): Promise<string | null>;
  countSuperAdmins(): Promise<number>;
  currentClaims(uid: string): Promise<PansariClaims>;
}

export class RoleError extends Error {
  constructor(readonly code: 'invalid-argument' | 'permission-denied' | 'failed-precondition' | 'not-found', message: string) {
    super(message);
  }
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export async function buildClaims(input: RoleChangeInput, callerUid: string, deps: RoleDeps): Promise<PansariClaims> {
  if (!input || typeof input.uid !== 'string' || !ID.test(input.uid)) throw new RoleError('invalid-argument', 'uid is required');
  if (!ASSIGNABLE_ROLES.includes(input.role)) throw new RoleError('invalid-argument', `Role "${String(input.role)}" cannot be assigned`);

  const current = await deps.currentClaims(input.uid);
  if (current.role === 'super_admin' && input.role !== 'super_admin') {
    if (input.uid === callerUid) throw new RoleError('failed-precondition', 'You cannot remove your own super admin role');
    if ((await deps.countSuperAdmins()) <= 1) throw new RoleError('failed-precondition', 'At least one super admin must remain');
  }

  const claims: PansariClaims = { role: input.role };

  if (input.role === 'seller' || input.role === 'staff') {
    const vendorId = input.vendorId ?? '';
    if (!ID.test(vendorId)) throw new RoleError('invalid-argument', 'vendorId is required for seller and staff');
    if (!(await deps.vendorExists(vendorId))) throw new RoleError('not-found', `Vendor ${vendorId} does not exist`);
    claims.vendorId = vendorId;

    const storeIds = [...new Set(input.storeIds ?? [])];
    if (storeIds.length > MAX_STAFF_STORES) throw new RoleError('invalid-argument', `At most ${MAX_STAFF_STORES} stores per user`);
    if (input.role === 'staff' && storeIds.length === 0) throw new RoleError('invalid-argument', 'Staff must be attached to at least one store');
    for (const s of storeIds) {
      if (!ID.test(s)) throw new RoleError('invalid-argument', `Bad store id ${s}`);
      const v = await deps.storeVendor(s);
      if (v === null) throw new RoleError('not-found', `Store ${s} does not exist`);
      if (v !== vendorId) throw new RoleError('permission-denied', `Store ${s} does not belong to vendor ${vendorId}`);
    }
    claims.storeIds = storeIds;
  } else if (input.vendorId || (input.storeIds && input.storeIds.length)) {
    throw new RoleError('invalid-argument', `vendorId/storeIds are only valid for seller and staff`);
  }

  if (JSON.stringify(claims).length > 900) throw new RoleError('invalid-argument', 'Claims payload too large');
  return claims;
}

/** Downgrades or scope reductions must take effect immediately → revoke refresh tokens. */
export function isPrivilegeReduction(before: PansariClaims, after: PansariClaims): boolean {
  if (before.role && before.role !== after.role) return true;
  if (before.vendorId && before.vendorId !== after.vendorId) return true;
  const removed = (before.storeIds ?? []).some((s) => !(after.storeIds ?? []).includes(s));
  const widenedToAll = after.role === 'seller' && (after.storeIds ?? []).length === 0;
  return removed && !widenedToAll;
}
