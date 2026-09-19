import type { JSX } from 'react';
import { Construction } from 'lucide-react';
import { EmptyState } from './EmptyState';
import { PageHeader } from './PageHeader';
import { Badge } from './Badge';

export interface PagePlaceholderProps {
  title: string;
  description: string;
  /** Which build phase replaces this placeholder, e.g. "Phase 9". */
  phase: string;
}

/**
 * Rendered by the lens routes until their dedicated workstream lands. It is a
 * real page (header + teaching empty state) so the route table, keyboard map and
 * breadcrumbs can all be verified end to end.
 */
export function PagePlaceholder({ title, description, phase }: PagePlaceholderProps): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={title}
        description={description}
        actions={
          <Badge variant="muted" icon={Construction}>
            {phase}
          </Badge>
        }
      />
      <div className="panel">
        <EmptyState
          icon={Construction}
          title={`${title} is being built`}
          description={
            <>
              <p>{description}</p>
              <p className="mt-1">
                The data layer, routes and keyboard shortcuts for this lens are already wired; only
                the view itself is still a placeholder.
              </p>
            </>
          }
        />
      </div>
    </div>
  );
}
