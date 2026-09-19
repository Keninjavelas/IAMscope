/**
 * NOTE(shared): `packages/tokens` exports `presenceColorFor(seed)` but `@iamscope/tokens` is not
 * a declared backend dependency, so the function is mirrored here verbatim to keep
 * `backend/package.json` honest. If `@iamscope/tokens` is ever added to the backend deps,
 * delete this module and import from the package instead.
 */

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
