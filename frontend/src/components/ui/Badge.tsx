import type { ReactNode, JSX } from 'react';
import { Ban, Check, Info, Minus, ShieldAlert, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type BadgeVariant =
  'allow' | 'deny' | 'warn' | 'info' | 'muted' | 'accent' | 'success' | 'danger' | 'outline';

export type BadgeSize = 'sm' | 'md';

const VARIANTS: Record<BadgeVariant, string> = {
  allow: 'border-allow/40 bg-success-subtle text-allow',
  deny: 'border-deny/40 bg-danger-subtle text-deny',
  warn: 'border-warn/40 bg-warn-subtle text-warn',
  info: 'border-info/40 bg-info-subtle text-info',
  muted: 'border-border bg-bg-inset text-text-muted',
  accent: 'border-accent/40 bg-accent-subtle text-accent',
  success: 'border-success/40 bg-success-subtle text-success',
  danger: 'border-danger/40 bg-danger-subtle text-danger',
  outline: 'border-border-strong bg-transparent text-text-muted',
};

/** Default glyph per variant - colour is never the only signal (Plan §15.7). */
const DEFAULT_ICON: Partial<Record<BadgeVariant, LucideIcon>> = {
  allow: Check,
  deny: Ban,
  warn: TriangleAlert,
  info: Info,
  success: Check,
  danger: ShieldAlert,
  muted: Minus,
};

const SIZES: Record<BadgeSize, string> = {
  sm: 'h-5 gap-1 px-1.5 text-11',
  md: 'h-6 gap-1.5 px-2 text-12',
};

const ICON_SIZES: Record<BadgeSize, string> = {
  sm: 'size-3',
  md: 'size-3.5',
};

export interface BadgeProps {
  variant: BadgeVariant;
  size?: BadgeSize | undefined;
  icon?: LucideIcon | undefined;
  children: ReactNode;
  className?: string | undefined;
  /** Force-remove the icon (e.g. inside an already-icon-bearing row). */
  hideIcon?: boolean | undefined;
  title?: string | undefined;
}

export function Badge({
  variant,
  size = 'sm',
  icon,
  children,
  className,
  hideIcon = false,
  title,
}: BadgeProps): JSX.Element {
  const Icon = icon ?? (hideIcon ? undefined : DEFAULT_ICON[variant]);

  return (
    <span
      title={title}
      className={cn(
        'inline-flex max-w-full shrink-0 items-center rounded-input border font-medium whitespace-nowrap',
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" className={cn(ICON_SIZES[size], 'shrink-0')} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
