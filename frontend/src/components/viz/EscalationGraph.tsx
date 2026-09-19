import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import Sigma from 'sigma';
import { ArrowLeftRight, Crosshair, Pin, PinOff, Route, ZoomIn } from 'lucide-react';
import { DURATION, GRAPH } from '@iamscope/tokens';
import type {
  EscalationSeverity,
  EscalationGraphPayload,
  GraphEdge,
  GraphNode,
} from '@iamscope/types';
import { Badge } from '@/components/ui/Badge';
import { Button, IconButton } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { cn } from '@/lib/cn';
import {
  clearColorCache,
  clusterRepresentatives,
  createEscalationGraph,
  degreesByNode,
  dimmedColor,
  edgeKindColorVar,
  neighbourhood,
  nodeColorVar,
  pathEdgeIds,
  resolveColor,
  runForceLayout,
  seedPositionsDeterministically,
  severityRank,
  severityRingColorVar,
  zoomTier,
  ZOOM_TIER_LABELS,
  type GraphZoomTier,
} from '@/lib/graph';
import type { GraphMinimapCamera } from './GraphMinimap';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

export interface GraphCursor {
  id: string;
  name: string;
  color: string;
  /** Graph-space coordinates, or null when the peer is not pointing anywhere. */
  cursor: { x: number; y: number } | null;
}

export interface EscalationGraphHandle {
  zoomToFit(): void;
  reset(): void;
  focusNode(id: string): void;
}

export interface EscalationGraphProps {
  graph: EscalationGraphPayload | null;
  loading?: boolean | undefined;
  highlightPathId?: string | null | undefined;
  focusNodeId?: string | null | undefined;
  cursors?: GraphCursor[] | undefined;
  onNodeSelect?: ((node: GraphNode | null) => void) | undefined;
  onEdgeSelect?: ((edge: GraphEdge | null) => void) | undefined;
  /**
   * Additive beyond the lens contract: the empty state needs a primary action
   * (Plan §15.5), and the page needs the camera, the laid-out positions and the
   * pointer position for its minimap and presence cursors.
   */
  onCompute?: (() => void) | undefined;
  computing?: boolean | undefined;
  onCameraChange?: ((camera: GraphMinimapCamera) => void) | undefined;
  /** Node positions in graph space, emitted once per laid-out payload. */
  onLayoutChange?: ((nodes: { id: string; x: number; y: number }[]) => void) | undefined;
  /** Pointer position in graph space, or null when the pointer leaves. */
  onPointerMove?: ((point: { x: number; y: number } | null) => void) | undefined;
  className?: string | undefined;
}

interface NodeAttrs {
  label: string;
  arn: string;
  type: string;
  severity: EscalationSeverity | null;
  hopDepth: number;
}

interface EdgeAttrs {
  label: string;
  kind: GraphEdge['kind'];
  weight: number;
  size: number;
}

/** Structurally identical to sigma's own display-data shapes, without the import. */
interface NodeDisplay {
  hidden: boolean;
  label: string | null;
  size: number;
  color: string;
  zIndex: number;
}

interface EdgeDisplay extends NodeDisplay {
  forceLabel: boolean;
}

interface ViewState {
  tier: GraphZoomTier;
  selected: string | null;
  /** Focused node; everything beyond `GRAPH.focusDepth` hops fades. */
  focus: string | null;
  focusScope: Set<string>;
  pinned: Set<string>;
  hoveredEdge: string | null;
  /** Edge ids of the currently highlighted path, in hop order. */
  pathEdges: string[];
  pathNodes: Set<string>;
  activeHop: number;
  representatives: Map<string, string>;
  clusterSizes: Map<string, number>;
}

function emptyView(): ViewState {
  return {
    tier: 'label',
    selected: null,
    focus: null,
    focusScope: new Set<string>(),
    pinned: new Set<string>(),
    hoveredEdge: null,
    pathEdges: [],
    pathNodes: new Set<string>(),
    activeHop: -1,
    representatives: new Map<string, string>(),
    clusterSizes: new Map<string, number>(),
  };
}

/**
 * Structural view of the laid-out graphology instance. Kept structural so this
 * component never depends on which graphology class the shared builder returns.
 */
interface LayoutGraphLike {
  nodes(): string[];
  hasNode(node: string): boolean;
  getNodeAttribute(node: string, attribute: string): unknown;
  getNodeAttributes(node: string): unknown;
}

interface Latest {
  graph: EscalationGraphPayload | null;
  nodesById: Map<string, GraphNode>;
  edgesById: Map<string, GraphEdge>;
  degrees: Map<string, number>;
  onNodeSelect: ((node: GraphNode | null) => void) | undefined;
  onEdgeSelect: ((edge: GraphEdge | null) => void) | undefined;
  onCameraChange: ((camera: GraphMinimapCamera) => void) | undefined;
}

/* ------------------------------------------------------------------ */
/* Pure display helpers (shared by reducers, painter and list)          */
/* ------------------------------------------------------------------ */

/** Size by degree, nudged by how close the node sits to the start of a path. */
function nodeSize(attrs: NodeAttrs, degree: number): number {
  return Math.max(4, 5 + Math.min(degree, 8) * 1.5 + Math.min(attrs.hopDepth, 4));
}

function isDimmed(view: ViewState, nodeId: string): boolean {
  if (view.focus !== null && !view.focusScope.has(nodeId)) return true;
  if (view.pathEdges.length > 0 && !view.pathNodes.has(nodeId)) return true;
  return false;
}

function severityRankOf(node: GraphNode): number {
  return node.severity === null ? -1 : severityRank(node.severity);
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

/**
 * The escalation graph (Plan §11, §15.5).
 *
 * sigma.js draws in WebGL inside `.graph-canvas`; ForceAtlas2 relaxes a layout
 * seeded deterministically from the node ids, so the same payload always produces
 * the same picture and the camera is never reset by an unrelated render. The
 * component owns every resource it creates - sigma instance, camera listener, hop
 * timer, animation frame, MutationObserver - and releases all of them on unmount
 * or org switch, because a leaked sigma keeps its WebGL context alive.
 */
export const EscalationGraph = forwardRef<EscalationGraphHandle, EscalationGraphProps>(
  function EscalationGraph(
    {
      graph,
      loading = false,
      highlightPathId = null,
      focusNodeId = null,
      cursors,
      onNodeSelect,
      onEdgeSelect,
      onCompute,
      computing = false,
      onCameraChange,
      onLayoutChange,
      onPointerMove,
      className,
    },
    ref,
  ) {
    const reducedMotion = useReducedMotion();
    const containerRef = useRef<HTMLDivElement | null>(null);
    const overlayRef = useRef<HTMLCanvasElement | null>(null);
    const sigmaRef = useRef<Sigma | null>(null);
    const viewRef = useRef<ViewState>(emptyView());
    const layoutGraphRef = useRef<LayoutGraphLike | null>(null);
    const cursorRafRef = useRef<number | null>(null);
    const hopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const emitRef = useRef(0);
    const reducedMotionRef = useRef(reducedMotion);
    reducedMotionRef.current = reducedMotion;

    const [tier, setTier] = useState<GraphZoomTier>('label');
    const [pinned, setPinned] = useState<readonly string[]>([]);
    const [selected, setSelected] = useState<string | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
    const [activeHop, setActiveHop] = useState(-1);
    const [announcement, setAnnouncement] = useState('');
    const [cursorPixels, setCursorPixels] = useState<
      { id: string; name: string; color: string; left: number; top: number }[]
    >([]);

    const nodeCount = graph?.nodes.length ?? 0;
    const isEmpty = nodeCount === 0;

    const nodesById = useMemo(() => {
      const map = new Map<string, GraphNode>();
      for (const node of graph?.nodes ?? []) map.set(node.id, node);
      return map;
    }, [graph]);

    const edgesById = useMemo(() => {
      const map = new Map<string, GraphEdge>();
      for (const edge of graph?.edges ?? []) map.set(edge.id, edge);
      return map;
    }, [graph]);

    const degrees = useMemo(
      () => (graph === null ? new Map<string, number>() : degreesByNode(graph)),
      [graph],
    );

    const adjacency = useMemo(() => {
      const map = new Map<string, string[]>();
      for (const edge of graph?.edges ?? []) {
        map.set(edge.source, [...(map.get(edge.source) ?? []), edge.target]);
        map.set(edge.target, [...(map.get(edge.target) ?? []), edge.source]);
      }
      return map;
    }, [graph]);

    /**
     * Everything the *stable* callbacks (reducers, sigma handlers, timers) need.
     * Refs rather than dependencies: a new callback identity would tear the sigma
     * instance down and rebuild the layout on every click.
     */
    const latestRef = useRef<Latest>({
      graph,
      nodesById,
      edgesById,
      degrees,
      onNodeSelect,
      onEdgeSelect,
      onCameraChange,
    });
    latestRef.current = {
      graph,
      nodesById,
      edgesById,
      degrees,
      onNodeSelect,
      onEdgeSelect,
      onCameraChange,
    };

    const cursorsRef = useRef(cursors);
    cursorsRef.current = cursors;

    /* ---- Layout: rebuilt only when the payload changes ---------------- */

    const layoutGraph = useMemo(() => {
      // The layout engine must never run on an empty graph (Plan §20).
      if (graph === null || graph.nodes.length === 0) return null;
      const instance = createEscalationGraph(graph);
      seedPositionsDeterministically(instance);
      runForceLayout(instance, graph.nodes.length > 400 ? 60 : 160);
      const clusters = clusterRepresentatives(graph);
      viewRef.current.representatives = clusters.representatives;
      viewRef.current.clusterSizes = clusters.sizes;
      return instance;
    }, [graph]);

    /** Report the laid-out positions once per payload (never during render). */
    useEffect(() => {
      if (onLayoutChange === undefined) return;
      if (layoutGraph === null) {
        onLayoutChange([]);
        return;
      }
      onLayoutChange(
        layoutGraph.nodes().map((id) => ({
          id,
          x: Number(layoutGraph.getNodeAttribute(id, 'x')),
          y: Number(layoutGraph.getNodeAttribute(id, 'y')),
        })),
      );
    }, [layoutGraph, onLayoutChange]);

    /* ---- Path bookkeeping -------------------------------------------- */

    const hoverPath = useMemo(() => {
      if (graph === null || hoveredEdge === null) return null;
      return graph.paths.find((path) => pathEdgeIds(graph, path).includes(hoveredEdge)) ?? null;
    }, [graph, hoveredEdge]);

    const activePath = useMemo(() => {
      if (hoverPath !== null) return hoverPath;
      if (graph === null || highlightPathId === null) return null;
      return graph.paths.find((path) => path.id === highlightPathId) ?? null;
    }, [graph, highlightPathId, hoverPath]);

    const activePathEdges = useMemo(
      () => (graph === null || activePath === null ? [] : pathEdgeIds(graph, activePath)),
      [activePath, graph],
    );

    const activePathNodes = useMemo(() => {
      const set = new Set<string>();
      if (activePath === null) return set;
      set.add(activePath.fromPrincipalArn);
      for (const hop of activePath.hops) set.add(hop.target);
      return set;
    }, [activePath]);

    /* ---- Reducers (Plan §15.5) --------------------------------------- */

    const nodeReducer = useCallback((nodeId: string, data: unknown): Partial<NodeDisplay> => {
      const view = viewRef.current;
      const attrs = data as NodeAttrs;

      if (view.tier === 'cluster') {
        const representative = view.representatives.get(attrs.type);
        if (representative !== nodeId) return { hidden: true };
        const size = view.clusterSizes.get(attrs.type) ?? 1;
        return {
          hidden: false,
          label: `${attrs.type} × ${size}`,
          size: 18 + Math.min(size, 40) * 0.4,
          color: resolveColor(nodeColorVar(attrs.type)),
          zIndex: 1,
        };
      }

      const dimmed = isDimmed(view, nodeId);
      const focused = view.focus === nodeId || view.selected === nodeId;
      const isPinned = view.pinned.has(nodeId);
      const scale = focused ? 1.5 : isPinned ? 1.3 : dimmed ? 0.75 : 1;

      return {
        hidden: false,
        // Semantic zoom: clusters -> names -> full ARNs (Plan §15.5).
        label:
          dimmed && view.tier === 'label' ? null : view.tier === 'detail' ? attrs.arn : attrs.label,
        size: nodeSize(attrs, latestRef.current.degrees.get(nodeId) ?? 0) * scale,
        color: dimmed
          ? dimmedColor(nodeColorVar(attrs.type))
          : resolveColor(nodeColorVar(attrs.type)),
        zIndex: isPinned ? 3 : focused ? 2 : 1,
      };
    }, []);

    const edgeReducer = useCallback((edgeId: string, data: unknown): Partial<EdgeDisplay> => {
      const view = viewRef.current;
      const attrs = data as EdgeAttrs;
      const index = view.pathEdges.indexOf(edgeId);
      const lit = index !== -1 && (view.activeHop < 0 || index <= view.activeHop);
      const hovered = view.hoveredEdge === edgeId;
      const colour = edgeKindColorVar(attrs.kind);

      if (lit) {
        return {
          hidden: false,
          color: resolveColor(colour),
          // Thickness scales with the permission count carried by the hop.
          size: Math.max(2, attrs.size + 1.5),
          label: view.tier === 'detail' || hovered ? attrs.label : null,
          forceLabel: hovered,
          zIndex: 2,
        };
      }

      return {
        hidden: false,
        color: dimmedColor(
          colour,
          view.pathEdges.length > 0 || view.focus !== null ? GRAPH.dimOpacity : 0.45,
        ),
        size: attrs.size,
        label: hovered ? attrs.label : null,
        forceLabel: hovered && view.tier !== 'cluster',
        zIndex: 1,
      };
    }, []);

    const scheduleRefresh = useCallback((): void => {
      sigmaRef.current?.scheduleRefresh();
    }, []);

    /* ---- Overlay painting: severity rings + live cursors -------------- */

    const paintOverlay = useCallback((): void => {
      const sigma = sigmaRef.current;
      const canvas = overlayRef.current;
      const layout = layoutGraphRef.current;
      if (sigma === null || canvas === null || layout === null) return;
      const parent = canvas.parentElement;
      if (parent === null) return;

      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }

      const context = canvas.getContext('2d');
      if (context === null) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const view = viewRef.current;
      if (view.tier === 'cluster') return;

      const ratio = sigma.getCamera().ratio;
      const degreesByNodeId = latestRef.current.degrees;

      for (const nodeId of layout.nodes()) {
        const attrs = layout.getNodeAttributes(nodeId) as NodeAttrs;
        const ring = severityRingColorVar(attrs.severity);
        if (ring === null) continue;

        const screen = sigma.graphToViewport({
          x: Number(layout.getNodeAttribute(nodeId, 'x')),
          y: Number(layout.getNodeAttribute(nodeId, 'y')),
        });
        const radius = Math.max(
          4,
          sigma.scaleSize(nodeSize(attrs, degreesByNodeId.get(nodeId) ?? 0), ratio) / 2,
        );

        context.beginPath();
        context.arc(screen.x, screen.y, radius + 2.5, 0, Math.PI * 2);
        context.lineWidth = 2;
        context.strokeStyle = isDimmed(view, nodeId)
          ? dimmedColor(ring, GRAPH.dimOpacity)
          : resolveColor(ring);
        context.stroke();
      }
    }, []);

    const updateCursors = useCallback((): void => {
      const sigma = sigmaRef.current;
      const peers = cursorsRef.current;
      if (sigma === null || peers === undefined || peers.length === 0) {
        setCursorPixels((previous) => (previous.length === 0 ? previous : []));
        return;
      }
      // Presence coordinates are graph-space; converting them is a matrix
      // multiply, so live cursors never touch the layout (Plan §14.3).
      const pixels = peers.flatMap((entry) => {
        if (entry.cursor === null) return [];
        const position = sigma.graphToViewport(entry.cursor);
        return [
          { id: entry.id, name: entry.name, color: entry.color, left: position.x, top: position.y },
        ];
      });
      setCursorPixels(pixels);
    }, []);

    const scheduleOverlayUpdate = useCallback((): void => {
      if (cursorRafRef.current !== null) return;
      cursorRafRef.current = requestAnimationFrame(() => {
        cursorRafRef.current = null;
        paintOverlay();
        updateCursors();
      });
    }, [paintOverlay, updateCursors]);

    /* ---- Focus (declared before the effect that captures it) ---------- */

    const focusOn = useCallback(
      (nodeId: string): void => {
        const view = viewRef.current;
        const payload = latestRef.current.graph;
        view.focus = nodeId;
        view.selected = nodeId;
        view.focusScope =
          payload === null ? new Set<string>() : neighbourhood(payload, nodeId, GRAPH.focusDepth);
        setSelected(nodeId);
        scheduleRefresh();
        scheduleOverlayUpdate();
        latestRef.current.onNodeSelect?.(latestRef.current.nodesById.get(nodeId) ?? null);

        const sigma = sigmaRef.current;
        const layout = layoutGraphRef.current;
        if (sigma !== null && layout?.hasNode(nodeId)) {
          const position = {
            x: Number(layout.getNodeAttribute(nodeId, 'x')),
            y: Number(layout.getNodeAttribute(nodeId, 'y')),
          };
          void sigma
            .getCamera()
            .animate(
              { x: position.x, y: position.y, ratio: Math.min(sigma.getCamera().ratio, 0.6) },
              { duration: reducedMotionRef.current ? 0 : DURATION.normal },
            );
        }
      },
      [scheduleOverlayUpdate, scheduleRefresh],
    );

    /* ---- sigma lifecycle --------------------------------------------- */

    useEffect(() => {
      const container = containerRef.current;
      const layout = layoutGraph;
      layoutGraphRef.current = layout;
      if (container === null || layout === null) return;

      const sigma = new Sigma(layout, container, {
        allowInvalidContainer: true,
        renderLabels: true,
        renderEdgeLabels: false,
        enableEdgeEvents: true,
        labelRenderedSizeThreshold: 4,
        labelDensity: 1.3,
        labelColor: { color: resolveColor('var(--text)') },
        edgeLabelColor: { color: resolveColor('var(--text-muted)') },
        defaultEdgeColor: resolveColor('var(--edge-attach)'),
        minCameraRatio: 0.02,
        maxCameraRatio: 14,
        zIndex: true,
        nodeReducer,
        edgeReducer,
      });
      sigmaRef.current = sigma;

      const camera = sigma.getCamera();
      // Scale and centre once the layout has settled.
      void camera.animatedReset({ duration: reducedMotionRef.current ? 0 : DURATION.normal });

      const onCameraUpdated = (state: { x: number; y: number; ratio: number }): void => {
        const nextTier = zoomTier(state.ratio);
        if (nextTier !== viewRef.current.tier) {
          viewRef.current.tier = nextTier;
          setTier(nextTier);
          sigma.setSetting('renderLabels', nextTier !== 'cluster');
          sigma.setSetting('renderEdgeLabels', nextTier === 'detail');
          sigma.refresh();
        }
        scheduleOverlayUpdate();

        // Throttled camera reporting: the minimap does not need 60fps.
        const now = Date.now();
        const report = latestRef.current.onCameraChange;
        if (report !== undefined && now - emitRef.current > 90) {
          emitRef.current = now;
          const dimensions = sigma.getDimensions();
          const topLeft = sigma.viewportToGraph({ x: 0, y: 0 });
          const bottomRight = sigma.viewportToGraph({ x: dimensions.width, y: dimensions.height });
          report({
            x: (topLeft.x + bottomRight.x) / 2,
            y: (topLeft.y + bottomRight.y) / 2,
            ratio: Math.abs(bottomRight.x - topLeft.x) / Math.max(1, dimensions.width),
            width: dimensions.width,
            height: dimensions.height,
          });
        }
      };

      const onEnterNode = (payload: { node: string }): void => {
        setAnnouncement(
          `Focused ${latestRef.current.nodesById.get(payload.node)?.name ?? payload.node}`,
        );
      };
      const onLeaveNode = (): void => setAnnouncement('');
      const onEnterEdge = (payload: { edge: string }): void => {
        viewRef.current.hoveredEdge = payload.edge;
        setHoveredEdge(payload.edge);
        scheduleRefresh();
        const edge = latestRef.current.edgesById.get(payload.edge);
        if (edge !== undefined) latestRef.current.onEdgeSelect?.(edge);
      };
      const onLeaveEdge = (): void => {
        if (viewRef.current.hoveredEdge === null) return;
        viewRef.current.hoveredEdge = null;
        setHoveredEdge(null);
        scheduleRefresh();
      };
      const onClickNode = (payload: {
        node: string;
        event: { original: MouseEvent | TouchEvent };
      }): void => {
        const original = payload.event.original;
        // Cmd / Ctrl + click pins a node (Plan §15.5).
        if (original instanceof MouseEvent && (original.metaKey || original.ctrlKey)) {
          const next = new Set(viewRef.current.pinned);
          if (next.has(payload.node)) next.delete(payload.node);
          else next.add(payload.node);
          viewRef.current.pinned = next;
          setPinned([...next]);
          scheduleRefresh();
          return;
        }
        focusOn(payload.node);
      };
      const onClickStage = (): void => {
        if (viewRef.current.focus === null && viewRef.current.selected === null) return;
        viewRef.current.focus = null;
        viewRef.current.selected = null;
        viewRef.current.focusScope = new Set<string>();
        setSelected(null);
        scheduleRefresh();
        scheduleOverlayUpdate();
        latestRef.current.onNodeSelect?.(null);
        latestRef.current.onEdgeSelect?.(null);
      };

      camera.on('updated', onCameraUpdated);
      sigma.on('enterNode', onEnterNode);
      sigma.on('leaveNode', onLeaveNode);
      sigma.on('enterEdge', onEnterEdge);
      sigma.on('leaveEdge', onLeaveEdge);
      sigma.on('clickNode', onClickNode);
      sigma.on('clickStage', onClickStage);
      scheduleOverlayUpdate();

      // A theme or accent swap invalidates every memoised colour token.
      const observer =
        typeof MutationObserver === 'undefined'
          ? null
          : new MutationObserver(() => {
              clearColorCache();
              scheduleRefresh();
              scheduleOverlayUpdate();
            });
      observer?.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme', 'data-accent'],
      });

      return () => {
        observer?.disconnect();
        camera.off('updated', onCameraUpdated);
        sigma.off('enterNode', onEnterNode);
        sigma.off('leaveNode', onLeaveNode);
        sigma.off('enterEdge', onEnterEdge);
        sigma.off('leaveEdge', onLeaveEdge);
        sigma.off('clickNode', onClickNode);
        sigma.off('clickStage', onClickStage);
        sigma.kill();
        sigmaRef.current = null;
        layoutGraphRef.current = null;
        setCursorPixels((previous) => (previous.length === 0 ? previous : []));
      };
    }, [edgeReducer, focusOn, layoutGraph, nodeReducer, scheduleOverlayUpdate, scheduleRefresh]);

    /* ---- Imperative handle (Plan §15.4: f / r shortcuts) -------------- */

    useImperativeHandle(
      ref,
      () => ({
        zoomToFit: (): void => {
          const sigma = sigmaRef.current;
          if (sigma === null) return;
          void sigma
            .getCamera()
            .animatedReset({ duration: reducedMotionRef.current ? 0 : DURATION.normal });
        },
        reset: (): void => {
          const sigma = sigmaRef.current;
          const view = viewRef.current;
          view.focus = null;
          view.selected = null;
          view.focusScope = new Set<string>();
          view.pinned = new Set<string>();
          setPinned([]);
          setSelected(null);
          scheduleRefresh();
          scheduleOverlayUpdate();
          latestRef.current.onNodeSelect?.(null);
          latestRef.current.onEdgeSelect?.(null);
          if (sigma === null) return;
          void sigma
            .getCamera()
            .animatedReset({ duration: reducedMotionRef.current ? 0 : DURATION.normal });
        },
        focusNode: (id: string): void => focusOn(id),
      }),
      [focusOn, scheduleOverlayUpdate, scheduleRefresh],
    );

    /* ---- Controlled focus prop --------------------------------------- */

    useEffect(() => {
      const view = viewRef.current;
      if (focusNodeId === null) {
        if (view.focus === null) return;
        view.focus = null;
        view.focusScope = new Set<string>();
        scheduleRefresh();
        scheduleOverlayUpdate();
        return;
      }
      if (view.focus === focusNodeId) return;
      view.focus = focusNodeId;
      view.selected = focusNodeId;
      view.focusScope =
        graph === null ? new Set<string>() : neighbourhood(graph, focusNodeId, GRAPH.focusDepth);
      setSelected(focusNodeId);
      scheduleRefresh();
      scheduleOverlayUpdate();
    }, [focusNodeId, graph, scheduleOverlayUpdate, scheduleRefresh]);

    /* ---- Path hop animation (Plan §15.5: 80ms/hop) -------------------- */

    useEffect(() => {
      const view = viewRef.current;
      view.pathEdges = activePathEdges;
      view.pathNodes = activePathNodes;

      if (hopTimerRef.current !== null) {
        clearInterval(hopTimerRef.current);
        hopTimerRef.current = null;
      }

      if (activePathEdges.length === 0) {
        view.activeHop = -1;
        setActiveHop(-1);
        scheduleRefresh();
        return;
      }

      // Reduced motion: reveal the whole path at once instead of animating it.
      if (reducedMotion) {
        view.activeHop = activePathEdges.length - 1;
        setActiveHop(activePathEdges.length - 1);
        scheduleRefresh();
        return;
      }

      view.activeHop = 0;
      setActiveHop(0);
      scheduleRefresh();

      let hop = 0;
      hopTimerRef.current = setInterval(() => {
        hop += 1;
        if (hop >= activePathEdges.length) {
          if (hopTimerRef.current !== null) clearInterval(hopTimerRef.current);
          hopTimerRef.current = null;
          return;
        }
        viewRef.current.activeHop = hop;
        setActiveHop(hop);
        sigmaRef.current?.scheduleRefresh();
        scheduleOverlayUpdate();
      }, GRAPH.hopAnimationMs);

      return () => {
        if (hopTimerRef.current !== null) {
          clearInterval(hopTimerRef.current);
          hopTimerRef.current = null;
        }
      };
    }, [activePathEdges, activePathNodes, reducedMotion, scheduleOverlayUpdate, scheduleRefresh]);

    /* ---- Repaint whenever the visual state changes ------------------- */

    useEffect(() => {
      viewRef.current.pinned = new Set(pinned);
      scheduleRefresh();
      scheduleOverlayUpdate();
    }, [pinned, scheduleOverlayUpdate, scheduleRefresh]);

    useEffect(() => {
      scheduleOverlayUpdate();
    }, [cursors, activeHop, tier, scheduleOverlayUpdate]);

    useEffect(
      () => () => {
        // Every timer and frame is released: nothing survives unmount.
        if (cursorRafRef.current !== null) cancelAnimationFrame(cursorRafRef.current);
        if (hopTimerRef.current !== null) clearInterval(hopTimerRef.current);
        cursorRafRef.current = null;
        hopTimerRef.current = null;
      },
      [],
    );

    /* ---- Keyboard traversal (Plan §15.5, §15.7) ---------------------- */

    const onKeyDown = useCallback(
      (event: React.KeyboardEvent<HTMLDivElement>): void => {
        const nodeIds = [...latestRef.current.nodesById.keys()];
        if (nodeIds.length === 0) return;

        const current = viewRef.current.selected;
        const neighbours = current === null ? [] : (adjacency.get(current) ?? []);
        const candidates = neighbours.length > 0 ? neighbours : nodeIds;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          const index = current === null ? -1 : candidates.indexOf(current);
          const next = candidates[(index + 1 + candidates.length) % candidates.length];
          if (next !== undefined) focusOn(next);
          event.preventDefault();
          return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          const index = current === null ? 0 : candidates.indexOf(current);
          const next = candidates[(index - 1 + candidates.length) % candidates.length];
          if (next !== undefined) focusOn(next);
          event.preventDefault();
          return;
        }
        if (event.key === 'Enter') {
          const node = current ?? nodeIds[0];
          if (node !== undefined)
            latestRef.current.onNodeSelect?.(latestRef.current.nodesById.get(node) ?? null);
          event.preventDefault();
          return;
        }
        if (event.key === 'Escape') {
          viewRef.current.focus = null;
          viewRef.current.selected = null;
          viewRef.current.focusScope = new Set<string>();
          setSelected(null);
          scheduleRefresh();
          scheduleOverlayUpdate();
          latestRef.current.onNodeSelect?.(null);
          event.preventDefault();
        }
      },
      [adjacency, focusOn, scheduleOverlayUpdate, scheduleRefresh],
    );

    /* ---- Derived render data ----------------------------------------- */

    const severityCounts = useMemo(() => {
      let high = 0;
      let medium = 0;
      let low = 0;
      for (const node of graph?.nodes ?? []) {
        if (node.severity === 'high') high += 1;
        else if (node.severity === 'medium') medium += 1;
        else if (node.severity === 'low') low += 1;
      }
      return { high, medium, low };
    }, [graph]);

    const listNodes = useMemo(() => {
      const nodes = [...nodesById.values()];
      nodes.sort((a, b) => severityRankOf(b) - severityRankOf(a) || a.name.localeCompare(b.name));
      return nodes;
    }, [nodesById]);

    return (
      <div
        className={cn(
          'relative min-h-[420px] overflow-hidden rounded-panel border border-border bg-bg-inset',
          className,
        )}
        onPointerMove={(event) => {
          const sigma = sigmaRef.current;
          if (sigma === null || onPointerMove === undefined) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onPointerMove(
            sigma.viewportToGraph({
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            }),
          );
        }}
        onPointerLeave={() => onPointerMove?.(null)}
      >
        <div
          ref={containerRef}
          role="application"
          aria-label="Escalation graph. Use the arrow keys to move between connected principals, Enter to select and Escape to clear."
          tabIndex={0}
          onKeyDown={onKeyDown}
          className="graph-canvas outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
        />

        <canvas
          ref={overlayRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
        />

        {cursors === undefined
          ? null
          : cursorPixels.map((entry) => (
              <span
                key={entry.id}
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1',
                  !reducedMotion && 'dur-fast ease-out-brand transition-[left,top]',
                )}
                style={{ left: entry.left, top: entry.top }}
              >
                <span
                  className="size-2.5 rounded-full ring-2 ring-bg"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-micro overlay-surface px-1 py-0.5 text-text">
                  {entry.name}
                </span>
              </span>
            ))}

        {/* The graph must stay usable without a pointer (Plan §15.7). */}
        {isEmpty ? null : (
          <div className="absolute top-3 left-3 z-20 flex max-h-[calc(100%-24px)] w-56 flex-col gap-1.5">
            <div className="overlay-surface flex items-center gap-2 px-2 py-1.5">
              <Route aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
              <span className="text-12 min-w-0 flex-1 truncate text-text">
                {ZOOM_TIER_LABELS[tier]} · {nodeCount} nodes
              </span>
            </div>

            <nav
              aria-label="Nodes on this page"
              className="overlay-surface flex min-h-0 flex-col overflow-hidden"
            >
              <p className="text-micro border-b border-border px-2 py-1 font-medium text-text-subtle">
                On this page
              </p>
              <ul className="flex min-h-0 flex-col overflow-auto p-1">
                {listNodes.map((node) => {
                  const isSelected = selected === node.id;
                  const isPinned = pinned.includes(node.id);
                  const ring = severityRingColorVar(node.severity);
                  return (
                    <li key={node.id} className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-current={isSelected ? 'true' : undefined}
                        onClick={() => focusOn(node.id)}
                        className={cn(
                          'dur-fast text-12 flex min-w-0 flex-1 items-center gap-1.5 rounded-input px-1.5 py-1 text-left outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          isSelected && 'bg-bg-selected',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className="size-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor: resolveColor(nodeColorVar(node.type)),
                            boxShadow:
                              ring === null ? undefined : `0 0 0 1.5px ${resolveColor(ring)}`,
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-text">{node.name}</span>
                        {node.severity === null ? null : (
                          <Badge
                            size="sm"
                            variant={
                              node.severity === 'high'
                                ? 'danger'
                                : node.severity === 'medium'
                                  ? 'warn'
                                  : 'info'
                            }
                          >
                            {node.severity}
                          </Badge>
                        )}
                      </button>
                      <IconButton
                        size="sm"
                        variant="ghost"
                        icon={isPinned ? PinOff : Pin}
                        label={isPinned ? `Unpin ${node.name}` : `Pin ${node.name}`}
                        onClick={() => {
                          const next = new Set(viewRef.current.pinned);
                          if (next.has(node.id)) next.delete(node.id);
                          else next.add(node.id);
                          viewRef.current.pinned = next;
                          setPinned([...next]);
                          scheduleRefresh();
                        }}
                      />
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
        )}

        {isEmpty ? (
          <div className="absolute inset-0 flex items-center justify-center">
            {loading ? (
              <div className="flex w-64 flex-col gap-2" aria-busy="true">
                <span className="sr-only" role="status">
                  Loading escalation paths
                </span>
                <Skeleton className="mx-auto h-4 w-40" />
                <Skeleton variant="block" className="h-24" />
              </div>
            ) : (
              <EmptyState
                icon={Crosshair}
                title="No escalation paths found"
                description="Run a traversal to walk every principal in this organization and look for multi-hop privilege escalation."
                action={
                  <Button
                    variant="primary"
                    size="md"
                    iconLeft={ZoomIn}
                    loading={computing}
                    disabled={onCompute === undefined}
                    onClick={onCompute}
                  >
                    Compute escalation paths
                  </Button>
                }
              />
            )}
          </div>
        ) : null}

        {isEmpty ? null : (
          <div className="absolute right-3 bottom-24 z-20 flex flex-col items-end gap-1">
            <span className="overlay-surface text-micro flex items-center gap-2 px-2 py-1 text-text-muted">
              <span className="text-severity-high tabular">{severityCounts.high} high</span>
              <span className="text-severity-medium tabular">{severityCounts.medium} med</span>
              <span className="text-severity-low tabular">{severityCounts.low} low</span>
            </span>
            {activeHop >= 0 && activePath !== null ? (
              <span className="overlay-surface text-micro flex items-center gap-1.5 px-2 py-1 text-text">
                <ArrowLeftRight aria-hidden="true" className="size-3" />
                hop {activeHop + 1}/{activePathEdges.length} · {activePath.pattern}
              </span>
            ) : null}
            {selected === null ? null : (
              <span className="overlay-surface text-micro mono max-w-[240px] truncate px-2 py-1 text-text-muted">
                {nodesById.get(selected)?.arn ?? selected}
              </span>
            )}
          </div>
        )}

        <p className="sr-only">
          Focus a principal with the arrow keys, press Enter to select it and Escape to clear. Hold
          Command or Control and click a node to pin it. Press F to zoom to fit and R to reset the
          view.
        </p>
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </div>
    );
  },
);
