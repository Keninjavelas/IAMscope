import type { JSX } from 'react';
import * as RadixAvatar from '@radix-ui/react-avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/cn';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const SIZES: Record<AvatarSize, string> = {
  xs: 'size-4 text-[8px]',
  sm: 'size-5 text-[9px]',
  md: 'size-6 text-11',
  lg: 'size-9 text-13',
};

/**
 * Deterministic background from the name (Plan §20: no image hosting). The same
 * person always gets the same tint, in both themes.
 */
const TINTS: readonly string[] = [
  'oklch(0.55 0.14 250)',
  'oklch(0.52 0.16 295)',
  'oklch(0.54 0.11 190)',
  'oklch(0.62 0.13 80)',
  'oklch(0.55 0.16 15)',
  'oklch(0.54 0.13 150)',
];

export function tintForName(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 1_000_003;
  }
  return TINTS[hash % TINTS.length] ?? TINTS[0] ?? 'oklch(0.55 0.14 250)';
}

export interface AvatarProps {
  name: string;
  src?: string | null | undefined;
  size?: AvatarSize | undefined;
  className?: string | undefined;
  /** Hide from assistive tech when the name is rendered next to it. */
  decorative?: boolean | undefined;
  /** Adds a surface-coloured ring, for overlapping stacks. */
  ring?: boolean | undefined;
}

export function Avatar({
  name,
  src = null,
  size = 'md',
  className,
  decorative = false,
  ring = false,
}: AvatarProps): JSX.Element {
  return (
    <RadixAvatar.Root
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full select-none',
        SIZES[size],
        ring && 'ring-2 ring-bg-raised',
        className,
      )}
      style={{ backgroundColor: tintForName(name) }}
      {...(decorative ? { 'aria-hidden': true as const } : {})}
    >
      {src ? <RadixAvatar.Image src={src} alt={name} className="size-full object-cover" /> : null}
      <RadixAvatar.Fallback
        delayMs={src ? 300 : 0}
        className="text-11 font-semibold tracking-wide text-white uppercase"
      >
        {initials(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}
