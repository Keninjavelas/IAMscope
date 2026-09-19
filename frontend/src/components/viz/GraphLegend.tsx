import { useState, type JSX } from 'react';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react';
import type { EscalationHop } from '@iamscope/types';
import { cn } from '@/lib/cn';

export interface GraphLegendProps {
  counts?: Partial<Record<'User' | 'Role' | 'Group', number>> | undefined;
  className?: string | undefined;
}

type NodeKind = 'User' | 'Role' | 'Group';

const NODE_ENTRIES: readonly { kind: NodeKind; label: string; color: string; meaning: string }[] = [
  {
    kind: 'User',
    label: 'User',
    color: 'var(--graph-node-user)',
    meaning: 'A human or service identity that carries policies.',
  },
  {
    kind: 'Role',
    label: 'Role',
    color: 'var(--graph-node-role)',
    meaning: 'An assumable identity - the usual target of an escalation.',
  },
  {
    kind: 'Group',
    label: 'Group',
    color: 'var(--graph-node-group)',
    meaning: 'A collection of users whose policies are inherited.',
  },
];

const EDGE_ENTRIES: readonly {
  kind: EscalationHop['via'];
  label: string;
  color: string;
  meaning: string;
}[] = [
  {
    kind: 'assume-role',
    label: 'sts:AssumeRole',
    color: 'var(--edge-assume-role)',
    meaning: 'The identity can become the target.',
  },
  {
    kind: 'pass-role',
    label: 'iam:PassRole',
    color: 'var(--edge-pass-role)',
    meaning: 'A role can be handed to a compute resource.',
  },
  {
    kind: 'group-membership',
    label: 'Group membership',
    color: 'var(--edge-group)',
    meaning: 'Policies flow from a group to its members.',
  },
  {
    kind: 'attach-policy',
    label: 'iam:Attach*Policy',
    color: 'var(--edge-attach)',
    meaning: 'The identity can grant itself more permissions.',
  },
  {
    kind: 'create-function',
    label: 'lambda:CreateFunction',
    color: 'var(--edge-attach)',
    meaning: 'A function can be created and then invoked.',
  },
  {
    kind: 'invoke-function',
    label: 'lambda:InvokeFunction',
    color: 'var(--edge-attach)',
    meaning: 'A function runs with its own role.',
  },
  {
    kind: 'run-instances',
    label: 'ec2:RunInstances',
    color: 'var(--edge-attach)',
    meaning: 'An instance runs with the passed role.',
  },
  {
    kind: 'create-policy-version',
    label: 'iam:CreatePolicyVersion',
    color: 'var(--edge-attach)',
    meaning: 'A policy can be rewritten in place.',
  },
  {
    kind: 'set-default-policy-version',
    label: 'iam:SetDefaultPolicyVersion',
    color: 'var(--edge-attach)',
    meaning: 'A rewritten version can be made live.',
  },
];

const SEVERITY_ENTRIES: readonly { label: string; ring: string; meaning: string }[] = [
  {
    label: 'High',
    ring: 'var(--severity-high)',
    meaning: '3+ hops - a broad identity is reachable.',
  },
  {
    label: 'Medium',
    ring: 'var(--severity-medium)',
    meaning: '2 hops - a second principal must cooperate.',
  },
  { label: 'Low', ring: 'var(--severity-low)', meaning: '1 hop from the starting principal.' },
];

function Swatch({ color, ring = false }: { color: string; ring?: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-3 shrink-0',
        ring ? 'rounded-full border-2 bg-transparent' : 'rounded-full',
      )}
      style={ring ? { borderColor: color } : { backgroundColor: color }}
    />
  );
}

function Line({ color }: { color: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-0.5 w-4 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * Graph legend (Plan §15.5). Colour never carries meaning on its own: every
 * swatch sits next to the noun it stands for and a one-line explanation, so the
 * legend doubles as the graph's documentation.
 */
export function GraphLegend({ counts, className }: GraphLegendProps): JSX.Element {
  const [open, setOpen] = useState(true);

  return (
    <section
      className={cn('overlay-surface absolute bottom-3 left-3 w-64 overflow-hidden', className)}
      aria-label="Graph legend"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls="graph-legend-body"
        onClick={() => setOpen((previous) => !previous)}
        className="dur-fast flex w-full items-center gap-2 px-2.5 py-1.5 text-left outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {open ? (
          <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        ) : (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        )}
        <Layers aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        <span className="text-12 font-medium text-text">Legend</span>
      </button>

      {open ? (
        <div
          id="graph-legend-body"
          className="max-h-[46vh] overflow-auto border-t border-border px-2.5 py-2"
        >
          <h3 className="text-micro mb-1 font-medium tracking-wide text-text-subtle uppercase">
            Nodes
          </h3>
          <ul className="mb-2 flex flex-col gap-1">
            {NODE_ENTRIES.map((entry) => (
              <li key={entry.kind} className="flex items-start gap-2">
                <span className="pt-1">
                  <Swatch color={entry.color} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-12 flex items-center gap-1.5 text-text">
                    {entry.label}
                    {counts?.[entry.kind] === undefined ? null : (
                      <span className="tabular text-micro text-text-subtle">
                        {counts[entry.kind]}
                      </span>
                    )}
                  </span>
                  <span className="text-micro block text-text-muted">{entry.meaning}</span>
                </span>
              </li>
            ))}
          </ul>

          <h3 className="text-micro mb-1 font-medium tracking-wide text-text-subtle uppercase">
            Edges · thickness = permission count
          </h3>
          <ul className="mb-2 flex flex-col gap-1">
            {EDGE_ENTRIES.map((entry) => (
              <li key={entry.kind} className="flex items-start gap-2">
                <span className="pt-1.5">
                  <Line color={entry.color} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono text-12 block truncate text-text">{entry.label}</span>
                  <span className="text-micro block text-text-muted">{entry.meaning}</span>
                </span>
              </li>
            ))}
          </ul>

          <h3 className="text-micro mb-1 font-medium tracking-wide text-text-subtle uppercase">
            Severity rings
          </h3>
          <ul className="flex flex-col gap-1">
            {SEVERITY_ENTRIES.map((entry) => (
              <li key={entry.label} className="flex items-start gap-2">
                <span className="pt-1">
                  <Swatch color={entry.ring} ring />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="text-12 block text-text">{entry.label}</span>
                  <span className="text-micro block text-text-muted">{entry.meaning}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
