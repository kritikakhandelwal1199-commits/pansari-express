'use client';
import * as React from 'react';
import { Pencil, UserPlus } from 'lucide-react';
import { ASSIGNABLE_ROLES, type Role } from '@pansari/shared';
import { ErrorNote, useToast } from '@/components/common';
import { ROLE_LABEL } from '@/components/phase4';
import { PageHead } from '@/components/seller';
import { Badge, Button, Dialog, DialogContent, EmptyState, Field, Input, Select, Skeleton, Table, Td, Th } from '@/components/ui';
import { useData, useResource } from '@/lib/data/provider';
import type { RoleInput, UserRow } from '@/lib/data/types';
import { errMsg } from '@/lib/utils';

const ROLE_HELP: Record<string, string> = {
  super_admin: 'Everything, including roles, zones and the tax master. Keep this to one or two people.',
  seller: 'The shop owner: all stores (or the ones you tick), prices, catalogue, QR posters.',
  staff: 'Billing, packing and stock at the stores you tick. Cannot change prices.',
  rider: 'Delivers orders from one store. Must upload documents before going on shift.',
  compliance: 'Reviews KYC documents and listings, raises product recalls, reads the audit log.',
  customer: 'Regular shopper. Choose this to remove someone’s staff access.',
};

export default function UsersPage() {
  const data = useData();
  const toast = useToast();
  const users = useResource(() => data.listUsers(), [data]);
  const stores = useResource(() => data.listStores(), [data]);
  const [filter, setFilter] = React.useState<'team' | 'all'>('team');
  const [form, setForm] = React.useState<(RoleInput & { isNew: boolean }) | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const storeName = (id: string) => stores.data?.find((s) => s.storeId === id)?.name ?? id;
  const list = (users.data ?? []).filter((u) => filter === 'all' || u.role !== 'customer');

  const edit = (u: UserRow) => {
    setErr(null);
    setForm({ isNew: false, uid: u.uid, displayName: u.displayName ?? '', role: u.role, storeIds: u.storeIds, homeStoreId: u.homeStoreId });
  };
  async function save() {
    if (!form) return;
    setBusy(true);
    setErr(null);
    try {
      const { isNew, ...input } = form;
      const r = await data.setUserRole({ ...input, phone: isNew ? normalise(input.phone ?? '') : undefined, storeIds: input.role === 'seller' || input.role === 'staff' ? input.storeIds : undefined, homeStoreId: input.role === 'rider' ? input.homeStoreId : undefined });
      toast({ tone: 'good', text: `${r.displayName ?? r.phone} is now ${ROLE_LABEL[r.role]?.toLowerCase()}` });
      setForm(null);
      users.reload();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const toggleStore = (id: string) => setForm((f) => (f ? { ...f, storeIds: f.storeIds?.includes(id) ? f.storeIds.filter((x) => x !== id) : [...(f.storeIds ?? []), id] } : f));

  return (
    <>
      <PageHead
        title="People & roles"
        sub="Roles are stored in the sign-in token, not in the database, so they cannot be faked. A changed role applies the next time the person signs in."
        actions={
          <>
            <Button variant={filter === 'team' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('team')}>
              Team
            </Button>
            <Button variant={filter === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('all')}>
              Everyone
            </Button>
            <Button size="sm" variant="haldi" onClick={() => (setErr(null), setForm({ isNew: true, phone: '', displayName: '', role: 'staff', storeIds: [], homeStoreId: null }))}>
              <UserPlus className="size-4" /> Add person
            </Button>
          </>
        }
      />
      {users.loading && !users.data ? <Skeleton className="h-40 rounded-2xl" /> : null}
      {users.error ? <ErrorNote>{users.error}</ErrorNote> : null}
      {users.data && !list.length ? <EmptyState title="No one yet" /> : null}
      {list.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Mobile</Th>
              <Th>Role</Th>
              <Th>Works at</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {list.map((u) => (
              <tr key={u.uid}>
                <Td className="font-semibold">{u.displayName ?? '—'}</Td>
                <Td className="num">{u.phone ?? '—'}</Td>
                <Td>
                  <Badge tone={u.role === 'super_admin' ? 'brand' : u.role === 'customer' ? 'neutral' : 'good'}>{ROLE_LABEL[u.role] ?? u.role}</Badge>
                </Td>
                <Td className="text-sm">{u.role === 'rider' ? (u.homeStoreId ? storeName(u.homeStoreId) : '—') : u.role === 'seller' && !u.storeIds.length ? 'All stores' : u.storeIds.map(storeName).join(', ') || '—'}</Td>
                <Td className="text-right">
                  <Button size="sm" variant="outline" onClick={() => edit(u)}>
                    <Pencil className="size-4" /> Change
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}

      <Dialog open={!!form} onOpenChange={(v) => !v && setForm(null)}>
        <DialogContent title={form?.isNew ? 'Add a person' : 'Change role'} description={form?.isNew ? 'They sign in with this mobile number and an OTP.' : undefined}>
          {form ? (
            <div className="grid gap-3">
              {form.isNew ? (
                <Field label="Mobile number">
                  <Input inputMode="tel" placeholder="98XXXXXXXX" value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoFocus />
                </Field>
              ) : null}
              <Field label="Name">
                <Input value={form.displayName ?? ''} onChange={(e) => setForm({ ...form, displayName: e.target.value })} maxLength={60} />
              </Field>
              <Field label="Role" hint={ROLE_HELP[form.role]}>
                <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
              </Field>
              {form.role === 'seller' || form.role === 'staff' ? (
                <fieldset className="grid gap-1.5">
                  <legend className="text-sm font-semibold text-muted">{form.role === 'seller' ? 'Stores (leave all unticked for every store)' : 'Stores they work at'}</legend>
                  {(stores.data ?? []).map((s) => (
                    <label key={s.storeId} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={form.storeIds?.includes(s.storeId) ?? false} onChange={() => toggleStore(s.storeId)} />
                      {s.name}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              {form.role === 'rider' ? (
                <Field label="Home store" hint="The store this rider collects orders from and hands cash to.">
                  <Select value={form.homeStoreId ?? ''} onChange={(e) => setForm({ ...form, homeStoreId: e.target.value || null })}>
                    <option value="">Choose a store</option>
                    {(stores.data ?? [])
                      .filter((s) => s.type !== 'WAREHOUSE')
                      .map((s) => (
                        <option key={s.storeId} value={s.storeId}>
                          {s.name}
                        </option>
                      ))}
                  </Select>
                </Field>
              ) : null}
              {err ? <ErrorNote>{err}</ErrorNote> : null}
              <Button size="lg" disabled={busy || (form.isNew && normalise(form.phone ?? '').length !== 13)} onClick={save}>
                Save
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function normalise(v: string) {
  const d = v.replace(/\D/g, '');
  return d.length === 10 ? `+91${d}` : d.length === 12 && d.startsWith('91') ? `+${d}` : v.trim();
}
