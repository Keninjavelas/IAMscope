import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-accent text-accent-contrast hover:bg-accent-hover active:bg-accent-active',
  secondary:
    'border border-border-strong bg-bg-raised text-text hover:bg-bg-hover active:bg-bg-active',
  ghost:
    'border border-transparent bg-transparent text-text-muted hover:bg-bg-hover hover:text-text active:bg-bg-active',
  danger:
    'border border-transparent bg-danger text-text-inverse hover:opacity-90 active:opacity-100',
  link: 'border border-transparent bg-transparent px-0 text-accent underline decoration-accent/40 underline-offset-2 hover:text-accent-hover hover:decoration-current',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-6 gap-1 px-2 text-12',
  md: 'control-height gap-1.5 px-3 text-13',
  lg: 'h-9 gap-2 px-4 text-14',
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-4',
};

const BASE =
  'dur-fast ease-out-brand inline-flex cursor-pointer items-center justify-center rounded-input font-medium whitespace-nowrap select-none outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:opacity-50';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  loading?: boolean | undefined;
  iconLeft?: LucideIcon | undefined;
  iconRight?: LucideIcon | undefined;
  fullWidth?: boolean | undefined;
  /** Render `children` as the element instead of a wrapping `<button>` (Radix Slot). */
  asChild?: boolean | undefined;
}

export function buttonClassName(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  fullWidth = false,
  className?: string,
): string {
  return cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    iconLeft: IconLeft,
    iconRight: IconRight,
    fullWidth = false,
    asChild = false,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const iconClass = ICON_SIZES[size];

  const glyph: ReactNode = (
    <>
      {loading ? (
        <Loader2 aria-hidden="true" className={cn(iconClass, 'shrink-0 animate-spin')} />
      ) : IconLeft ? (
        <IconLeft aria-hidden="true" className={cn(iconClass, 'shrink-0')} />
      ) : null}
      {children}
      {IconRight ? <IconRight aria-hidden="true" className={cn(iconClass, 'shrink-0')} /> : null}
    </>
  );

  const classes = buttonClassName(variant, size, fullWidth, className);

  if (asChild) {
    return (
      <Slot ref={ref} aria-busy={loading ? true : undefined} className={classes} {...rest}>
        {children}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading ? true : undefined}
      className={classes}
      {...rest}
    >
      {glyph}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, 'iconLeft' | 'iconRight' | 'children'> {
  /** Accessible name - rendered as `aria-label` and `title`. */
  label: string;
  icon: LucideIcon;
}

const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'size-6',
  md: 'size-7',
  lg: 'size-9',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    icon: Icon,
    variant = 'ghost',
    size = 'md',
    asChild = false,
    className,
    loading,
    disabled,
    ...rest
  },
  ref,
) {
  const classes = cn(BASE, VARIANTS[variant], ICON_BUTTON_SIZES[size], 'shrink-0', className);

  const glyph: ReactNode = loading ? (
    <Loader2 aria-hidden="true" className={cn(ICON_SIZES[size], 'animate-spin')} />
  ) : (
    <Icon aria-hidden="true" className={ICON_SIZES[size]} />
  );

  if (asChild) {
    return (
      <Slot ref={ref} aria-label={label} title={label} className={classes} {...rest}>
        {glyph}
      </Slot>
    );
  }

  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled === true || loading}
      aria-label={label}
      title={label}
      aria-busy={loading ? true : undefined}
      className={classes}
      {...rest}
    >
      {glyph}
    </button>
  );
});
