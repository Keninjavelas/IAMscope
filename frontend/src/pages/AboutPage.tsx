import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Database, GitCompareArrows, History, Share2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { ROUTES } from '@/lib/constants';

const IS = [
  'A workbench for answering “who can do what, and what changed?” against an IAM-shaped data model.',
  'Three lenses over one model: Impact (diffs), Graph (escalation paths), Timeline (historical reconstruction).',
  'A teaching tool: every decision shows the statements that matched, and every edit carries a reason.',
  'Auditable by construction - policies are versioned, mutations are logged, and nothing is hard-deleted silently.',
] as const;

const IS_NOT = [
  'Not an AWS account scanner. It reasons over the model you record, not live IAM state.',
  'Not an enforcement point. It will never block a request; it explains one.',
  'Not a generic graph explorer. The graph means one thing: privilege escalation.',
  'Not a chat product. No email delivery, no Slack, no bots - those are out of scope for v1.',
] as const;

const LENSES = [
  {
    icon: GitCompareArrows,
    title: 'Impact',
    to: ROUTES.impact,
    body: 'Run an evaluation before and after an edit, then diff the two runs decision by decision.',
  },
  {
    icon: Share2,
    title: 'Graph',
    to: ROUTES.graph,
    body: 'Walk assume-role, PassRole and attach-policy edges to find multi-hop escalation.',
  },
  {
    icon: History,
    title: 'Timeline',
    to: ROUTES.timeline,
    body: 'Reconstruct the whole model at any past minute and see what the scrubber changed.',
  },
] as const;

export default function AboutPage(): JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="About IAMScope"
        description="A local-first IAM reasoning workbench: one data model, three lenses, and an audit trail you can explain to an auditor."
        breadcrumbs={[{ label: 'Reference' }, { label: 'About' }]}
        actions={
          <Badge variant="accent" icon={ShieldCheck}>
            v1
          </Badge>
        }
      />

      <section className="grid gap-4 lg:grid-cols-3">
        {LENSES.map((lens) => (
          <article key={lens.title} className="panel flex flex-col gap-2 p-4">
            <span
              aria-hidden="true"
              className="flex size-8 items-center justify-center rounded-panel border border-border bg-bg-inset text-accent"
            >
              <lens.icon className="size-4" />
            </span>
            <h2 className="text-14 font-semibold text-text">{lens.title}</h2>
            <p className="text-13 text-text-muted">{lens.body}</p>
            <Link
              to={lens.to}
              className="text-13 dur-fast mt-auto w-fit rounded-input font-medium text-accent no-underline outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Open the {lens.title} lens →
            </Link>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="panel p-4">
          <h2 className="text-14 mb-2 font-semibold text-text">What IAMScope is</h2>
          <ul className="flex flex-col gap-2">
            {IS.map((line) => (
              <li key={line} className="text-13 flex gap-2 text-text-muted">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success"
                />
                {line}
              </li>
            ))}
          </ul>
        </article>

        <article className="panel p-4">
          <h2 className="text-14 mb-2 font-semibold text-text">What it is not</h2>
          <ul className="flex flex-col gap-2">
            {IS_NOT.map((line) => (
              <li key={line} className="text-13 flex gap-2 text-text-muted">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full bg-deny"
                />
                {line}
              </li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <BookOpen aria-hidden="true" className="size-4 text-text-muted" />
        <p className="text-13 text-text-muted">
          Want the internals? The architecture page walks the request path, and the data model page
          lists every collection and index.
        </p>
        <span className="ml-auto flex items-center gap-2">
          <Link
            to={ROUTES.architecture}
            className="text-13 dur-fast rounded-input font-medium text-accent no-underline outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            Architecture
          </Link>
          <span className="flex items-center gap-1">
            <Database aria-hidden="true" className="size-3.5 text-text-subtle" />
            <Link
              to={ROUTES.dataModel}
              className="text-13 dur-fast rounded-input font-medium text-accent no-underline outline-none hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Data model
            </Link>
          </span>
        </span>
      </section>
    </div>
  );
}
