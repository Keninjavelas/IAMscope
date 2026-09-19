import { useMemo, type JSX } from 'react';
import { AlertTriangle, Route } from 'lucide-react';
import type { EscalationSeverity, EscalationPath } from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { severityPresentation, severityRank } from '@/lib/graph';
import { cn } from '@/lib/cn';

export interface PathListProps {
  paths: readonly EscalationPath[];
  selectedPathId: string | null;
  hoveredPathId?: string | null | undefined;
  onSelect: (pathId: string | null) => void;
  onHover?: ((pathId: string | null) => void) | undefined;
  className?: string | undefined;
}

const SEVERITY_BADGE: Record<EscalationSeverity, 'danger' | 'warn' | 'info'> = {
  high: 'danger',
  medium: 'warn',
  low: 'info',
};

/**
 * The escalation paths, highest severity first (Plan §11.3, §15.5).
 *
 * This is the keyboard-and-screen-reader entry point to the graph: every path is
 * a button, and selecting one highlights it hop-by-hop in the canvas.
 */
export function PathList({
  paths,
  selectedPathId,
  hoveredPathId = null,
  onSelect,
  onHover,
  className,
}: PathListProps): JSX.Element {
  const ordered = useMemo(
    () =>
      [...paths].sort(
        (a, b) =>
          severityRank(b.severity) - severityRank(a.severity) ||
          b.hops.length - a.hops.length ||
          a.fromPrincipalName.localeCompare(b.fromPrincipalName),
      ),
    [paths],
  );

  if (ordered.length === 0) {
    return (
      <div className={cn('panel', className)}>
        <EmptyState
          compact
          icon={Route}
          title="No escalation paths"
          description="Nothing in this organization currently chains two or more hops from one principal to another."
        />
      </div>
    );
  }

  return (
    <section
      className={cn('panel flex max-h-full min-h-0 flex-col overflow-hidden', className)}
      aria-label="Escalation paths"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        <h2 className="text-13 font-medium text-text">Escalation paths</h2>
        <span className="text-micro ml-auto tabular text-text-subtle">{ordered.length}</span>
      </header>

      <ul className="flex min-h-0 flex-col overflow-auto p-1">
        {ordered.map((path) => {
          const presentation = severityPresentation(path.severity);
          const selected = path.id === selectedPathId;
          const hovered = path.id === hoveredPathId;
          return (
            <li key={path.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(selected ? null : path.id)}
                onPointerEnter={() => onHover?.(path.id)}
                onPointerLeave={() => onHover?.(null)}
                onFocus={() => onHover?.(path.id)}
                onBlur={() => onHover?.(null)}
                className={cn(
                  'dur-fast flex w-full flex-col gap-1 rounded-input border-l-2 px-2 py-1.5 text-left outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                  selected ? 'bg-bg-selected' : hovered ? 'bg-bg-hover' : '',
                )}
                style={{ borderLeftColor: `var(--severity-${path.severity})` }}
              >
                <span className="flex items-center gap-1.5">
                  <Badge variant={SEVERITY_BADGE[path.severity]} size="sm">
                    {presentation.label}
                  </Badge>
                  <span className="text-micro mono truncate text-text-subtle">{path.pattern}</span>
                  <span className="text-micro ml-auto shrink-0 tabular text-text-subtle">
                    {path.hops.length} hop{path.hops.length === 1 ? '' : 's'}
                  </span>
                </span>

                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="text-12 min-w-0 flex-1 truncate text-text"
                    title={path.fromPrincipalArn}
                  >
                    {path.fromPrincipalName}
                  </span>
                  <span aria-hidden="true" className="text-text-subtle">
                    →
                  </span>
                  <span
                    className="text-12 min-w-0 flex-1 truncate text-text"
                    title={path.toPrincipalArn}
                  >
                    {path.toPrincipalName}
                  </span>
                </span>

                <span
                  className="text-micro truncate text-text-muted"
                  title={presentation.description}
                >
                  {path.hops.map((hop) => hop.targetName).join(' → ')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
