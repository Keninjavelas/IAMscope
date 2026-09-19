import { useMemo, type JSX } from 'react';
import type { TimelineCategory, TimelineEventMarker } from '@iamscope/types';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatDateOnly, humaniseAction, toDate } from '@/lib/format';
import { cn } from '@/lib/cn';

export interface TimelineMarkersProps {
  markers: TimelineEventMarker[];
  min: string;
  max: string;
  selectedId?: string | null | undefined;
  onSelect: (marker: TimelineEventMarker) => void;
  className?: string | undefined;
}

/* ------------------------------------------------------------------ */
/* Category presentation                                               */
/* ------------------------------------------------------------------ */

interface CategoryStyle {
  label: string;
  dot: string;
  text: string;
}

/** One hue per category; every tick also carries its category as text. */
export const CATEGORY_STYLE: Record<TimelineCategory, CategoryStyle> = {
  policy: { label: 'Policy', dot: 'bg-accent', text: 'text-accent' },
  principal: { label: 'Principal', dot: 'bg-info', text: 'text-info' },
  resource: { label: 'Resource', dot: 'bg-success', text: 'text-success' },
  scenario: { label: 'Scenario', dot: 'bg-warn', text: 'text-warn' },
  membership: { label: 'Membership', dot: 'bg-severity-low', text: 'text-severity-low' },
  org: { label: 'Organization', dot: 'bg-severity-medium', text: 'text-severity-medium' },
  apikey: { label: 'API key', dot: 'bg-severity-high', text: 'text-severity-high' },
};

export function categoryStyle(category: TimelineCategory): CategoryStyle {
  return CATEGORY_STYLE[category];
}

/* ------------------------------------------------------------------ */
/* Layout                                                             */
/* ------------------------------------------------------------------ */

export interface MarkerTick {
  key: string;
  /** Percentage of the range, 0..100. */
  position: number;
  markers: TimelineEventMarker[];
  category: TimelineCategory;
}

const CLUSTER_WINDOW_PERCENT = 0.7;

/**
 * Group markers that would collide into one tick. Deterministic and cheap: the
 * markers arrive sorted by timestamp, so a single pass is enough.
 */
export function buildTicks(
  markers: readonly TimelineEventMarker[],
  startMs: number,
  endMs: number,
): MarkerTick[] {
  const span = Math.max(1, endMs - startMs);
  const positioned = markers.flatMap((marker) => {
    const at = toDate(marker.timestamp)?.getTime();
    if (at === undefined) return [];
    const position = ((at - startMs) / span) * 100;
    if (!Number.isFinite(position)) return [];
    return [{ marker, position: Math.max(0, Math.min(100, position)) }];
  });

  const ticks: MarkerTick[] = [];
  for (const entry of positioned) {
    const last = ticks[ticks.length - 1];
    if (last !== undefined && entry.position - last.position <= CLUSTER_WINDOW_PERCENT) {
      last.markers.push(entry.marker);
      continue;
    }
    ticks.push({
      key: entry.marker.id,
      position: entry.position,
      markers: [entry.marker],
      category: entry.marker.category,
    });
  }
  return ticks;
}

function dayLabel(timestamp: string): string {
  return formatDateOnly(timestamp);
}

/* ------------------------------------------------------------------ */
/* Rail                                                               */
/* ------------------------------------------------------------------ */

/**
 * Marker rail above the scrubber track (Plan §15.6).
 *
 * One tick per event, coloured by category and clustered when the window is too
 * dense to draw individual ticks. Hovering a tick aggregates the day's events;
 * clicking snaps the scrubber and opens the audit detail for that event.
 */
export function TimelineMarkers({
  markers,
  min,
  max,
  selectedId = null,
  onSelect,
  className,
}: TimelineMarkersProps): JSX.Element {
  const startMs = toDate(min)?.getTime() ?? 0;
  const endMs = toDate(max)?.getTime() ?? startMs + 1;

  const ticks = useMemo(() => buildTicks(markers, startMs, endMs), [markers, startMs, endMs]);

  /** Per-day totals, so a hovered tick can show what the whole day contains. */
  const dayTotals = useMemo(() => {
    const map = new Map<string, { total: number; byCategory: Map<TimelineCategory, number> }>();
    for (const marker of markers) {
      const day = dayLabel(marker.timestamp);
      const entry = map.get(day) ?? { total: 0, byCategory: new Map<TimelineCategory, number>() };
      entry.total += 1;
      entry.byCategory.set(marker.category, (entry.byCategory.get(marker.category) ?? 0) + 1);
      map.set(day, entry);
    }
    return map;
  }, [markers]);

  if (markers.length === 0) {
    return (
      <div className={cn('text-micro flex h-6 items-center text-text-subtle', className)}>
        No audit events in this range.
      </div>
    );
  }

  return (
    <div className={cn('relative h-6', className)}>
      <ol className="absolute inset-0" aria-label="Audit event markers">
        {ticks.map((tick) => {
          const style = categoryStyle(tick.category);
          const clustered = tick.markers.length > 1;
          const first = tick.markers[0];
          const selected =
            selectedId !== null && tick.markers.some((marker) => marker.id === selectedId);
          const day = first === undefined ? '' : dayLabel(first.timestamp);
          const totals = dayTotals.get(day);

          const label = clustered
            ? `${tick.markers.length} events on ${day}`
            : `${style.label}: ${first === undefined ? '' : humaniseAction(first.action)} on ${day}`;

          return (
            <li
              key={tick.key}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${tick.position}%` }}
            >
              <Tooltip
                content={
                  <span className="flex flex-col gap-0.5">
                    <span className="text-12 font-medium">
                      {clustered ? `${tick.markers.length} events` : label}
                    </span>
                    <span className="text-micro text-text-muted">{day}</span>
                    {totals === undefined ? null : (
                      <span className="text-micro text-text-muted">
                        {[...totals.byCategory.entries()]
                          .map(([category, count]) => `${categoryStyle(category).label} ${count}`)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                }
              >
                <button
                  type="button"
                  onClick={() => {
                    const target = tick.markers.find((marker) => marker.id === selectedId) ?? first;
                    if (target !== undefined) onSelect(target);
                  }}
                  aria-label={label}
                  aria-pressed={selected}
                  className={cn(
                    'dur-fast flex h-5 items-center gap-0.5 rounded-input px-0.5 outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                    clustered && 'ring-1 ring-border-strong',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'w-0.5 rounded-full',
                      style.dot,
                      clustered ? 'h-3.5' : 'h-2.5',
                      selected && 'h-4 w-1',
                    )}
                  />
                  {clustered ? (
                    <span className="text-micro tabular text-text-subtle">
                      {tick.markers.length}
                    </span>
                  ) : null}
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
