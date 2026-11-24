'use client';
/**
 * shadcn/ui-style primitives (copied-in source, Tailwind v4 tokens).
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ Button */
export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-45 select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'bg-kum text-kum-ink hover:brightness-110 active:brightness-95',
        haldi: 'bg-haldi text-[#3a1d05] hover:brightness-105',
        leaf: 'bg-leaf text-white hover:brightness-110',
        outline: 'border border-line bg-surface hover:bg-surface-2',
        ghost: 'hover:bg-surface-2',
        destructive: 'bg-danger text-white hover:brightness-110',
        link: 'text-kum underline-offset-4 hover:underline px-0',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-[15px]',
        lg: 'h-14 px-6 text-base',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';

/* ------------------------------------------------------------------ Inputs */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn('h-11 w-full rounded-xl border border-line bg-surface px-3 text-base placeholder:text-muted/70 disabled:opacity-60', className)} {...props} />
));
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn('w-full rounded-xl border border-line bg-surface px-3 py-2 text-base', className)} {...props} />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn('h-11 w-full rounded-xl border border-line bg-surface px-3 text-base', className)} {...props} />
));
Select.displayName = 'Select';

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn('grid gap-1.5 text-sm font-semibold text-muted', className)}>
      <span>{label}</span>
      {children}
      {error ? <span className="text-[13px] font-medium text-danger">{error}</span> : hint ? <span className="text-[13px] font-normal">{hint}</span> : null}
    </label>
  );
}

/* ------------------------------------------------------------------ Card */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-line bg-surface p-4 sm:p-5', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-[17px] font-bold leading-tight', className)} {...props} />;
}

/* ------------------------------------------------------------------ Badge */
const badgeVariants = cva('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold whitespace-nowrap', {
  variants: {
    tone: {
      neutral: 'bg-surface-2 text-ink border border-line',
      good: 'bg-leaf/15 text-leaf',
      warn: 'bg-haldi/25 text-warn',
      bad: 'bg-danger/12 text-danger',
      brand: 'bg-kum text-kum-ink',
    },
  },
  defaultVariants: { tone: 'neutral' },
});
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/* ------------------------------------------------------------------ Dialog */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, title, description, wide, ...props }: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { title: string; description?: string; wide?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 grid max-h-[92dvh] w-full gap-4 overflow-y-auto border border-line bg-surface p-5 shadow-2xl',
          'bottom-0 left-0 rounded-t-3xl sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <DialogPrimitive.Title className="text-xl font-bold leading-tight">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-sm text-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="rounded-full p-2 hover:bg-surface-2" aria-label="Close">
            <X className="size-5" />
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/* ------------------------------------------------------------------ Table */
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className={cn('w-full border-collapse text-[14px]', className)} {...props} />
    </div>
  );
}
export const Th = ({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) => <th className={cn('border-b border-line bg-surface-2 px-3 py-2.5 text-left text-[13px] font-semibold text-muted', className)} {...p} />;
export const Td = ({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) => <td className={cn('border-b border-line px-3 py-2.5 align-middle', className)} {...p} />;

/* ------------------------------------------------------------------ Misc */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-5', className)} aria-hidden="true" />;
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn('h-9 rounded-xl px-3 text-sm font-semibold', o.value === value ? 'bg-kum text-kum-ink' : 'text-muted hover:bg-surface-2')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children ? <div className="text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'brand' }) {
  return (
    <div className={cn('rounded-2xl border p-4', tone === 'brand' ? 'border-kum bg-kum text-kum-ink' : 'border-line bg-surface')}>
      <div className={cn('text-[13px] font-semibold', tone === 'brand' ? 'text-white/80' : 'text-muted')}>{label}</div>
      <div className="num mt-1 text-[clamp(22px,2.4vw,30px)] font-extrabold leading-none">{value}</div>
      {sub ? <div className={cn('mt-1.5 text-[13px]', tone === 'brand' ? 'text-white/80' : 'text-muted')}>{sub}</div> : null}
    </div>
  );
}
