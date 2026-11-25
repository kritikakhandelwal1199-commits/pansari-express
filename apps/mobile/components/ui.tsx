import * as React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View, type PressableProps, type TextInputProps } from 'react-native';
import { formatINR } from '@pansari/shared';

export const rs = (p: number) => formatINR(p);

type Variant = 'kum' | 'leaf' | 'outline' | 'ghost' | 'danger';
const V: Record<Variant, { box: string; text: string }> = {
  kum: { box: 'bg-kum', text: 'text-white' },
  leaf: { box: 'bg-leaf', text: 'text-white' },
  outline: { box: 'border border-line bg-surface', text: 'text-ink' },
  ghost: { box: '', text: 'text-kum' },
  danger: { box: '', text: 'text-danger' },
};

export function Button({ title, variant = 'kum', busy, className, disabled, ...p }: PressableProps & { title: string; variant?: Variant; busy?: boolean; className?: string }) {
  const v = V[variant];
  return (
    <Pressable accessibilityRole="button" disabled={disabled || busy} className={`h-12 flex-row items-center justify-center gap-2 rounded-xl px-4 ${v.box} ${disabled ? 'opacity-40' : ''} ${className ?? ''}`} {...p}>
      {busy ? <ActivityIndicator color={variant === 'kum' || variant === 'leaf' ? '#fff' : '#a3122b'} /> : null}
      <Text className={`text-[15px] font-bold ${v.text}`}>{title}</Text>
    </Pressable>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <View className={`rounded-2xl border border-line bg-surface p-4 ${className ?? ''}`}>{children}</View>;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand' }) {
  const t = { neutral: 'bg-surface-2 text-ink', good: 'bg-[#e3f1df] text-leaf', warn: 'bg-[#fff1cc] text-warn', bad: 'bg-[#fde7ea] text-danger', brand: 'bg-kum text-white' }[tone];
  return <Text className={`self-start overflow-hidden rounded-full px-2.5 py-0.5 text-xs font-bold ${t}`}>{label}</Text>;
}

export function Field({ label, ...p }: TextInputProps & { label: string }) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm font-semibold text-muted">{label}</Text>
      <TextInput placeholderTextColor="#b3a090" className="h-12 rounded-xl border border-line bg-surface px-3 text-base text-ink" {...p} />
    </View>
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  return children ? <Text className="rounded-xl bg-[#fde7ea] px-3 py-2 text-sm font-medium text-danger">{children}</Text> : null;
}
