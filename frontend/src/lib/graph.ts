/**
 * Graph lens helpers (Plan §6 `lib/graph.ts`, §15.5).
 *
 * Two responsibilities:
 *  1. turn escalation paths into the node/edge payload the renderer draws, and
 *  2. own the graphology instance + deterministic layout seed so a reload never
 *     reshuffles the map under the user.
 */
// `graphology` exports the plain `Graph` class as its default plus the specialised
// subclasses as named exports; both forms are used in this module.
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type {
  EscalationGraphPayload,
  EscalationHop,
  EscalationPath,
  EscalationSeverity,
  GraphEdge,
  GraphNode,
} from '@iamscope/types';
import { GRAPH } from '@iamscope/tokens';
import { arnName } from './format';

/* ------------------------------------------------------------------ */
/* Severity + edge semantics                                          */
/* ------------------------------------------------------------------ */

export const SEVERITY_ORDER: readonly EscalationSeverity[] = ['low', 'medium', 'high'];

export function severityRank(severity: EscalationSeverity): number {
  const index = SEVERITY_ORDER.indexOf(severity);
  return index === -1 ? 0 : index;
}

/** 1 hop -> low, 2 hops -> medium, 3+ hops -> high (Plan §11.3). */
export function severityForHops(hops: number): EscalationSeverity {
  if (hops <= 1) return 'low';
  if (hops === 2) return 'medium';
  return 'high';
}

export function worstSeverity(
  a: EscalationSeverity | null,
  b: EscalationSeverity | null,
): EscalationSeverity | null {
  if (a === null) return b;
  if (b === null) return a;
  return severityRank(a) >= severityRank(b) ? a : b;
}

export function severityLabel(severity: EscalationSeverity): string {
  if (severity === 'high') return 'High';
  if (severity === 'medium') return 'Medium';
  return 'Low';
}

export interface SeverityPresentation {
  label: string;
  description: string;
  textClass: string;
  bgClass: string;
  borderClass: string;
  dot: string;
}

export const SEVERITY_PRESENTATION: Record<EscalationSeverity, SeverityPresentation> = {
  low: {
    label: 'Low',
    description: 'Single hop from the starting principal.',
    textClass: 'text-severity-low',
    bgClass: 'bg-bg-inset',
    borderClass: 'border-border',
    dot: 'bg-severity-low',
  },
  medium: {
    label: 'Medium',
    description: 'Two hops - a second principal has to cooperate.',
    textClass: 'text-severity-medium',
    bgClass: 'bg-warn-subtle',
    borderClass: 'border-warn',
    dot: 'bg-severity-medium',
  },
  high: {
    label: 'High',
    description: 'Three or more hops reaching a broader identity.',
    textClass: 'text-severity-high',
    bgClass: 'bg-danger-subtle',
    borderClass: 'border-danger',
    dot: 'bg-severity-high',
  },
};

export function severityPresentation(severity: EscalationSeverity): SeverityPresentation {
  return SEVERITY_PRESENTATION[severity];
}

export const EDGE_KIND_LABELS: Record<EscalationHop['via'], string> = {
  'assume-role': 'sts:AssumeRole',
  'pass-role': 'iam:PassRole',
  'attach-policy': 'iam:Attach*Policy',
  'create-function': 'lambda:CreateFunction',
  'invoke-function': 'lambda:InvokeFunction',
  'run-instances': 'ec2:RunInstances',
  'create-policy-version': 'iam:CreatePolicyVersion',
  'set-default-policy-version': 'iam:SetDefaultPolicyVersion',
  'group-membership': 'group membership',
};

/** Edge colour tokens (Plan §15.5: assume-role accent, pass-role warn, attach muted). */
export function edgeKindColorVar(kind: EscalationHop['via']): string {
  switch (kind) {
    case 'assume-role':
      return 'var(--edge-assume-role)';
    case 'pass-role':
      return 'var(--edge-pass-role)';
    case 'group-membership':
      return 'var(--edge-group)';
    default:
      return 'var(--edge-attach)';
  }
}

export function edgeKindLabel(kind: EscalationHop['via']): string {
  return EDGE_KIND_LABELS[kind];
}

export function nodeColorVar(type: string): string {
  const normalised = type.toLowerCase();
  if (normalised.includes('role')) return 'var(--graph-node-role)';
  if (normalised.includes('group')) return 'var(--graph-node-group)';
  return 'var(--graph-node-user)';
}

/** Guess the principal kind from an ARN - used when metadata is missing. */
export function principalTypeFromArn(arn: string): string {
  if (arn.includes(':role/')) return 'Role';
  if (arn.includes(':group/')) return 'Group';
  if (arn.includes(':user/')) return 'User';
  return 'Resource';
}

/* ------------------------------------------------------------------ */
/* Payload builder                                                    */
/* ------------------------------------------------------------------ */

function upsertNode(
  nodes: Map<string, GraphNode>,
  arn: string,
  name: string,
  severity: EscalationSeverity | null,
  hopDepth: number,
): void {
  const existing = nodes.get(arn);
  if (existing) {
    existing.severity = worstSeverity(existing.severity, severity);
    existing.hopDepth = Math.min(existing.hopDepth, hopDepth);
    return;
  }
  nodes.set(arn, {
    id: arn,
    arn,
    name: name === '' ? arnName(arn) : name,
    type: principalTypeFromArn(arn),
    severity,
    hopDepth,
    tags: {},
  });
}

function edgeKey(
  source: string,
  target: string,
  kind: EscalationHop['via'],
  index: number,
): string {
  return `${source}->${target}:${kind}:${index}`;
}

/**
 * Derive the renderable graph from cached escalation paths. Deterministic: the
 * same paths always produce the same node ids, edge ids and ordering.
 */
export function buildEscalationGraph(paths: readonly EscalationPath[]): EscalationGraphPayload {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  let computedAt = '';

  for (const path of paths) {
    if (path.computedAt > computedAt) computedAt = path.computedAt;

    upsertNode(nodes, path.fromPrincipalArn, path.fromPrincipalName, path.severity, 0);

    let source = path.fromPrincipalArn;
    path.hops.forEach((hop, index) => {
      upsertNode(nodes, hop.target, hop.targetName, path.severity, index + 1);
      const key = edgeKey(source, hop.target, hop.via, index);
      const existing = edges.get(key);
      if (existing) {
        existing.weight += 1;
        existing.onEscalationPath = true;
      } else {
        edges.set(key, {
          id: key,
          source,
          target: hop.target,
          kind: hop.via,
          weight: 1,
          label: hop.policyName ?? edgeKindLabel(hop.via),
          onEscalationPath: true,
        });
      }
      source = hop.target;
    });

    upsertNode(nodes, path.toPrincipalArn, path.toPrincipalName, path.severity, path.hops.length);
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges.values()].sort((a, b) => a.id.localeCompare(b.id)),
    paths: [...paths],
    computedAt: computedAt === '' ? new Date().toISOString() : computedAt,
    truncated: false,
  };
}

/* ------------------------------------------------------------------ */
/* graphology                                                         */
/* ------------------------------------------------------------------ */

/**
 * Build a directed multigraph. Node ids are ARNs (stable across reloads) so the
 * layout stays put; attributes carry everything the renderer needs to style.
 */
export function createEscalationGraph(payload: EscalationGraphPayload): Graph {
  // `graphology`'s default export is the `Graph` class; the multi/directed flags
  // are constructor options (the named `MultiDirectedGraph` export is not part of
  // the type surface, so this is the portable form).
  const graph = new Graph({ multi: true, type: 'directed' });

  const ordered = [...payload.nodes].sort((a, b) => a.id.localeCompare(b.id));
  ordered.forEach((node, index) => {
    const angle = (index / Math.max(1, ordered.length)) * Math.PI * 2;
    graph.addNode(node.id, {
      label: node.name,
      arn: node.arn,
      type: node.type,
      severity: node.severity,
      hopDepth: node.hopDepth,
      color: nodeColorVar(node.type),
      // Deterministic seed: a circle. ForceAtlas2 then relaxes it.
      x: Math.cos(angle),
      y: Math.sin(angle),
      size: 6 + Math.min(node.hopDepth, 4),
    });
  });

  for (const edge of payload.edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
    if (graph.hasEdge(edge.id)) continue;
    graph.addDirectedEdgeWithKey(edge.id, edge.source, edge.target, {
      label: edge.label,
      kind: edge.kind,
      weight: edge.weight,
      size: 1 + Math.log2(1 + edge.weight),
      color: edgeKindColorVar(edge.kind),
      onEscalationPath: edge.onEscalationPath,
    });
  }

  return graph;
}

/**
 * Relax the seeded layout. `iterations` is small on purpose - the graph must not
 * jitter when it mounts, and reduced-motion users never see the process.
 */
export function runForceLayout(graph: Graph, iterations = 120): void {
  if (graph.order === 0) return;
  try {
    forceAtlas2.assign(graph, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        adjustSizes: true,
        barnesHutOptimize: graph.order > 200,
        scalingRatio: 12,
      },
    });
  } catch {
    // A layout failure must never blank the lens; the seeded circle is valid.
  }
}

/** Neighbourhood within `depth` hops - used for focus + context dimming. */
export function neighbourhood(
  payload: EscalationGraphPayload,
  rootId: string,
  depth = GRAPH.focusDepth,
): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const edge of payload.edges) {
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    adjacency.set(edge.target, [...(adjacency.get(edge.target) ?? []), edge.source]);
  }

  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  for (let hop = 0; hop < depth; hop += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}

export function pathSignature(path: EscalationPath): string {
  return `${path.fromPrincipalArn}>${path.hops.map((hop) => hop.via).join('|')}>${path.toPrincipalArn}`;
}

/* ------------------------------------------------------------------ */
/* Deterministic seeding + semantic-zoom helpers (Plan §15.5)          */
/* ------------------------------------------------------------------ */

/**
 * FNV-1a over a string, normalised to `[0, 1)`. Stable across reloads and
 * platforms - unlike `Math.random()`, which would reshuffle the map on every
 * visit and destroy the user's spatial memory of the graph.
 */
export function unitHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 makes it unsigned before scaling into the unit interval.
  return (hash >>> 0) / 4_294_967_296;
}

export interface SeedPosition {
  x: number;
  y: number;
}

/**
 * Radial seed derived from the node id alone: a golden-angle spiral, jittered by
 * the id's hash so co-hashed ids never land on top of each other. ForceAtlas2
 * relaxes from here, so the *starting point* decides the final layout - which is
 * exactly why it must be a pure function of the data.
 */
export function seedPosition(nodeId: string, index: number, total: number): SeedPosition {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const angle = index * golden + unitHash(nodeId) * Math.PI * 2;
  const band = total <= 1 ? 0 : Math.sqrt((index + 0.5) / total);
  const radius = 0.25 + band * 0.75;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

/**
 * The slice of the graphology surface the seeding helper needs. Structural on
 * purpose: this module builds the instance, and typing the helper structurally
 * keeps it correct whichever graphology class the builder returns.
 */
export interface SeededGraphLike {
  nodes(): string[];
  setNodeAttribute(node: string, attribute: string, value: unknown): unknown;
}

/**
 * Overwrite every node's `x`/`y` with its deterministic seed. Called before the
 * layout assign so the same payload always produces the same picture.
 */
export function seedPositionsDeterministically(graph: SeededGraphLike): void {
  const ordered = graph.nodes().sort((a, b) => a.localeCompare(b));
  const total = ordered.length;
  ordered.forEach((node, index) => {
    const position = seedPosition(node, index, total);
    graph.setNodeAttribute(node, 'x', position.x);
    graph.setNodeAttribute(node, 'y', position.y);
    graph.setNodeAttribute(node, 'seedX', position.x);
    graph.setNodeAttribute(node, 'seedY', position.y);
  });
}

/** `GRAPH.semanticZoomClusterThreshold` -> `label` -> `full ARN` (Plan §15.5). */
export type GraphZoomTier = 'cluster' | 'label' | 'detail';

export function zoomTier(ratio: number): GraphZoomTier {
  if (ratio < GRAPH.semanticZoomClusterThreshold) return 'cluster';
  if (ratio < GRAPH.semanticZoomLabelThreshold) return 'label';
  return 'detail';
}

export const ZOOM_TIER_LABELS: Record<GraphZoomTier, string> = {
  cluster: 'Clusters',
  label: 'Names',
  detail: 'ARNs + edges',
};

/** Severity ring colour for a node on an escalation path (Plan §15.5). */
export function severityRingColorVar(severity: EscalationSeverity | null): string | null {
  if (severity === null) return null;
  if (severity === 'high') return 'var(--severity-high)';
  if (severity === 'medium') return 'var(--severity-medium)';
  return 'var(--severity-low)';
}

const EDGE_KIND_SHORT_LABELS: Record<EscalationHop['via'], string> = {
  'assume-role': 'AssumeRole',
  'pass-role': 'PassRole',
  'attach-policy': 'Attach',
  'create-function': 'CreateFn',
  'invoke-function': 'InvokeFn',
  'run-instances': 'RunInstances',
  'create-policy-version': 'CreateVersion',
  'set-default-policy-version': 'SetDefault',
  'group-membership': 'Member',
};

export function edgeKindShortLabel(kind: EscalationHop['via']): string {
  return EDGE_KIND_SHORT_LABELS[kind];
}

/** Node degree - drives node size (Plan §15.5: "size by degree"). */
export function degreesByNode(payload: EscalationGraphPayload): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const node of payload.nodes) degrees.set(node.id, 0);
  for (const edge of payload.edges) {
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1);
  }
  return degrees;
}

/** Node ids in hop order along an escalation path, starting at the source. */
export function pathNodeSequence(path: EscalationPath): string[] {
  const sequence: string[] = [path.fromPrincipalArn];
  let current = path.fromPrincipalArn;
  for (const hop of path.hops) {
    if (hop.target !== current) sequence.push(hop.target);
    current = hop.target;
  }
  if (sequence[sequence.length - 1] !== path.toPrincipalArn) sequence.push(path.toPrincipalArn);
  return sequence;
}

/**
 * Edge ids (in hop order) that belong to a path. Edge ids in the payload are
 * `${source}->${target}:${kind}:${index}`; the index is an artefact of how the
 * payload was built, so matching is done on the semantic triple instead.
 */
export function pathEdgeIds(payload: EscalationGraphPayload, path: EscalationPath): string[] {
  const ids: string[] = [];
  let source = path.fromPrincipalArn;
  for (const hop of path.hops) {
    const match = payload.edges.find(
      (edge) => edge.source === source && edge.target === hop.target && edge.kind === hop.via,
    );
    if (match) ids.push(match.id);
    source = hop.target;
  }
  return ids;
}

/**
 * Cluster representatives for the zoomed-out tier: one node per principal type,
 * with the cluster size carried in `GRAPH_CLUSTER_SIZES`. Nothing is added to
 * the layout - the reducer simply hides the rest and relabels the representative,
 * so the camera never triggers a recompute.
 */
export function clusterRepresentatives(payload: EscalationGraphPayload): {
  representatives: Map<string, string>;
  sizes: Map<string, number>;
} {
  const representatives = new Map<string, string>();
  const sizes = new Map<string, number>();
  for (const node of payload.nodes) {
    const key = node.type;
    if (!representatives.has(key)) representatives.set(key, node.id);
    sizes.set(key, (sizes.get(key) ?? 0) + 1);
  }
  return { representatives, sizes };
}

/* ------------------------------------------------------------------ */
/* Colour resolution for the WebGL renderer                            */
/* ------------------------------------------------------------------ */

/**
 * sigma's WebGL programs parse colours with a hex/rgb parser, so a token
 * expression like `var(--graph-node-role)` (or the `oklch(...)` it resolves to)
 * is not understood. Everything handed to sigma therefore goes through these
 * helpers: the token chain is walked, the value is normalised by the canvas 2D
 * colour parser into `#rrggbb`, and only then does it reach the shader.
 */
const colorCache = new Map<string, string>();
let probeCanvas: HTMLCanvasElement | null = null;
const SENTINEL = '#010203';

function probeContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  probeCanvas ??= document.createElement('canvas');
  probeCanvas.width = 1;
  probeCanvas.height = 1;
  return probeCanvas.getContext('2d');
}

function resolveVarChain(value: string, depth = 0): string {
  if (typeof document === 'undefined' || depth > 6) return value;
  const match = /^var\(\s*(--[A-Za-z0-9-_]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(value.trim());
  if (match === null) return value;
  const name = match[1] ?? '';
  const declaration = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (declaration === '') return match[2]?.trim() ?? value;
  return resolveVarChain(declaration, depth + 1);
}

/** Flush the memoised colours - call after a theme or accent change. */
export function clearColorCache(): void {
  colorCache.clear();
}

/** Resolve any CSS token/colour expression to a colour sigma can parse. */
export function resolveColorValue(value: string): string {
  const cached = colorCache.get(value);
  if (cached !== undefined) return cached;

  const resolved = resolveVarChain(value);
  let output = resolved;

  const context = probeContext();
  if (context !== null) {
    // The sentinel survives only if the browser could not parse the value.
    context.fillStyle = SENTINEL;
    context.fillStyle = resolved;
    const normalised = typeof context.fillStyle === 'string' ? context.fillStyle : resolved;
    output = normalised.toUpperCase() === SENTINEL.toUpperCase() ? resolved : normalised;
  }

  colorCache.set(value, output);
  return output;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

function toRgb(color: string): Rgb | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color);
  if (hex !== null) {
    const digits = hex[1] ?? '';
    if (digits.length === 3 || digits.length === 4) {
      const r = parseInt(`${digits[0]}${digits[0]}`, 16);
      const g = parseInt(`${digits[1]}${digits[1]}`, 16);
      const b = parseInt(`${digits[2]}${digits[2]}`, 16);
      const a = digits.length === 4 ? parseInt(`${digits[3]}${digits[3]}`, 16) / 255 : 1;
      return { r, g, b, a };
    }
    if (digits.length === 6 || digits.length === 8) {
      const r = parseInt(digits.slice(0, 2), 16);
      const g = parseInt(digits.slice(2, 4), 16);
      const b = parseInt(digits.slice(4, 6), 16);
      const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
    return null;
  }

  const functional =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)$/i.exec(color);
  if (functional === null) return null;
  const alphaText = functional[4];
  const alpha =
    alphaText === undefined
      ? 1
      : alphaText.endsWith('%')
        ? Number.parseFloat(alphaText) / 100
        : Number.parseFloat(alphaText);
  return {
    r: Number.parseFloat(functional[1] ?? '0'),
    g: Number.parseFloat(functional[2] ?? '0'),
    b: Number.parseFloat(functional[3] ?? '0'),
    a: Number.isFinite(alpha) ? alpha : 1,
  };
}

/** Resolve a token, optionally fading it towards `alpha` (Plan §15.5). */
export function resolveColor(value: string, alpha = 1): string {
  const base = resolveColorValue(value);
  if (alpha >= 1) return base;
  const rgb = toRgb(base);
  if (rgb === null) return base;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${clamped})`;
}

/** Fade a token to `GRAPH.dimOpacity` - the de-emphasis used for context. */
export function dimmedColor(value: string, opacity: number = GRAPH.dimOpacity): string {
  return resolveColor(value, opacity);
}
