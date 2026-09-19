import type { JSX } from 'react';
import { ArrowDown, Cpu, Database, Layers, Radio, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';

const REQUEST_PATH = [
  {
    step: 'Browser',
    detail:
      'React + Vite SPA. TanStack Query owns server state; Zustand owns UI preferences (theme, density, sidebar, palette).',
  },
  {
    step: 'API client',
    detail:
      'One typed client adds the CSRF header, unwraps the response envelope and normalises every failure into ApiError.',
  },
  {
    step: 'HTTP + cookies',
    detail:
      'Session cookie is httpOnly; a readable CSRF cookie is echoed back as a header on every unsafe verb (double-submit).',
  },
  {
    step: 'Express routes',
    detail:
      'Zod validates params, query and body before a handler runs, so handlers only see well-formed input.',
  },
  {
    step: 'Authorization',
    detail:
      'Every handler resolves the membership for the active org, then checks the role against the required minimum.',
  },
  {
    step: 'Domain services',
    detail:
      'Policy, principal, resource, scenario, evaluation, graph, timeline and audit services own the rules; routes stay thin.',
  },
  {
    step: 'MongoDB',
    detail:
      'Two databases split identity from domain data, so a tenant-scoped query never has to join across concerns.',
  },
] as const;

const STACK = [
  {
    layer: 'Frontend',
    items: ['React', 'TypeScript (strict)', 'Vite', 'Tailwind v4 + design tokens'],
  },
  {
    layer: 'Client state',
    items: ['TanStack Query', 'Zustand (UI only)', 'Radix primitives', 'cmdk palette'],
  },
  { layer: 'Editing', items: ['CodeMirror 6 (JSON + lint)', 'graphology (escalation graph)'] },
  {
    layer: 'Backend',
    items: ['Node + Express', 'Zod schemas (shared)', 'Service layer + audit log'],
  },
  {
    layer: 'Data',
    items: ['MongoDB (identity)', 'MongoDB (domain + analysis)', 'Server-sent events'],
  },
  { layer: 'Shared packages', items: ['@iamscope/types', '@iamscope/schemas', '@iamscope/tokens'] },
] as const;

const STREAMS = [
  {
    title: 'Server-sent events',
    body: 'One stream per session pushes change events. Each event names the collection it touched, and the client maps that to the query keys to invalidate - no polling.',
  },
  {
    title: 'Presence',
    body: 'A heartbeat every 20 seconds records where you are (route, entity, cursor). Entries decay on a TTL, so a closed tab disappears on its own.',
  },
  {
    title: 'Optimistic writes',
    body: 'Mutations snapshot the affected caches, write the optimistic value, and roll back on failure. Destructive actions offer an eight-second undo.',
  },
] as const;

export default function ArchitecturePage(): JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Architecture"
        description="How a click in the browser becomes an audited change in MongoDB, and back again."
        breadcrumbs={[{ label: 'Reference' }, { label: 'Architecture' }]}
        actions={
          <Badge variant="muted" icon={Layers}>
            Single-page · two databases
          </Badge>
        }
      />

      <section aria-labelledby="path-heading" className="flex flex-col gap-3">
        <h2 id="path-heading" className="text-16 font-semibold tracking-tight text-text">
          The request path
        </h2>
        <ol className="flex flex-col">
          {REQUEST_PATH.map((entry, index) => (
            <li key={entry.step} className="flex flex-col">
              <article className="panel flex items-start gap-3 p-3">
                <span
                  aria-hidden="true"
                  className="text-12 tabular flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-bg-inset text-text-muted"
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="text-13 font-medium text-text">{entry.step}</span>
                  <span className="text-meta text-text-muted">{entry.detail}</span>
                </span>
              </article>
              {index < REQUEST_PATH.length - 1 ? (
                <ArrowDown aria-hidden="true" className="mx-auto my-1 size-3.5 text-text-subtle" />
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="stack-heading" className="flex flex-col gap-3">
        <h2 id="stack-heading" className="text-16 font-semibold tracking-tight text-text">
          Stack
        </h2>
        <div className="panel overflow-hidden">
          <table className="w-full border-collapse text-13">
            <caption className="sr-only">Technology choices by layer</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
                  Layer
                </th>
                <th scope="col" className="px-3 py-2 text-left text-12 font-medium text-text-muted">
                  Choices
                </th>
              </tr>
            </thead>
            <tbody>
              {STACK.map((row) => (
                <tr key={row.layer} className="border-b border-border-subtle last:border-b-0">
                  <th
                    scope="row"
                    className="w-[160px] px-3 py-2 text-left align-top text-13 font-medium text-text"
                  >
                    {row.layer}
                  </th>
                  <td className="px-3 py-2 align-top">
                    <span className="flex flex-wrap gap-1">
                      {row.items.map((item) => (
                        <Badge key={item} variant="outline" hideIcon>
                          {item}
                        </Badge>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="live-heading" className="flex flex-col gap-3">
        <h2 id="live-heading" className="text-16 font-semibold tracking-tight text-text">
          Staying live
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {STREAMS.map((stream, index) => {
            const Icon = index === 0 ? Radio : index === 1 ? Cpu : ShieldCheck;
            return (
              <article key={stream.title} className="panel flex flex-col gap-2 p-4">
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-panel border border-border bg-bg-inset text-accent"
                >
                  <Icon className="size-3.5" />
                </span>
                <h3 className="text-13 font-semibold text-text">{stream.title}</h3>
                <p className="text-meta text-text-muted">{stream.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel flex items-start gap-3 p-4">
        <Database aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <p className="text-13 text-text-muted">
          Two databases: <span className="mono">iamscope_identity</span> holds users, sessions,
          organizations, memberships, invitations and API keys;{' '}
          <span className="mono">iamscope_data</span> holds the domain model and the analysis
          results derived from it. The split is deliberate - identity is read on almost every
          request and must never contend with evaluation writes.
        </p>
      </section>
    </div>
  );
}
