import type { ReactNode, JSX } from 'react';
import { Inbox, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  icon?: LucideIcon | undefined;
  title: string;
  /** Empty states must teach (Plan §15.1) - explain what would appear here. */
  description?: ReactNode | undefined;
  action?: ReactNode | undefined;
  className?: string | undefined;
  /** Tighter padding for inline (inside a card) usage. */
  compact?: boolean | undefined;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
  compact = false,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-9 items-center justify-center rounded-panel border border-border bg-bg-inset text-text-subtle"
      >
        <Icon className="size-4" />
      </span>
      <p className="text-14 font-medium text-text">{title}</p>
      {description ? (
        <div className="text-meta max-w-prose text-text-muted">{description}</div>
      ) : null}
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
