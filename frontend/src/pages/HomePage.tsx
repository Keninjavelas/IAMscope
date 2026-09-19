import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  FileCode2,
  FlaskConical,
  GitCompareArrows,
  History,
  Plus,
  Share2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { PageHeader } from '@/components/ui/PageHeader';
import { usePresenceRoster } from '@/features/presence';
import { ROUTES } from '@/lib/constants';
import { useActiveOrg, useActiveOrgId, useCurrentUser } from '@/stores/session';
import { formatCount } from '@/lib/format';
import { usePolicies } from '@/api/queries/policies';
import { usePrincipals } from '@/api/queries/principals';
import { useScenarios } from '@/api/queries/scenarios';

const LENSES = [
  {
    icon: Activity,
    title: 'Evaluate',
    to: ROUTES.evaluate,
    shortcut: 'g e',
    body: 'Ask a single question and read the trace: which statements matched, which were skipped, and why the verdict went the way it did.',
  },
  {
    icon: GitCompareArrows,
    title: 'Impact',
    to: ROUTES.impact,
    shortcut: 'g i',
    body: 'Diff two evaluation runs to see exactly which decisions flipped, and which statement caused each flip.',
  },
  {
    icon: Share2,
    title: 'Graph',
    to: ROUTES.graph,
    shortcut: 'g g',
    body: 'Walk assume-role, PassRole and policy-attachment edges to find the shortest path to a broader identity.',
  },
  {
    icon: History,
    title: 'Timeline',
    to: ROUTES.timeline,
    shortcut: 'g t',
    body: 'Scrub through history and reconstruct the whole model at any past minute, with a live diff of what changed.',
  },
] as const;

const WORKBENCH = [
  { icon: FileCode2, label: 'Policies', to: ROUTES.policies, body: 'Versioned statements' },
  { icon: Users, label: 'Principals', to: ROUTES.principals, body: 'Users, roles, groups' },
  { icon: FlaskConical, label: 'Scenarios', to: ROUTES.scenarios, body: 'Saved access questions' },
] as const;

const STEPS = [
  {
    title: 'Record the model',
    body: 'Add the policies, principals and resources you care about. Everything is scoped to one organization.',
  },
  {
    title: 'Write down the questions',
    body: 'A scenario is a principal, an action, a resource and the answer you expect. Drift shows up instantly.',
  },
  {
    title: 'Read the decision, not just the verdict',
    body: 'Every evaluation returns the statements that matched, so an Allow can be explained rather than guessed at.',
  },
] as const;

export default function HomePage(): JSX.Element {
  const user = useCurrentUser();
  const activeOrg = useActiveOrg();
  const orgId = useActiveOrgId();
  const roster = usePresenceRoster();

  const policies = usePolicies(orgId, { pageSize: 1 });
  const principals = usePrincipals(orgId, { pageSize: 1 });
  const scenarios = useScenarios(orgId, { pageSize: 1 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          user ? (
            <span>Welcome back{user.name ? `, ${user.name.split(' ')[0] ?? user.name}` : ''}</span>
          ) : (
            'IAMScope'
          )
        }
        description={
          activeOrg
            ? `You are working in ${activeOrg.name}. One data model, three lenses, and an audit trail behind every edit.`
            : 'A local-first IAM reasoning workbench: model your permissions once, then examine them through three lenses.'
        }
        actions={
          activeOrg ? (
            <>
              <Button variant="secondary" size="sm" iconLeft={Plus} asChild>
                <Link to={`${ROUTES.policies}?new=policy`}>New policy</Link>
              </Button>
              <Button variant="primary" size="sm" iconLeft={Activity} asChild>
                <Link to={ROUTES.evaluate}>Run an evaluation</Link>
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" asChild>
                <Link to={ROUTES.signup}>Create an account</Link>
              </Button>
              <Button variant="primary" size="sm" iconLeft={ShieldCheck} asChild>
                <Link to={ROUTES.login}>Sign in</Link>
              </Button>
            </>
          )
        }
      />

      {activeOrg ? (
        <section aria-label="Organization at a glance" className="grid gap-3 sm:grid-cols-3">
          <article className="panel flex items-center gap-3 p-3">
            <FileCode2 aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-col">
              <span className="text-20 tabular font-semibold text-text">
                {formatCount(policies.data?.total ?? 0)}
              </span>
              <span className="text-micro text-text-muted">policies</span>
            </span>
          </article>
          <article className="panel flex items-center gap-3 p-3">
            <Users aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-col">
              <span className="text-20 tabular font-semibold text-text">
                {formatCount(principals.data?.total ?? 0)}
              </span>
              <span className="text-micro text-text-muted">principals</span>
            </span>
          </article>
          <article className="panel flex items-center gap-3 p-3">
            <FlaskConical aria-hidden="true" className="size-4 shrink-0 text-accent" />
            <span className="flex min-w-0 flex-col">
              <span className="text-20 tabular font-semibold text-text">
                {formatCount(scenarios.data?.total ?? 0)}
              </span>
              <span className="text-micro text-text-muted">scenarios</span>
            </span>
          </article>
        </section>
      ) : null}

      {roster.entries.length > 1 ? (
        <p className="text-micro text-text-subtle" role="status">
          {roster.entries.length} people are connected to this organization right now.
        </p>
      ) : null}

      <section aria-labelledby="lenses-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <h2 id="lenses-heading" className="text-16 font-semibold tracking-tight text-text">
            The three lenses
          </h2>
          <span className="text-micro text-text-subtle">
            each one reads the same model, from a different angle
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {LENSES.map((lens) => (
            <article key={lens.title} className="panel flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-panel border border-border bg-bg-inset text-accent"
                >
                  <lens.icon className="size-3.5" />
                </span>
                <h3 className="text-14 font-semibold text-text">{lens.title}</h3>
                <Badge variant="muted" hideIcon className="ml-auto">
                  {lens.shortcut}
                </Badge>
              </div>
              <p className="text-13 text-text-muted">{lens.body}</p>
              <Link
                to={lens.to}
                className="text-13 dur-fast mt-auto inline-flex w-fit items-center gap-1 rounded-input font-medium text-accent no-underline outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Open {lens.title}
                <ArrowRight aria-hidden="true" className="size-3.5" />
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="workbench-heading" className="grid gap-4 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-3">
          <h2 id="workbench-heading" className="text-16 font-semibold tracking-tight text-text">
            Start in the workbench
          </h2>
          <ul className="flex flex-col gap-2">
            {WORKBENCH.map((entry) => (
              <li key={entry.label}>
                <Link
                  to={entry.to}
                  className="panel dur-fast flex items-center gap-3 p-3 no-underline outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <entry.icon aria-hidden="true" className="size-4 shrink-0 text-accent" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-13 font-medium text-text">{entry.label}</span>
                    <span className="text-micro text-text-muted">{entry.body}</span>
                  </span>
                  <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
                </Link>
              </li>
            ))}
          </ul>

          {activeOrg ? (
            <p className="text-micro flex items-center gap-1.5 text-text-subtle">
              Tip: press <Kbd keys="mod+k" /> anywhere to jump straight to an entity or action.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-16 font-semibold tracking-tight text-text">How it works</h2>
          <ol className="flex flex-col gap-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="text-12 tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-inset text-text-muted"
                >
                  {index + 1}
                </span>
                <span className="flex flex-col">
                  <span className="text-13 font-medium text-text">{step.title}</span>
                  <span className="text-meta text-text-muted">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="panel flex flex-wrap items-center gap-2 p-4">
        <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
        <p className="text-13 text-text-muted">
          Policies are versioned, mutations carry a change reason, and nothing is deleted silently.
        </p>
        <span className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to={ROUTES.architecture}>Architecture</Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={ROUTES.dataModel}>Data model</Link>
          </Button>
        </span>
      </section>
    </div>
  );
}
