/** URL-safe slug generation for organizations (Plan §7.1 `orgs.slug`). */

export function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (base.length >= 3) return base.slice(0, 48);

  const padded = `org-${base}`.replace(/-+$/g, '');
  return padded.length >= 3 ? padded.slice(0, 48) : 'org-1';
}

export function withNumericSuffix(slug: string, attempt: number): string {
  const suffix = `-${attempt}`;
  return `${slug.slice(0, 48 - suffix.length)}${suffix}`;
}

/**
 * Resolves a slug that is not yet taken. `exists` is injected so this stays pure/testable.
 */
export async function uniqueSlug(
  desired: string,
  exists: (candidate: string) => Promise<boolean>,
  maxAttempts = 50,
): Promise<string> {
  const base = slugify(desired);
  if (!(await exists(base))) return base;

  for (let attempt = 2; attempt < maxAttempts + 2; attempt += 1) {
    const candidate = withNumericSuffix(base, attempt);

    if (!(await exists(candidate))) return candidate;
  }

  return withNumericSuffix(base, Date.now() % 100_000);
}
