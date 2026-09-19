import type { ReactNode, JSX } from 'react';
import { formatKeybinding } from '@/hooks/useKeyboard';
import { cn } from '@/lib/cn';

export interface KbdProps {
  /** Binding string, e.g. `'mod+k'` or `'g p'`. Rendered as separate keys. */
  keys?: string | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
}

export function Kbd({ keys, children, className }: KbdProps): JSX.Element {
  const parts = keys === undefined ? [] : formatKeybinding(keys);

  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {parts.length > 0
        ? parts.map((part, index) => (
            <kbd
              key={`${part}-${index}`}
              className="text-11 inline-flex h-5 min-w-5 items-center justify-center rounded-[3px] border border-border-strong bg-bg-inset px-1 font-medium text-text-muted"
            >
              {part}
            </kbd>
          ))
        : null}
      {children}
    </span>
  );
}
