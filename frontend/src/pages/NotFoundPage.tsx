import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Compass, Search } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { ROUTES, NAV_GROUPS } from '@/lib/constants';

export default function NotFoundPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Page not found"
        description="That route does not exist in this build."
        breadcrumbs={[{ label: 'Home', to: ROUTES.home }, { label: 'Not found' }]}
      />

      <div className="panel">
        <EmptyState
          icon={Compass}
          title="Nothing lives at this address"
          description="Check the URL, or jump straight to one of the workbench pages below. Ctrl/⌘ K opens the command palette from anywhere."
          action={
            <>
              <Button variant="primary" size="sm" asChild>
                <Link to={ROUTES.home}>Back to Home</Link>
              </Button>
              <Button variant="secondary" size="sm" iconLeft={Search} asChild>
                <Link to={ROUTES.policies}>Go to Policies</Link>
              </Button>
            </>
          }
        />
      </div>

      <nav aria-label="All destinations" className="grid gap-3 sm:grid-cols-3">
        {NAV_GROUPS.map((group) => (
          <section key={group.id} className="panel p-3">
            <h2 className="text-12 mb-2 font-semibold tracking-wide text-text-subtle uppercase">
              {group.label}
            </h2>
            <ul className="flex flex-col gap-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="text-13 dur-fast flex items-center gap-2 rounded-input px-1.5 py-1 text-text-muted no-underline outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <item.icon aria-hidden="true" className="size-3.5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </div>
  );
}
