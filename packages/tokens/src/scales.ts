/**
 * JS mirror of the CSS scales from Plan §15.2. Kept in sync with tokens.css by hand -
 * anything that needs a pixel value in TypeScript (virtualized row heights, graph
 * layout, canvas rendering) reads it from here instead of hard-coding numbers.
 */

export const TYPE_SCALE = [11, 12, 13, 14, 16, 20, 28] as const;
export type TypeStep = (typeof TYPE_SCALE)[number];

export const SPACING_SCALE = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64] as const;
export type SpacingStep = (typeof SPACING_SCALE)[number];

export const RADIUS = {
  input: 4,
  card: 6,
  panel: 8,
  modal: 12,
  full: 9999,
} as const;
export type RadiusKey = keyof typeof RADIUS;

export const ELEVATION = {
  0: 'none',
  1: '0 1px 2px oklch(0 0 0 / 0.4)',
  2: '0 8px 24px oklch(0 0 0 / 0.45)',
} as const;
export type ElevationKey = keyof typeof ELEVATION;

export const DURATION = {
  instant: 80,
  fast: 140,
  normal: 220,
  slow: 320,
} as const;
export type DurationKey = keyof typeof DURATION;

export const EASING = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
} as const;
export type EasingKey = keyof typeof EASING;

export const FONT_STACK = {
  sans: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Berkeley Mono', 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export interface DensitySpec {
  id: 'compact' | 'comfortable' | 'spacious';
  label: string;
  rowHeight: number;
  fontSize: number;
  controlHeight: number;
  cellPaddingX: number;
  cellPaddingY: number;
}

/** Density is a feature (Plan §15.1) - vite configs, tables and the graph all read this. */
export const DENSITY: Record<DensitySpec['id'], DensitySpec> = {
  compact: {
    id: 'compact',
    label: 'Compact',
    rowHeight: 28,
    fontSize: 12,
    controlHeight: 28,
    cellPaddingX: 8,
    cellPaddingY: 4,
  },
  comfortable: {
    id: 'comfortable',
    label: 'Comfortable',
    rowHeight: 36,
    fontSize: 13,
    controlHeight: 32,
    cellPaddingX: 12,
    cellPaddingY: 8,
  },
  spacious: {
    id: 'spacious',
    label: 'Spacious',
    rowHeight: 44,
    fontSize: 14,
    controlHeight: 38,
    cellPaddingX: 16,
    cellPaddingY: 12,
  },
};

export const ACCENTS = ['blue', 'violet', 'teal', 'amber', 'rose', 'green'] as const;
export type Accent = (typeof ACCENTS)[number];

/** Hue used for presence cursors, derived deterministically from a user id. */
export const PRESENCE_COLORS = [
  'oklch(0.68 0.16 250)',
  'oklch(0.65 0.19 295)',
  'oklch(0.68 0.13 190)',
  'oklch(0.75 0.15 80)',
  'oklch(0.66 0.19 10)',
  'oklch(0.68 0.15 150)',
] as const;

export function presenceColorFor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) % 1_000_003;
  }
  const color = PRESENCE_COLORS[hash % PRESENCE_COLORS.length];
  return color ?? PRESENCE_COLORS[0];
}

/** Graph lens constants (Plan §15.5). */
export const GRAPH = {
  minimapWidth: 120,
  minimapHeight: 80,
  hopAnimationMs: 80,
  dimOpacity: 0.1,
  semanticZoomClusterThreshold: 0.35,
  semanticZoomLabelThreshold: 0.75,
  focusDepth: 2,
  defaultMaxDepth: 5,
} as const;

export const TABLE = {
  virtualizationThreshold: 100,
  overscan: 12,
} as const;

export const MOTION = {
  toastDurationMs: 8000,
  presenceHeartbeatMs: 20_000,
  presenceTtlSeconds: 60,
  sseHeartbeatMs: 20_000,
  sseMaxBackoffMs: 30_000,
  evaluationDebounceMs: 500,
} as const;
