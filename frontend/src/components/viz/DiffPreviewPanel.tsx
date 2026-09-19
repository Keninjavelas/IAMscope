import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, FileClock } from 'lucide-react';
import type { TimelineChangeSummary, TimelineDiffPreview } from '@iamscope/types';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ROUTES, policyRoutes } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface DiffPreviewPanelProps {
  preview: TimelineDiffPreview | null;
  loading?: boolean | undefined;
  onSelectChange?: ((change: TimelineChangeSummary) => void) | undefined;
  className?: string | undefined;
}

interface StatRow {
  key: string;
  label: string;
  added: number;
  removed: number;
  changed: number;
}

function changeToneClass(count: number, kind: 'added' | 'removed' | 'changed'): string {
  if (count === 0) return 'text-text-subtle';
  if (kind === 'added') return 'text-diff-added';
  if (kind === 'removed') return 'text-diff-removed';
  return 'text-diff-changed';
}

const CHANGE_BADGE: Record<TimelineChangeSummary['change'], { label: string; className: string }> =
  {
    added: { label: 'added', className: 'diff-added' },
    removed: { label: 'removed', className: 'diff-removed' },
    changed: { label: 'changed', className: 'diff-changed' },
  };

/**
 * Where a change should link to. Entity types without a detail route fall back to
 * the list filtered by the entity's own identifier.
 */
export function changeHref(change: TimelineChangeSummary): string {
  const type = change.entityType.toLowerCase();
  if (type.includes('policy')) return policyRoutes.detail(change.entityId);
  if (
    type.includes('principal') ||
    type.includes('user') ||
    type.includes('role') ||
    type.includes('group')
  ) {
    return `/principals/${encodeURIComponent(change.entityId)}`;
  }
  if (type.includes('resource')) return `${ROUTES.resources}?q=${encodeURIComponent(change.name)}`;
  if (type.includes('scenario')) return `${ROUTES.scenarios}?q=${encodeURIComponent(change.name)}`;
  return ROUTES.audit;
}

/**
 * Live diff preview beside the scrubber (Plan §15.6).
 *
 * Shows what moving the scrubber to the current position just changed: a compact
 * per-entity-type stat grid plus the highest-signal individual changes, each
 * linking straight to the entity it touched.
 */
export function DiffPreviewPanel({
  preview,
  loading = false,
  onSelectChange,
  className,
}: DiffPreviewPanelProps): JSX.Element {
  if (loading && preview === null) {
    return (
      <section className={cn('panel flex flex-col gap-2 p-3', className)} aria-busy="true">
        <span className="sr-only" role="status">
          Loading state diff
        </span>
        <Skeleton className="h-4 w-32" />
        <Skeleton variant="block" className="h-20" />
      </section>
    );
  }

  if (preview === null) {
    return (
      <section className={cn('panel', className)} aria-label="State diff preview">
        <EmptyState
          compact
          icon={FileClock}
          title="No state comparison yet"
          description="Move the scrubber and this panel shows what changed at that moment: policies, principals and resources added, removed or edited."
        />
      </section>
    );
  }

  const rows: StatRow[] = [
    {
      key: 'policies',
      label: 'Policies',
      added: preview.addedPolicies,
      removed: preview.removedPolicies,
      changed: preview.changedPolicies,
    },
    {
      key: 'principals',
      label: 'Principals',
      added: preview.addedPrincipals,
      removed: preview.removedPrincipals,
      changed: preview.changedPrincipals,
    },
    {
      key: 'resources',
      label: 'Resources',
      added: preview.addedResources,
      removed: preview.removedResources,
      changed: preview.changedResources,
    },
  ];

  const totals = rows.reduce(
    (accumulator, row) => ({
      added: accumulator.added + row.added,
      removed: accumulator.removed + row.removed,
      changed: accumulator.changed + row.changed,
    }),
    { added: 0, removed: 0, changed: 0 },
  );

  return (
    <section
      className={cn('panel flex flex-col overflow-hidden', className)}
      aria-label="State diff preview"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-13 font-medium text-text">What changed here</h2>
        <p className="text-micro text-text-subtle">
          {preview.comparedTo === null ? (
            <>baseline state · {formatDate(preview.at)}</>
          ) : (
            <>
              vs <span className="tabular">{formatDate(preview.comparedTo)}</span>
            </>
          )}
        </p>
      </header>

      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <div className="flex flex-col items-center gap-0.5 px-2 py-2">
          <span className="text-micro text-text-subtle">added</span>
          <span
            className={cn('text-14 tabular font-medium', changeToneClass(totals.added, 'added'))}
          >
            {totals.added}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-2 py-2">
          <span className="text-micro text-text-subtle">removed</span>
          <span
            className={cn(
              'text-14 tabular font-medium',
              changeToneClass(totals.removed, 'removed'),
            )}
          >
            {totals.removed}
          </span>
        </div>
        <div className="flex flex-col items-center gap-0.5 px-2 py-2">
          <span className="text-micro text-text-subtle">changed</span>
          <span
            className={cn(
              'text-14 tabular font-medium',
              changeToneClass(totals.changed, 'changed'),
            )}
          >
            {totals.changed}
          </span>
        </div>
      </div>

      <table className="w-full border-collapse">
        <caption className="sr-only">Changes per entity type</caption>
        <thead>
          <tr className="border-b border-border-subtle">
            <th scope="col" className="text-micro px-3 py-1 text-left font-medium text-text-muted">
              Entity
            </th>
            <th scope="col" className="text-micro px-2 py-1 text-right font-medium text-text-muted">
              added
            </th>
            <th scope="col" className="text-micro px-2 py-1 text-right font-medium text-text-muted">
              removed
            </th>
            <th scope="col" className="text-micro px-3 py-1 text-right font-medium text-text-muted">
              changed
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border-subtle last:border-b-0">
              <th scope="row" className="text-12 px-3 py-1 text-left font-normal text-text">
                {row.label}
              </th>
              <td
                className={cn(
                  'text-12 px-2 py-1 text-right tabular',
                  changeToneClass(row.added, 'added'),
                )}
              >
                {row.added}
              </td>
              <td
                className={cn(
                  'text-12 px-2 py-1 text-right tabular',
                  changeToneClass(row.removed, 'removed'),
                )}
              >
                {row.removed}
              </td>
              <td
                className={cn(
                  'text-12 px-3 py-1 text-right tabular',
                  changeToneClass(row.changed, 'changed'),
                )}
              >
                {row.changed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="min-h-0 flex-1 overflow-auto border-t border-border">
        <h3 className="text-micro px-3 pt-2 pb-1 font-medium tracking-wide text-text-subtle uppercase">
          Top changes
        </h3>
        {preview.topChanges.length === 0 ? (
          <p className="text-12 px-3 pb-3 text-text-subtle">
            Nothing changed at this position - the state is identical to the previous event.
          </p>
        ) : (
          <ul className="flex flex-col">
            {preview.topChanges.map((change, index) => {
              const badge = CHANGE_BADGE[change.change];
              return (
                <li
                  key={`${change.entityType}-${change.entityId}-${index}`}
                  className="flex items-start gap-2 border-b border-border-subtle px-3 py-1.5 last:border-b-0"
                >
                  <span
                    className={cn(
                      'text-micro mt-0.5 shrink-0 rounded-[3px] px-1 font-medium',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onSelectChange?.(change)}
                      disabled={onSelectChange === undefined}
                      className="dur-fast text-12 block max-w-full truncate rounded-input text-left text-text outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default"
                    >
                      {change.name === '' ? change.entityId : change.name}
                    </button>
                    <span className="text-micro block text-text-muted">{change.detail}</span>
                  </span>
                  {change.version === undefined ? null : (
                    <span className="text-micro mono shrink-0 text-text-subtle">
                      v{change.version}
                    </span>
                  )}
                  <Link
                    to={changeHref(change)}
                    className="text-micro dur-fast flex shrink-0 items-center gap-0.5 rounded-input no-underline outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    aria-label={`Open ${change.entityType} ${change.name}`}
                  >
                    Open
                    <ArrowRight aria-hidden="true" className="size-3" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
