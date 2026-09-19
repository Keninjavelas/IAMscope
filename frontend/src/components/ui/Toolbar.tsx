import type { ReactNode, JSX } from 'react';
import { cn } from '@/lib/cn';

export interface ToolbarProps {
  children: ReactNode;
  className?: string | undefined;
  /** Accessible name for the toolbar landmark. */
  label?: string | undefined;
}

/** Single row of filters/actions above a list. Wraps rather than scrolling. */
export function Toolbar({
  children,
  className,
  label = 'List controls',
}: ToolbarProps): JSX.Element {
  return (
    <div
      role="toolbar"
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-card border border-border bg-bg-raised px-2 py-1.5',
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface ToolbarSpacerProps {
  children?: ReactNode | undefined;
}

/** Pushes everything after it to the right edge. */
export function ToolbarSpacer({ children }: ToolbarSpacerProps): JSX.Element {
  return <div className="ml-auto flex items-center gap-2">{children}</div>;
}
