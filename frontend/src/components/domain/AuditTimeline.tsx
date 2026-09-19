import { useMemo, useRef, useState, type JSX } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ChevronDown,
  ChevronRight,
  Fingerprint,
  KeyRound,
  ScrollText,
  Server,
  Target,
} from 'lucide-react';
import { TABLE } from '@iamscope/tokens';
import type { AuditAttribution, AuditAttributionCause, AuditEvent } from '@iamscope/types';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { JsonDiff } from '@/components/ui/JsonDiff';
import { SkeletonRows } from '@/components/ui/Skeleton';
import {
  formatDateOnly,
  formatPercent,
  formatTime,
  humaniseAction,
  truncateArn,
} from '@/lib/format';
import { cn } from '@/lib/cn';

export interface AuditTimelineProps {
  events: AuditEvent[];
  attribution?: AuditAttribution | null | undefined;
  loading?: boolean | undefined;
  highlightIds?: readonly string[] | undefined;
  className?: string | undefined;
}

/* ------------------------------------------------------------------ */
/* Presentation helpers                                                */
/* ------------------------------------------------------------------ */

const DESTRUCTIVE = /(^|\.)(delete|remove|revoke|rotate|disable|purge)/;
const MUTATING = /(^|\.)(create|attach|add|invite|restore|enable)/;
const EDITING = /(^|\.)(update|change|set|rename|edit|accept)/;

/** Colour is always paired with the action's own words (Plan §15.7). */
function actionVariant(action: string): BadgeVariant {
  if (DESTRUCTIVE.test(action)) return 'danger';
  if (MUTATING.test(action)) return 'accent';
  if (EDITING.test(action)) return 'warn';
  return 'muted';
}

function confidenceVariant(confidence: AuditAttribution['confidence']): BadgeVariant {
  if (confidence === 'high') return 'accent';
  if (confidence === 'medium') return 'info';
  return 'muted';
}

function ActorIcon({ type }: { type: AuditEvent['actorType'] }): JSX.Element {
  if (type === 'api_key')
    return <KeyRound aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />;
  if (type === 'system')
    return <Server aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />;
  return <Fingerprint aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />;
}

function actorLabel(event: AuditEvent): string {
  if (event.actorEmail !== null && event.actorEmail !== '') return event.actorEmail;
  if (event.actorType === 'api_key') return 'API key';
  if (event.actorType === 'system') return 'System';
  return 'Unknown actor';
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

type TimelineRow =
  | { kind: 'day'; key: string; day: string; count: number }
  | { kind: 'event'; key: string; event: AuditEvent };

function buildRows(events: readonly AuditEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let currentDay = '';
  // `events` arrives newest-first from the API; buckets keep that order.
  for (const event of events) {
    const day = formatDateOnly(event.timestamp);
    if (day !== currentDay) {
      currentDay = day;
      rows.push({
        kind: 'day',
        key: `day-${day}`,
        day,
        count: events.filter((candidate) => formatDateOnly(candidate.timestamp) === day).length,
      });
    }
    rows.push({ kind: 'event', key: event.id, event });
  }
  return rows;
}

function CauseSummary({ cause }: { cause: AuditAttributionCause }): JSX.Element {
  return (
    <div className="inset-surface mt-1.5 flex flex-col gap-1 p-2">
      <p className="text-12 text-text">{cause.rationale}</p>
      <p className="text-micro flex flex-wrap items-center gap-x-2 text-text-subtle">
        <span className="tabular">weight {formatPercent(cause.weight)}</span>
        {cause.changedFields.length > 0 ? (
          <span className="mono truncate">fields: {cause.changedFields.join(', ')}</span>
        ) : null}
      </p>
    </div>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  highlighted,
  cause,
}: {
  event: AuditEvent;
  expanded: boolean;
  onToggle: () => void;
  highlighted: boolean;
  cause: AuditAttributionCause | null;
}): JSX.Element {
  const detailId = `audit-detail-${event.id}`;

  return (
    <div
      className={cn(
        'dur-fast border-b border-border-subtle last:border-b-0',
        highlighted && 'bg-accent-subtle',
      )}
    >
      <div className="flex items-start gap-2 px-2 py-1.5">
        <span className="text-micro mono w-16 shrink-0 pt-0.5 text-text-subtle tabular">
          {formatTime(event.timestamp)}
        </span>

        <ActorIcon type={event.actorType} />
        <span
          className="w-40 min-w-0 shrink-0 truncate text-12 text-text-muted"
          title={actorLabel(event)}
        >
          {actorLabel(event)}
        </span>

        <Badge variant={actionVariant(event.action)} size="sm" className="shrink-0">
          {humaniseAction(event.action)}
        </Badge>
        <span className="mono text-micro hidden shrink-0 text-text-subtle sm:inline">
          {event.action}
        </span>

        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Target aria-hidden="true" className="size-3 shrink-0 text-text-subtle" />
          <span
            className="text-12 min-w-0 truncate text-text"
            title={`${event.target.type} ${event.target.id}`}
          >
            {event.target.name === '' ? event.target.type : event.target.name}
          </span>
          <span className="mono text-micro hidden truncate text-text-subtle md:inline">
            {truncateArn(event.target.id, { max: 40 })}
          </span>
        </span>

        {cause !== null ? (
          <Badge variant="accent" size="sm" className="shrink-0" title={cause.rationale}>
            explains the delta
          </Badge>
        ) : null}

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailId}
          onClick={onToggle}
          className="dur-fast inline-flex size-6 shrink-0 items-center justify-center rounded-input text-text-subtle outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          aria-label={
            expanded
              ? `Hide details for ${humaniseAction(event.action)}`
              : `Show before and after for ${humaniseAction(event.action)}`
          }
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>

      {cause !== null ? (
        <div className="px-2 pb-1.5 pl-24">{<CauseSummary cause={cause} />}</div>
      ) : null}

      {expanded ? (
        <div id={detailId} className="px-2 pb-2 pl-6">
          <dl className="text-micro mono mb-1.5 flex flex-wrap gap-x-3 text-text-subtle">
            <div className="flex gap-1">
              <dt>event</dt>
              <dd className="tabular">{event.id}</dd>
            </div>
            <div className="flex gap-1">
              <dt>timestamp</dt>
              <dd>{event.timestamp}</dd>
            </div>
          </dl>
          <JsonDiff before={event.before} after={event.after} title="Before / after" />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

/**
 * The vertical audit stream (Plan §8.11, §12.4).
 *
 * Grouped by day with sticky headers and virtualized above the shared threshold
 * so a 90-day audit log scrolls without dropping frames. When an attribution is
 * supplied, the events that explain a scenario delta are highlighted and their
 * confidence band and rationale are shown inline.
 */
export function AuditTimeline({
  events,
  attribution = null,
  loading = false,
  highlightIds,
  className,
}: AuditTimelineProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const causes = useMemo(() => {
    const map = new Map<string, AuditAttributionCause>();
    for (const cause of attribution?.causes ?? []) map.set(cause.auditEventId, cause);
    return map;
  }, [attribution]);

  const extraHighlights = useMemo(() => new Set(highlightIds ?? []), [highlightIds]);

  const rows = useMemo(() => buildRows(events), [events]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = rows.length > TABLE.virtualizationThreshold;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.kind === 'day' ? 28 : 44),
    overscan: TABLE.overscan,
    enabled: shouldVirtualize,
    getItemKey: (index) => rows[index]?.key ?? index,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const rendered: { row: TimelineRow; index: number }[] = shouldVirtualize
    ? virtualItems.flatMap((item) => {
        const row = rows[item.index];
        return row === undefined ? [] : [{ row, index: item.index }];
      })
    : rows.map((row, index) => ({ row, index }));

  if (loading) {
    return (
      <div className={cn('panel p-2', className)}>
        <SkeletonRows rows={10} columns={4} />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className={cn('panel', className)}>
        <EmptyState
          icon={ScrollText}
          title="No audit events"
          description="Every mutation in this organization is recorded here - policy edits, principal changes, membership and API key events - with the exact before and after values."
        />
      </div>
    );
  }

  const attributionSummary =
    attribution === null
      ? ''
      : attribution.explanation === ''
        ? `${attribution.causes.length} audit events explain the change to ${attribution.scenarioName}.`
        : attribution.explanation;

  return (
    <section
      className={cn('panel flex min-h-0 flex-col overflow-hidden', className)}
      aria-label="Audit events"
    >
      {attribution === null ? null : (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
          aria-live="polite"
        >
          <Badge variant={confidenceVariant(attribution.confidence)} size="sm">
            {attribution.confidence} confidence
          </Badge>
          <span className="text-12 min-w-0 flex-1 text-text">{attributionSummary}</span>
          <span className="text-micro tabular text-text-subtle">
            {formatPercent(attribution.confidenceScore)} · {attribution.causes.length} candidate
            {attribution.causes.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <ul className="flex flex-col">
          {rendered.map(({ row, index }) => {
            const wrapperRef = shouldVirtualize
              ? (node: HTMLLIElement | null) => {
                  if (node !== null) virtualizer.measureElement(node);
                }
              : undefined;

            if (row.kind === 'day') {
              return (
                <li
                  key={row.key}
                  ref={wrapperRef}
                  data-index={index}
                  className="sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-bg-raised px-2 py-1"
                >
                  <h3 className="text-12 font-medium text-text">{row.day}</h3>
                  <span className="text-micro tabular text-text-subtle">
                    {row.count} event{row.count === 1 ? '' : 's'}
                  </span>
                </li>
              );
            }

            return (
              <li key={row.key} ref={wrapperRef} data-index={index}>
                <EventRow
                  event={row.event}
                  expanded={expandedId === row.event.id}
                  onToggle={() => setExpandedId(expandedId === row.event.id ? null : row.event.id)}
                  highlighted={causes.has(row.event.id) || extraHighlights.has(row.event.id)}
                  cause={causes.get(row.event.id) ?? null}
                />
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
