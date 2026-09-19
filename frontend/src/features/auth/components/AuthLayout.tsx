import type { ReactNode, JSX } from 'react';
import { Link } from 'react-router-dom';
import { GitCompareArrows, History, Share2, ShieldCheck } from 'lucide-react';
import { ROUTES } from '@/lib/constants';
import { ThemeToggle } from '@/components/app/ThemeToggle';

const LENSES = [
  {
    icon: GitCompareArrows,
    title: 'Impact',
    body: 'Diff two evaluation runs and see exactly which decisions flipped.',
  },
  {
    icon: Share2,
    title: 'Graph',
    body: 'Find multi-hop privilege escalation paths before an attacker does.',
  },
  {
    icon: History,
    title: 'Timeline',
    body: 'Reconstruct the state of every policy at any past minute.',
  },
] as const;

export interface AuthLayoutProps {
  children: ReactNode;
}

/**
 * Two-column shell for the auth pages: product context on the left, the form on
 * the right. Collapses to a single column under `lg`.
 */
export function AuthLayout({ children }: AuthLayoutProps): JSX.Element {
  return (
    <div className="flex min-h-full flex-col bg-bg lg:flex-row">
      <aside className="flex flex-col justify-between gap-6 border-b border-border bg-bg-raised px-6 py-6 lg:w-[46%] lg:border-r lg:border-b-0 lg:px-10 lg:py-10">
        <Link
          to={ROUTES.home}
          className="dur-fast inline-flex w-fit items-center gap-2 rounded-input no-underline outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ShieldCheck aria-hidden="true" className="size-5 text-accent" />
          <span className="text-16 font-semibold tracking-tight text-text">IAMScope</span>
        </Link>

        <div className="flex flex-col gap-4">
          <h2 className="text-28 max-w-[22ch] font-semibold tracking-tight text-text">
            Three lenses over one IAM data model.
          </h2>
          <ul className="flex flex-col gap-3">
            {LENSES.map((lens) => (
              <li key={lens.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-panel border border-border bg-bg-inset text-accent"
                >
                  <lens.icon className="size-3.5" />
                </span>
                <span className="flex flex-col">
                  <span className="text-13 font-medium text-text">{lens.title}</span>
                  <span className="text-meta text-text-muted">{lens.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-micro text-text-subtle">
          Local-first. MongoDB only. Every change audited, every edit versioned.
        </p>
      </aside>

      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-8">
        <div className="flex w-full max-w-[420px] justify-end">
          <ThemeToggle />
        </div>
        {children}
        <nav aria-label="Legal" className="text-micro flex items-center gap-3 text-text-subtle">
          <Link to={ROUTES.about} className="no-underline hover:text-text">
            About
          </Link>
          <Link to={ROUTES.architecture} className="no-underline hover:text-text">
            Architecture
          </Link>
          <Link to={ROUTES.dataModel} className="no-underline hover:text-text">
            Data model
          </Link>
        </nav>
      </main>
    </div>
  );
}
