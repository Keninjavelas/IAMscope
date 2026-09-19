/** Tiny class-name joiner. No dependency, no runtime cost, falsy values dropped. */
export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | readonly ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...values: ClassValue[]): string {
  const out: string[] = [];

  for (const value of values) {
    if (!value) continue;

    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
      continue;
    }

    if (Array.isArray(value)) {
      const nested = cn(...(value as readonly ClassValue[]));
      if (nested) out.push(nested);
      continue;
    }

    if (typeof value === 'object') {
      for (const [key, enabled] of Object.entries(value)) {
        if (enabled) out.push(key);
      }
    }
  }

  return out.join(' ');
}
