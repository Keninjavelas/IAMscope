import type { ReactNode, JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface Breadcrumb {
  label: string;
  to?: string | undefined;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode | undefined;
  breadcrumbs?: readonly Breadcrumb[] | undefined;
  actions?: ReactNode | undefined;
  tabs?: ReactNode | undefined;
  className?: string | undefined;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  tabs,
  className,
}: PageHeaderProps): JSX.Element {
  return (
    <header className={cn('flex flex-col gap-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 ? (
        <nav aria-label="Breadcrumb">
          <ol className="text-meta flex items-center gap-1 text-text-subtle">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 ? (
                  <ChevronRight aria-hidden="true" className="size-3 text-text-subtle" />
                ) : null}
                {crumb.to === undefined ? (
                  <span className="text-text-muted">{crumb.label}</span>
                ) : (
                  <Link
                    to={crumb.to}
                    className="dur-fast rounded-input text-text-muted no-underline outline-none hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {crumb.label}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-20 font-semibold tracking-tight text-text">{title}</h1>
          {description ? (
            <p className="text-13 mt-1 max-w-prose text-text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>

      {tabs ? <div className="border-b border-border">{tabs}</div> : null}
    </header>
  );
}
