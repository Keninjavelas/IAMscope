import type { JSX } from 'react';
import { cn } from '@/lib/cn';

export type SkeletonVariant = 'text' | 'block' | 'row';

export interface SkeletonProps {
  className?: string | undefined;
  variant?: SkeletonVariant | undefined;
}

/**
 * Skeletons must occupy exactly the space the real content will occupy
 * (Plan §3.8), so `row` uses the live density row height and `text` uses the
 * real line height of a 13px line.
 */
const VARIANTS: Record<SkeletonVariant, string> = {
  text: 'h-4 w-full',
  block: 'h-16 w-full rounded-card',
  row: 'row-height w-full rounded-input',
};

export function Skeleton({ className, variant = 'text' }: SkeletonProps): JSX.Element {
  return <span aria-hidden="true" className={cn('skeleton block', VARIANTS[variant], className)} />;
}

export interface SkeletonRowsProps {
  rows: number;
  columns: number;
  className?: string | undefined;
}

/**
 * Table/panel placeholder. Each row is exactly `--row-height` tall and each cell
 * is padded by `--cell-padding-*`, so swapping it for real rows causes zero shift.
 */
export function SkeletonRows({ rows, columns, className }: SkeletonRowsProps): JSX.Element {
  const columnIndexes = Array.from({ length: Math.max(1, columns) }, (_, index) => index);
  const rowIndexes = Array.from({ length: Math.max(1, rows) }, (_, index) => index);

  return (
    <div role="status" aria-live="polite" aria-busy="true" className={cn('w-full', className)}>
      <span className="sr-only-focusable">Loading content</span>
      {rowIndexes.map((row) => (
        <div
          key={row}
          className="dur-normal flex items-center gap-3 border-b border-border-subtle last:border-b-0"
          style={{ height: 'var(--row-height)' }}
        >
          {columnIndexes.map((column) => (
            <span
              key={column}
              aria-hidden="true"
              className={cn(
                'skeleton block h-3',
                row === 0 ? 'w-24' : 'w-32',
                column === 0 && 'w-40',
              )}
              style={{ flex: column === 0 ? '1 1 40%' : '1 1 25%' }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
