import { useCallback, useMemo, useRef, useState, type JSX } from 'react';
import { Maximize2, RefreshCw, RotateCcw, Share2, Users } from 'lucide-react';
import { useEscalationGraph, usePrincipals } from '@/api/queries';
import { useComputeEscalation } from '@/api/mutations';
import { GraphLegend } from '@/components/viz/GraphLegend';
import { GraphMinimap, graphBounds, normalizedToGraph } from '@/components/viz/GraphMinimap';
import {
  EscalationGraph,
  type EscalationGraphHandle,
  type GraphCursor,
} from '@/components/viz/EscalationGraph';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Kbd } from '@/components/ui/Kbd';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { useKeyboard } from '@/hooks/useKeyboard';
import { usePresence } from '@/hooks/usePresence';
import { useActiveOrgId, useSessionReady } from '@/stores/session';
import { PathList } from './components/PathList';

interface LayoutNode {
  id: string;
  x: number;
  y: number;
}

const DEPTH_OPTIONS = [1, 2, 3, 4, 5].map((depth) => ({
  value: String(depth),
  label: `${depth} hop${depth === 1 ? '' : 's'}`,
}));

const INITIAL_CAMERA = { x: 0, y: 0, ratio: 1, width: 1, height: 1 };

/**
 * The Graph lens (Plan §11, §15.5).
 *
 * sigma renders the escalation map, the minimap gives an overview, and the paths
 * list is the accessible entry point. Live cursors come straight from presence so
 * two people investigating the same organization can see where the other is
 * pointing - publishing a cursor never triggers a layout recompute.
 */
export default function GraphPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const ready = useSessionReady();

  const [fromArn, setFromArn] = useState<string | null>(null);
  const [maxDepth, setMaxDepth] = useState(3);
  const [highlightPathId, setHighlightPathId] = useState<string | null>(null);
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  const [camera, setCamera] = useState(INITIAL_CAMERA);

  const graphRef = useRef<EscalationGraphHandle | null>(null);

  const payload = useEscalationGraph(orgId, fromArn, { enabled: ready });
  const principals = usePrincipals(orgId, { pageSize: 200 }, { enabled: ready });
  const compute = useComputeEscalation();
  const presence = usePresence({ entityType: 'graph', entityId: null });

  const request = useCallback(
    () => ({ ...(fromArn === null ? {} : { fromPrincipalArn: fromArn }), maxDepth }),
    [fromArn, maxDepth],
  );

  /* ---- Keyboard: F zoom-to-fit, R reset (Plan §15.4) ---------------- */

  useKeyboard(
    useMemo(
      () => [
        {
          id: 'graph-zoom-to-fit',
          keys: 'f',
          description: 'Zoom to fit',
          group: 'Graph' as const,
          handler: () => graphRef.current?.zoomToFit(),
        },
        {
          id: 'graph-reset',
          keys: 'r',
          description: 'Reset the graph view',
          group: 'Graph' as const,
          handler: () => {
            setHighlightPathId(null);
            graphRef.current?.reset();
          },
        },
      ],
      [],
    ),
    { enabled: ready },
  );

  const principalOptions = useMemo(
    () => [
      { value: '', label: 'Every principal' },
      ...(principals.data?.items ?? []).map((principal) => ({
        value: principal.arn,
        label: `${principal.name} · ${principal.type}`,
      })),
    ],
    [principals.data],
  );

  const counts = useMemo(() => {
    const tally: Record<'User' | 'Role' | 'Group', number> = { User: 0, Role: 0, Group: 0 };
    for (const node of payload.data?.nodes ?? []) {
      if (node.type === 'User' || node.type === 'Role' || node.type === 'Group')
        tally[node.type] += 1;
    }
    return tally;
  }, [payload.data]);

  /** Presence cursors are already graph-space, so they pass straight through. */
  const cursors = useMemo<GraphCursor[]>(
    () =>
      presence.others
        .filter((entry) => entry.location.entityType === 'graph')
        .map((entry) => ({
          id: entry.userId,
          name: entry.user.name,
          color: entry.color,
          cursor: entry.cursor,
        })),
    [presence.others],
  );

  const nodeCount = payload.data?.nodes.length ?? 0;
  const isEmpty = nodeCount === 0;

  /** A minimap click navigates to the nearest laid-out node. */
  const navigateFromMinimap = useCallback(
    (nx: number, ny: number) => {
      if (layoutNodes.length === 0) return;
      const point = normalizedToGraph(graphBounds(layoutNodes), nx, ny);
      let best: LayoutNode | null = null;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const node of layoutNodes) {
        const distance = (node.x - point.x) ** 2 + (node.y - point.y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      if (best !== null) graphRef.current?.focusNode(best.id);
    },
    [layoutNodes],
  );

  const handlePointerMove = useCallback(
    (point: { x: number; y: number } | null) => {
      presence.publishCursor(point);
    },
    [presence],
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <PageHeader
        title="Graph"
        description="Every multi-hop privilege escalation path in the organization: who can assume, pass or attach their way into a broader identity."
        actions={
          <span className="text-micro flex items-center gap-2 text-text-subtle">
            {presence.others.length === 0 ? null : (
              <Badge variant="accent" size="sm">
                <Users aria-hidden="true" className="size-3" />
                {presence.others.length} viewing
              </Badge>
            )}
            <span className="flex items-center gap-1">
              <Kbd keys="f" /> fit
            </span>
            <span className="flex items-center gap-1">
              <Kbd keys="r" /> reset
            </span>
          </span>
        }
      />

      <Toolbar label="Graph controls">
        <div className="w-72">
          <Select
            value={fromArn ?? ''}
            onValueChange={(value) => {
              setFromArn(value === '' ? null : value);
              setHighlightPathId(null);
            }}
            options={principalOptions}
            placeholder="Every principal"
            ariaLabel="Filter by starting principal"
            size="sm"
          />
        </div>

        <div className="w-32">
          <Select
            value={String(maxDepth)}
            onValueChange={(value) => setMaxDepth(Number(value))}
            options={DEPTH_OPTIONS}
            ariaLabel="Maximum traversal depth"
            size="sm"
          />
        </div>

        <Button
          variant="primary"
          size="sm"
          iconLeft={RefreshCw}
          loading={compute.isPending}
          onClick={() => compute.mutate(request())}
        >
          Compute paths
        </Button>

        <ToolbarSpacer>
          {payload.data === undefined ? null : (
            <span className="text-micro truncate text-text-subtle" title={payload.data.computedAt}>
              {nodeCount} nodes · {payload.data.edges.length} edges · {payload.data.paths.length}{' '}
              paths
              {payload.data.truncated ? ' · truncated' : ''}
            </span>
          )}
          <IconButton
            label="Zoom to fit (f)"
            icon={Maximize2}
            size="sm"
            onClick={() => graphRef.current?.zoomToFit()}
          />
          <IconButton
            label="Reset the view (r)"
            icon={RotateCcw}
            size="sm"
            onClick={() => {
              setHighlightPathId(null);
              graphRef.current?.reset();
            }}
          />
        </ToolbarSpacer>
      </Toolbar>

      {compute.isError ? (
        <ErrorState error={compute.error} compact title="Could not compute escalation paths" />
      ) : null}

      {payload.isError ? (
        <ErrorState
          error={payload.error}
          title="Could not load escalation paths"
          onRetry={() => void payload.refetch()}
        />
      ) : isEmpty && payload.isLoading ? null : isEmpty ? (
        <section className="panel">
          <EmptyState
            icon={Share2}
            title="No escalation paths found"
            description="Nothing has been computed for this organization yet, or every principal is properly constrained. Run a traversal to find out - it walks the whole graph and caches the result."
            action={
              <Button
                variant="primary"
                size="md"
                iconLeft={RefreshCw}
                loading={compute.isPending}
                onClick={() => compute.mutate(request())}
              >
                Compute escalation paths
              </Button>
            }
          />
        </section>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative min-h-[60vh]">
            <EscalationGraph
              ref={graphRef}
              graph={payload.data ?? null}
              loading={payload.isLoading}
              highlightPathId={highlightPathId}
              cursors={cursors}
              onCompute={() => compute.mutate(request())}
              computing={compute.isPending}
              onCameraChange={setCamera}
              onLayoutChange={setLayoutNodes}
              onPointerMove={handlePointerMove}
              onNodeSelect={(node) => {
                if (node === null) setHighlightPathId(null);
              }}
              className="h-full"
            />

            <GraphMinimap nodes={layoutNodes} camera={camera} onNavigate={navigateFromMinimap} />
            <GraphLegend counts={counts} />
          </div>

          <PathList
            paths={payload.data?.paths ?? []}
            selectedPathId={highlightPathId}
            onSelect={setHighlightPathId}
            className="max-h-[70vh] xl:max-h-none"
          />
        </div>
      )}
    </div>
  );
}
