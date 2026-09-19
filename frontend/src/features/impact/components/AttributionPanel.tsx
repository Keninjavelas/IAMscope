import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ShieldQuestion, Sparkles, X } from 'lucide-react';
import type { AuditAttribution } from '@iamscope/types';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ROUTES } from '@/lib/constants';
import { ResultBadge } from '@/components/domain/ResultBadge';
import { formatDate, formatPercent, humaniseAction } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface AttributionPanelProps {
  attribution: AuditAttribution | null;
  loading: boolean;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  onClear?: (() => void) | undefined;
  className?: string | undefined;
}

function confidenceVariant(confidence: AuditAttribution['confidence']): BadgeVariant {
  if (confidence === 'high') return 'accent';
  if (confidence === 'medium') return 'info';
  return 'muted';
}

/**
 * Attribution for a scenario delta (Plan §12.4, Definition of Done #8).
 *
 * Answers "which edit caused this flip?" with the audit events between the two
 * runs, ranked by how strongly they explain it, plus an explicit confidence band
 * so a weak signal is never mistaken for proof.
 */
export function AttributionPanel({
  attribution,
  loading,
  error,
  onRetry,
  onClear,
  className,
}: AttributionPanelProps): JSX.Element {
  if (loading) {
    return (
      <section className={cn('panel flex flex-col gap-2 p-3', className)} aria-busy="true">
        <span className="sr-only" role="status">
          Finding the cause
        </span>
        <Skeleton className="h-4 w-48" />
        <Skeleton variant="block" className="h-16" />
      </section>
    );
  }

  if (error !== undefined && error !== null) {
    return (
      <section className={cn('panel', className)}>
        <ErrorState
          error={error}
          compact
          title="Could not attribute this change"
          onRetry={onRetry}
        />
      </section>
    );
  }

  if (attribution === null) {
    return (
      <section className={cn('panel', className)} aria-label="Attribution">
        <EmptyState
          compact
          icon={ShieldQuestion}
          title="Pick a scenario to attribute"
          description="Attribution looks at the audit events between two runs and explains which edit flipped a scenario's decision."
        />
      </section>
    );
  }

  return (
    <section
      className={cn('panel flex flex-col overflow-hidden', className)}
      aria-label={`Attribution for ${attribution.scenarioName}`}
      aria-live="polite"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
        <h2 className="text-13 min-w-0 truncate font-medium text-text">
          {attribution.scenarioName}
        </h2>
        <ResultBadge result={attribution.resultBefore} label="before" size="sm" />
        <ResultBadge result={attribution.resultAfter} label="after" size="sm" />
        <Badge variant={confidenceVariant(attribution.confidence)} size="sm">
          {attribution.confidence} confidence
        </Badge>
        <span className="text-micro tabular text-text-subtle">
          {formatPercent(attribution.confidenceScore)}
        </span>
        {onClear === undefined ? null : (
          <button
            type="button"
            onClick={onClear}
            aria-label="Dismiss attribution"
            className="dur-fast ml-auto inline-flex size-6 items-center justify-center rounded-input text-text-subtle outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        )}
      </header>

      <p className="text-12 border-b border-border px-3 py-2 text-text">
        {attribution.explanation === ''
          ? 'No single edit explains this delta.'
          : attribution.explanation}
      </p>

      {attribution.causes.length === 0 ? (
        <p className="text-12 px-3 py-3 text-text-subtle">
          No audit events between the two runs touched the policies or principals in this scenario's
          trace, so the delta cannot be attributed to a recorded edit.
        </p>
      ) : (
        <ol className="flex flex-col">
          {attribution.causes.map((cause) => (
            <li
              key={cause.auditEventId}
              className="flex flex-col gap-1 border-b border-border-subtle px-3 py-2 last:border-b-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="muted" size="sm">
                  {humaniseAction(cause.action)}
                </Badge>
                <span className="text-12 min-w-0 truncate text-text">
                  {cause.target.name === '' ? cause.target.id : cause.target.name}
                </span>
                <span className="text-micro ml-auto tabular text-text-subtle">
                  {formatDate(cause.timestamp)}
                </span>
              </div>

              <p className="text-12 text-text-muted">{cause.rationale}</p>

              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-bg-inset"
                >
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.round(Math.max(0, Math.min(1, cause.weight)) * 100)}%`,
                    }}
                  />
                </span>
                <span className="text-micro tabular text-text-subtle">
                  weight {formatPercent(cause.weight)}
                </span>
                {cause.changedFields.length === 0 ? null : (
                  <span className="mono text-micro min-w-0 truncate text-text-subtle">
                    {cause.changedFields.join(', ')}
                  </span>
                )}
                <Link
                  to={`${ROUTES.audit}?q=${encodeURIComponent(cause.auditEventId)}`}
                  className="text-micro dur-fast ml-auto shrink-0 rounded-input outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Open in audit log
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
