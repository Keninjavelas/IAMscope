import { useCallback, useEffect, useRef, type JSX } from 'react';
import { GRAPH } from '@iamscope/tokens';
import { cn } from '@/lib/cn';

export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphMinimapCamera {
  /** Viewport centre, in graph coordinates. */
  x: number;
  y: number;
  /** Graph units per screen pixel. */
  ratio: number;
  /** Viewport size in screen pixels. */
  width: number;
  height: number;
}

export interface GraphMinimapProps {
  nodes: GraphPoint[];
  camera: GraphMinimapCamera;
  /** Normalised 0..1 coordinates inside the graph bounds. */
  onNavigate: (x: number, y: number) => void;
}

export interface GraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PADDING_RATIO = 0.08;

/**
 * The extent the minimap draws, and the extent `onNavigate` is normalised
 * against. The graph lens uses it to turn a normalised click back into graph
 * coordinates, so both sides stay in lockstep.
 */
export function graphBounds(nodes: readonly GraphPoint[]): GraphBounds {
  if (nodes.length === 0) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.x > maxX) maxX = node.x;
    if (node.y > maxY) maxY = node.y;
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const padX = spanX * PADDING_RATIO;
  const padY = spanY * PADDING_RATIO;

  return { minX: minX - padX, minY: minY - padY, maxX: maxX + padX, maxY: maxY + padY };
}

/** Inverse of the normalisation used when drawing. */
export function normalizedToGraph(bounds: GraphBounds, nx: number, ny: number): GraphPoint {
  return {
    x: bounds.minX + (bounds.maxX - bounds.minX) * nx,
    y: bounds.minY + (bounds.maxY - bounds.minY) * ny,
  };
}

/** CSS custom property → a concrete colour, with a literal fallback for canvas. */
function tokenColor(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}

/**
 * 120×80 overview of the whole escalation graph (Plan §15.5).
 *
 * Every node is a low-alpha dot; the current viewport is a rectangle. Click or
 * drag inside it to move the camera. Purely presentational - it never touches the
 * layout, so panning through it cannot trigger a recompute.
 */
export function GraphMinimap({ nodes, camera, onNavigate }: GraphMinimapProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);

  const width = GRAPH.minimapWidth;
  const height = GRAPH.minimapHeight;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;

    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const bounds = graphBounds(nodes);
    const spanX = Math.max(bounds.maxX - bounds.minX, 1e-6);
    const spanY = Math.max(bounds.maxY - bounds.minY, 1e-6);
    const toCanvasX = (x: number): number => ((x - bounds.minX) / spanX) * width;
    const toCanvasY = (y: number): number => ((y - bounds.minY) / spanY) * height;

    const bg = tokenColor('--graph-bg', '#101318');
    context.fillStyle = bg;
    context.fillRect(0, 0, width, height);

    context.fillStyle = tokenColor('--text-subtle', '#94a3b8');
    context.globalAlpha = 0.55;
    for (const node of nodes) {
      context.fillRect(toCanvasX(node.x) - 0.5, toCanvasY(node.y) - 0.5, 1.5, 1.5);
    }
    context.globalAlpha = 1;

    // The camera state is expressed in graph units, so the viewport rectangle is
    // simply the visible span, centred on the camera target.
    const viewWidth = camera.width * camera.ratio;
    const viewHeight = camera.height * camera.ratio;
    const left = toCanvasX(camera.x - viewWidth / 2);
    const top = toCanvasY(camera.y - viewHeight / 2);
    const rectWidth = Math.max(4, (viewWidth / spanX) * width);
    const rectHeight = Math.max(4, (viewHeight / spanY) * height);

    context.strokeStyle = tokenColor('--accent', '#5b8def');
    context.lineWidth = 1;
    context.strokeRect(
      Math.max(0, Math.min(width - 1, left + 0.5)),
      Math.max(0, Math.min(height - 1, top + 0.5)),
      Math.min(rectWidth, width),
      Math.min(rectHeight, height),
    );
  }, [camera.height, camera.ratio, camera.width, camera.x, camera.y, height, nodes, width]);

  useEffect(() => {
    draw();
  }, [draw]);

  const navigateFromEvent = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const nx = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      onNavigate(nx, ny);
    },
    [onNavigate],
  );

  return (
    <div
      className="overlay-surface absolute right-3 bottom-3 overflow-hidden p-0.5"
      data-testid="graph-minimap"
    >
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={`Graph minimap, ${nodes.length} nodes. Click or drag to move the view.`}
        tabIndex={0}
        style={{ width, height, display: 'block', cursor: 'crosshair' }}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          navigateFromEvent(event);
        }}
        onPointerMove={(event) => {
          if (!draggingRef.current) return;
          navigateFromEvent(event);
        }}
        onPointerUp={(event) => {
          draggingRef.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onKeyDown={(event) => {
          // Keyboard parity with the pointer: arrows pan in 5% steps.
          const step = 0.05;
          const bounds = graphBounds(nodes);
          const current = {
            x: (camera.x - bounds.minX) / Math.max(bounds.maxX - bounds.minX, 1e-6),
            y: (camera.y - bounds.minY) / Math.max(bounds.maxY - bounds.minY, 1e-6),
          };
          if (event.key === 'ArrowLeft') onNavigate(Math.max(0, current.x - step), current.y);
          else if (event.key === 'ArrowRight') onNavigate(Math.min(1, current.x + step), current.y);
          else if (event.key === 'ArrowUp') onNavigate(current.x, Math.max(0, current.y - step));
          else if (event.key === 'ArrowDown') onNavigate(current.x, Math.min(1, current.y + step));
          else return;
          event.preventDefault();
        }}
        className={cn(
          'rounded-input outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      />
    </div>
  );
}
