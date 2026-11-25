/** Building blocks for the team apps (owner, staff, rider, compliance, admin). */
import * as React from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Check, ChevronDown, FileUp, LogOut, X } from 'lucide-react-native';
import { KYC_DOC_LABEL, kycMissing, type KycDocType, type KycStatus } from '@pansari/shared';
import type { AppUser, StoreInfo } from '@pansari/client';
import { Badge, Button, ErrorText } from '@/components/ui';
import { errMsg, useData, useResource } from '@/lib/data';
import { landing, ROLE_LABEL } from '@/lib/roles';

/* ------------------------------------------------------------------ access */

/** Renders children only for the given roles; otherwise sends the user to sign in or their own app. */
export function RoleGate({ roles, children }: { roles: AppUser['role'][]; children: React.ReactNode }) {
  const { user, ready } = useData();
  if (!ready) return <View className="flex-1 items-center justify-center bg-bg"><ActivityIndicator color="#a3122b" /></View>;
  if (!user || user.isAnonymous) return <Redirect href="/login" />;
  if (!roles.includes(user.role)) return <Redirect href={landing(user.role)} />;
  return <>{children}</>;
}

export function SignOutButton() {
  const { client } = useData();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      hitSlop={10}
      className="px-3"
      onPress={() => void client.signOut().then(() => router.replace('/login'))}
    >
      <LogOut color="#7a6352" size={20} />
    </Pressable>
  );
}

export function Who() {
  const { user } = useData();
  if (!user) return null;
  return (
    <Text className="text-xs text-muted">
      {user.displayName ?? user.phone} · {ROLE_LABEL[user.role] ?? user.role}
    </Text>
  );
}

/* ------------------------------------------------------------------ stores */

interface StoreCtx { stores: StoreInfo[]; storeId: string; setStoreId: (id: string) => void; store: StoreInfo | undefined; loading: boolean }
const SCtx = React.createContext<StoreCtx | null>(null);
export const useStore = () => {
  const c = React.useContext(SCtx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
};

export function StoreProvider({ children, deliveringOnly }: { children: React.ReactNode; deliveringOnly?: boolean }) {
  const { client, user, storage } = useData();
  const all = useResource(() => client.listStores(), [client, user?.uid]);
  const stores = (all.data ?? []).filter((s) => !deliveringOnly || s.type !== 'WAREHOUSE');
  const key = `pansari-store-${user?.uid ?? ''}`;
  const [storeId, setRaw] = React.useState<string>(() => storage.getItem(key) ?? '');
  const valid = stores.some((s) => s.storeId === storeId) ? storeId : stores[0]?.storeId ?? '';
  const setStoreId = (id: string) => {
    storage.setItem(key, id);
    setRaw(id);
  };
  return <SCtx.Provider value={{ stores, storeId: valid, setStoreId, store: stores.find((s) => s.storeId === valid), loading: all.loading }}>{children}</SCtx.Provider>;
}

export function StoreSwitch() {
  const { stores, storeId, setStoreId, store } = useStore();
  if (stores.length <= 1) return store ? <Text className="text-sm font-bold text-ink">{store.name}</Text> : null;
  return <Picker label="Store" value={storeId} options={stores.map((s) => ({ value: s.storeId, label: s.name }))} onChange={setStoreId} compact />;
}

/* ------------------------------------------------------------------ picker sheet */

export interface Opt { value: string; label: string; sub?: string; disabled?: boolean }

export function Picker({ label, value, options, onChange, placeholder = 'Choose', compact, disabled }: { label?: string; value: string; options: Opt[]; onChange: (v: string) => void; placeholder?: string; compact?: boolean; disabled?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <View className="gap-1.5">
      {label && !compact ? <Text className="text-sm font-semibold text-muted">{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? placeholder}
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={`flex-row items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 ${compact ? 'h-10' : 'h-12'} ${disabled ? 'opacity-50' : ''}`}
      >
        <Text numberOfLines={1} className={`flex-1 ${compact ? 'text-sm font-bold' : 'text-base'} ${cur ? 'text-ink' : 'text-muted'}`}>{cur?.label ?? placeholder}</Text>
        <ChevronDown color="#7a6352" size={18} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
        <View className="max-h-[70%] rounded-t-3xl bg-bg px-4 pb-8 pt-4">
          <Text className="mb-2 text-lg font-extrabold text-ink">{label ?? placeholder}</Text>
          <ScrollView>
            {options.map((o) => (
              <Pressable
                key={o.value}
                disabled={o.disabled}
                onPress={() => {
                  setOpen(false);
                  if (o.value !== value) onChange(o.value);
                }}
                className={`mb-2 flex-row items-center gap-3 rounded-xl border p-3 ${o.value === value ? 'border-kum bg-surface' : 'border-line bg-surface'} ${o.disabled ? 'opacity-40' : ''}`}
              >
                <View className="flex-1">
                  <Text className="font-bold text-ink">{o.label}</Text>
                  {o.sub ? <Text className="text-xs text-muted">{o.sub}</Text> : null}
                </View>
                {o.value === value ? <Check color="#a3122b" size={18} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

/* ------------------------------------------------------------------ segmented tabs */

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} className={`h-9 justify-center rounded-full px-3.5 ${o.value === value ? 'bg-kum' : 'border border-line bg-surface'}`}>
          <Text className={`text-sm font-bold ${o.value === value ? 'text-white' : 'text-ink'}`}>{o.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ sheet (modal form) */

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/40" onPress={onClose} />
      <View className="max-h-[88%] rounded-t-3xl bg-bg px-4 pb-8 pt-4">
        <View className="mb-3 flex-row items-center justify-between">
          <Text className="flex-1 text-lg font-extrabold text-ink">{title}</Text>
          <Pressable accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <X color="#7a6352" size={22} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ barcode scanner */

export function Scanner({ open, onClose, onCode }: { open: boolean; onClose: () => void; onCode: (code: string) => void }) {
  const [perm, ask] = useCameraPermissions();
  const done = React.useRef(false);
  React.useEffect(() => {
    if (open) done.current = false;
  }, [open]);
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black">
        {perm?.granted ? (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={(r) => {
              if (done.current || !r.data) return;
              done.current = true;
              onCode(r.data);
              onClose();
            }}
          />
        ) : (
          <View className="flex-1 items-center justify-center gap-4 p-6">
            <Text className="text-center text-white">Pansari needs the camera to read barcodes.</Text>
            <Button title="Allow camera" onPress={() => void ask()} />
          </View>
        )}
        <View className="absolute bottom-10 left-0 right-0 items-center">
          <Button variant="outline" title="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

/* ------------------------------------------------------------------ photos */

export interface Photo { uri: string; name: string; type: string; size: number; dataUrl: string | null }

/** Takes a photo (camera) or picks one (gallery). Returns null if cancelled. */
export async function pickPhoto(from: 'camera' | 'library'): Promise<Photo | null> {
  const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error(from === 'camera' ? 'Allow camera access to take a photo' : 'Allow photo access to choose a picture');
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64: true, exif: false };
  const r = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets[0]) return null;
  const a = r.assets[0];
  const type = a.mimeType ?? 'image/jpeg';
  return { uri: a.uri, name: a.fileName ?? `photo-${Date.now()}.jpg`, type, size: a.fileSize ?? (a.base64 ? Math.round((a.base64.length * 3) / 4) : 0), dataUrl: a.base64 ? `data:${type};base64,${a.base64}` : null };
}

export async function photoBlob(p: Photo): Promise<Blob> {
  return (await fetch(p.uri)).blob();
}

/* ------------------------------------------------------------------ KYC */

export const KYC_STATUS: Record<KycStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  PENDING: { label: 'Documents needed', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warn' },
  VERIFIED: { label: 'Verified', tone: 'good' },
  REJECTED: { label: 'Needs a new upload', tone: 'bad' },
};
export const DOC_STATUS: Record<KycStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  PENDING: { label: 'Waiting for review', tone: 'warn' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warn' },
  VERIFIED: { label: 'Verified', tone: 'good' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
};
export const shortDoc = (t: KycDocType) => KYC_DOC_LABEL[t].split(' (')[0]!;

export function KycUploader({ required, onChanged }: { required: readonly KycDocType[]; onChanged?: () => void }) {
  const { client } = useData();
  const docs = useResource(() => client.myKycDocs(), [client]);
  const [busy, setBusy] = React.useState<KycDocType | null>(null);
  const [masked, setMasked] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const list = docs.data ?? [];
  const missing = kycMissing(list, required);

  async function upload(t: KycDocType, from: 'camera' | 'library') {
    setErr(null);
    try {
      const p = await pickPhoto(from);
      if (!p) return;
      setBusy(t);
      await client.uploadKyc({ docType: t, file: await photoBlob(p), fileName: p.name, maskedConfirmed: t === 'AADHAAR_MASKED' ? masked : undefined, preview: p.dataUrl ?? undefined });
      docs.reload();
      onChanged?.();
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="gap-3">
      {required.map((t) => {
        const latest = list.filter((d) => d.docType === t).sort((a, b) => b.createdMs - a.createdMs)[0];
        const needs = missing.includes(t);
        const blocked = t === 'AADHAAR_MASKED' && needs && !masked;
        return (
          <View key={t} className="gap-2 rounded-2xl border border-line bg-surface p-3">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="flex-1 font-bold text-ink">{KYC_DOC_LABEL[t]}</Text>
              {latest ? <Badge label={DOC_STATUS[latest.status].label} tone={DOC_STATUS[latest.status].tone} /> : <Badge label="Not uploaded" />}
            </View>
            {latest?.status === 'REJECTED' && latest.reviewNote ? <Text className="text-sm font-semibold text-danger">Reviewer: {latest.reviewNote}</Text> : null}
            {t === 'AADHAAR_MASKED' && needs ? (
              <Pressable onPress={() => setMasked((m) => !m)} className="flex-row items-start gap-2">
                <View className={`mt-0.5 h-5 w-5 items-center justify-center rounded border-2 ${masked ? 'border-leaf bg-leaf' : 'border-line'}`}>{masked ? <Check color="#fff" size={14} /> : null}</View>
                <Text className="flex-1 text-sm text-ink">Only the last 4 digits of my Aadhaar are visible (masked Aadhaar from the UIDAI website).</Text>
              </Pressable>
            ) : null}
            {needs || latest?.status === 'VERIFIED' ? (
              <View className="flex-row gap-2">
                <Button className="flex-1" variant={needs ? 'kum' : 'outline'} busy={busy === t} disabled={!!busy || blocked} title={needs ? 'Take photo' : 'Replace'} onPress={() => upload(t, 'camera')} />
                <Button className="flex-1" variant="outline" disabled={!!busy || blocked} title="From gallery" onPress={() => upload(t, 'library')} />
              </View>
            ) : null}
          </View>
        );
      })}
      <ErrorText>{err}</ErrorText>
    </View>
  );
}

/** Shows a stored document image (data: URL or https URL). */
export function DocImage({ uri }: { uri: string | null | undefined }) {
  if (uri === undefined) return <ActivityIndicator color="#a3122b" />;
  if (!uri) return <Text className="p-4 text-center text-sm text-muted">Preview not available for this file.</Text>;
  if (uri.startsWith('data:application/pdf')) return <Text className="p-4 text-center text-sm text-muted">PDF document — open it on the web portal to view.</Text>;
  return <Image source={{ uri }} resizeMode="contain" style={{ width: '100%', height: 320, borderRadius: 12 }} />;
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <View className="items-center gap-1 rounded-2xl border border-dashed border-line p-8">
      <FileUp color="#b3a090" size={22} />
      <Text className="font-bold text-ink">{title}</Text>
      {sub ? <Text className="text-center text-sm text-muted">{sub}</Text> : null}
    </View>
  );
}

export const fmtTime = (ms: number) => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
export const toPaise = (v: string) => {
  const n = Number(v.replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};
