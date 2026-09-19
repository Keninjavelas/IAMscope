/**
 * IAM wildcard matching (Plan §10.4).
 *
 * `*` matches zero or more characters, `?` matches exactly one. Patterns are compiled into
 * **anchored** regular expressions so `s3:Get*` never matches `s3:GetObjectVersion`'s suffix
 * of a longer unrelated action by accident.
 */

const ESCAPE_PATTERN = /[.*+?^${}()|[\]\\]/g;

export function escapeRegExp(value: string): string {
  return value.replace(ESCAPE_PATTERN, '\\$&');
}

const cache = new Map<string, RegExp>();
const CACHE_LIMIT = 2_000;

/** Compiles a glob-ish IAM pattern into an anchored `RegExp`. */
export function wildcardToRegExp(pattern: string, caseInsensitive = false): RegExp {
  const key = `${caseInsensitive ? 'i' : 's'}:${pattern}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  let source = '';
  for (const char of pattern) {
    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else {
      source += escapeRegExp(char);
    }
  }

  const regex = new RegExp(`^${source}$`, caseInsensitive ? 'i' : '');
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, regex);
  return regex;
}

/** `true` when `candidate` matches the IAM pattern. */
export function matchesWildcard(
  pattern: string,
  candidate: string,
  caseInsensitive = false,
): boolean {
  return wildcardToRegExp(pattern, caseInsensitive).test(candidate);
}

/**
 * Action matching. AWS action names are case-insensitive, so `s3:getobject` == `s3:GetObject`.
 */
export function matchesAction(pattern: string, action: string): boolean {
  if (pattern === '*') return true;
  return matchesWildcard(pattern, action, true);
}

/** Resource matching. ARNs are compared case-sensitively. */
export function matchesResource(pattern: string, resourceArn: string): boolean {
  if (pattern === '*') return true;
  return matchesWildcard(pattern, resourceArn, false);
}

/** `true` when any pattern in `patterns` matches the action. */
export function anyActionMatches(patterns: readonly string[], action: string): boolean {
  return patterns.some((pattern) => matchesAction(pattern, action));
}

/** `true` when any pattern in `patterns` matches the resource ARN. */
export function anyResourceMatches(patterns: readonly string[], resourceArn: string): boolean {
  return patterns.some((pattern) => matchesResource(pattern, resourceArn));
}

/** Exposed for tests so a cached pattern does not leak across cases. */
export function clearWildcardCache(): void {
  cache.clear();
}
