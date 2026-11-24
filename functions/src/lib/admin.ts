import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { COL, type AuditLogDoc, type Role } from '@pansari/shared';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const adminAuth = getAuth();

export interface AuditInput {
  actorUid: string;
  actorRole: Role | 'system';
  action: string;
  target: { collection: string; id: string };
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append-only audit trail. Clients can never write audit_logs (see firestore.rules). */
export async function writeAudit(a: AuditInput): Promise<void> {
  const doc: Omit<AuditLogDoc, 'at'> & { at: FieldValue } = {
    actorUid: a.actorUid,
    actorRole: a.actorRole,
    action: a.action,
    target: a.target,
    before: a.before === undefined ? null : JSON.stringify(a.before),
    after: a.after === undefined ? null : JSON.stringify(a.after),
    ip: a.ip ?? null,
    at: FieldValue.serverTimestamp(),
  };
  await db.collection(COL.auditLogs).add(doc);
}
