import { useMemo, useState, type JSX } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export type JsonDiffMode = 'word' | 'line';
export type DiffKind = 'same' | 'added' | 'removed' | 'changed';

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface JsonDiffLine {
  /** `/`-separated path header, e.g. `Statement/0/Effect`. */
  path: string;
  kind: DiffKind;
  before?: string | undefined;
  after?: string | undefined;
  beforeSegments?: DiffSegment[] | undefined;
  afterSegments?: DiffSegment[] | undefined;
}

/* ------------------------------------------------------------------ */
/* Flattening                                                         */
/* ------------------------------------------------------------------ */

function stringifyLeaf(value: unknown): string {
  if (value === undefined) return 'undefined';
  // `JSON.stringify` is declared as returning `string`, but it actually returns
  // `undefined` for functions and symbols. Asserting the real signature is what makes
  // the check below honest; guessing with `String(value)` would render a whole function
  // body into the diff.
  const json = JSON.stringify(value) as string | undefined;
  if (json === undefined) return `[${typeof value}]`;
  return json;
}

/** Flatten a JSON value to `path -> leaf text`. Order is insertion order. */
export function flattenJson(value: unknown, base = ''): [string, string][] {
  const out: [string, string][] = [];

  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      if (node.length === 0) out.push([path, '[]']);
      node.forEach((entry, index) => walk(entry, path === '' ? String(index) : `${path}/${index}`));
      return;
    }
    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length === 0) out.push([path, '{}']);
      for (const [key, entry] of entries) walk(entry, path === '' ? key : `${path}/${key}`);
      return;
    }
    out.push([path === '' ? '(root)' : path, stringifyLeaf(node)]);
  };

  walk(value, base);
  return out;
}

/* ------------------------------------------------------------------ */
/* Word-level diff (bounded LCS)                                      */
/* ------------------------------------------------------------------ */

const MAX_TOKENS_FOR_LCS = 400;

function tokenise(text: string): string[] {
  return text.match(/[\w$.:\-/]+|\s+|[^\w\s]|./g) ?? [text];
}

function lcsMatrix(a: readonly string[], b: readonly string[]): number[][] {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      const row = table[i];
      const nextRow = table[i + 1];
      if (!row || !nextRow) continue;
      row[j] =
        a[i] === b[j] ? (nextRow[j + 1] ?? 0) + 1 : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  return table;
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last?.changed === segment.changed) {
      last.text += segment.text;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

/** Word-level diff. `before` is marked where tokens were dropped/edited. */
export function diffWords(
  before: string,
  after: string,
): {
  before: DiffSegment[];
  after: DiffSegment[];
} {
  const a = tokenise(before);
  const b = tokenise(after);

  if (a.length > MAX_TOKENS_FOR_LCS || b.length > MAX_TOKENS_FOR_LCS) {
    return {
      before: [{ text: before, changed: true }],
      after: [{ text: after, changed: true }],
    };
  }

  const table = lcsMatrix(a, b);
  const beforeSegments: DiffSegment[] = [];
  const afterSegments: DiffSegment[] = [];

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i] ?? '';
    const right = b[j] ?? '';
    if (left === right) {
      beforeSegments.push({ text: left, changed: false });
      afterSegments.push({ text: right, changed: false });
      i += 1;
      j += 1;
      continue;
    }
    const skipLeft = table[i + 1]?.[j] ?? 0;
    const skipRight = table[i]?.[j + 1] ?? 0;
    if (skipLeft >= skipRight) {
      beforeSegments.push({ text: left, changed: true });
      i += 1;
    } else {
      afterSegments.push({ text: right, changed: true });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) beforeSegments.push({ text: a[i] ?? '', changed: true });
  for (; j < b.length; j += 1) afterSegments.push({ text: b[j] ?? '', changed: true });

  return { before: mergeSegments(beforeSegments), after: mergeSegments(afterSegments) };
}

/* ------------------------------------------------------------------ */
/* Line builder                                                       */
/* ------------------------------------------------------------------ */

export function buildDiffLines(
  before: unknown,
  after: unknown,
  mode: JsonDiffMode,
): JsonDiffLine[] {
  const left = new Map(flattenJson(before));
  const right = new Map(flattenJson(after));
  const paths: string[] = [];
  for (const path of left.keys()) paths.push(path);
  for (const path of right.keys()) if (!left.has(path)) paths.push(path);

  const lines: JsonDiffLine[] = [];
  for (const path of paths) {
    const hasBefore = left.has(path);
    const hasAfter = right.has(path);
    const beforeText = left.get(path) ?? '';
    const afterText = right.get(path) ?? '';

    if (hasBefore && !hasAfter) {
      lines.push({ path, kind: 'removed', before: beforeText });
      continue;
    }
    if (!hasBefore && hasAfter) {
      lines.push({ path, kind: 'added', after: afterText });
      continue;
    }
    if (beforeText === afterText) {
      lines.push({ path, kind: 'same', before: beforeText, after: afterText });
      continue;
    }
    if (mode === 'word') {
      const words = diffWords(beforeText, afterText);
      lines.push({
        path,
        kind: 'changed',
        before: beforeText,
        after: afterText,
        beforeSegments: words.before,
        afterSegments: words.after,
      });
      continue;
    }
    lines.push({ path, kind: 'changed', before: beforeText, after: afterText });
  }

  return lines;
}

/* ------------------------------------------------------------------ */
/* Presentation                                                       */
/* ------------------------------------------------------------------ */

export interface JsonDiffProps {
  before: unknown;
  after: unknown;
  mode?: JsonDiffMode | undefined;
  title?: string | undefined;
  collapsedByDefault?: boolean | undefined;
}

const KIND_GUTTER: Record<DiffKind, string> = {
  same: ' ',
  added: '+',
  removed: '-',
  changed: '~',
};

function Segments({
  segments,
  fallback,
}: {
  segments: DiffSegment[] | undefined;
  fallback: string;
}): JSX.Element {
  if (!segments) return <span>{fallback}</span>;
  return (
    <>
      {segments.map((segment, index) => (
        <span
          key={index}
          className={cn(segment.changed && 'diff-changed rounded-[2px] px-0.5 font-medium')}
        >
          {segment.text}
        </span>
      ))}
    </>
  );
}

export function JsonDiff({
  before,
  after,
  mode = 'word',
  title,
  collapsedByDefault = false,
}: JsonDiffProps): JSX.Element {
  const [showUnchanged, setShowUnchanged] = useState(!collapsedByDefault);

  const lines = useMemo(() => buildDiffLines(before, after, mode), [after, before, mode]);

  const counts = useMemo(() => {
    let added = 0;
    let removed = 0;
    let changed = 0;
    let unchanged = 0;
    for (const line of lines) {
      if (line.kind === 'added') added += 1;
      else if (line.kind === 'removed') removed += 1;
      else if (line.kind === 'changed') changed += 1;
      else unchanged += 1;
    }
    return { added, removed, changed, unchanged };
  }, [lines]);

  const visible = showUnchanged ? lines : lines.filter((line) => line.kind !== 'same');
  const identical = counts.added === 0 && counts.removed === 0 && counts.changed === 0;

  return (
    <section className="panel flex flex-col overflow-hidden" aria-label={title ?? 'JSON diff'}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {title ? <h3 className="text-13 font-medium text-text">{title}</h3> : null}
          <p className="text-micro flex items-center gap-2 text-text-muted" aria-live="polite">
            <span className="diff-added rounded-[3px] px-1 font-medium tabular">
              +{counts.added}
            </span>
            <span className="diff-removed rounded-[3px] px-1 font-medium tabular">
              -{counts.removed}
            </span>
            <span className="diff-changed rounded-[3px] px-1 font-medium tabular">
              ~{counts.changed}
            </span>
            <span className="text-text-subtle tabular">{counts.unchanged} unchanged</span>
          </p>
        </div>

        <button
          type="button"
          aria-expanded={showUnchanged}
          onClick={() => setShowUnchanged((previous) => !previous)}
          className="text-12 dur-fast inline-flex items-center gap-1 rounded-input px-1.5 py-0.5 text-text-muted outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {showUnchanged ? (
            <ChevronDown aria-hidden="true" className="size-3.5" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-3.5" />
          )}
          {showUnchanged ? 'Hide unchanged' : `Show ${counts.unchanged} unchanged`}
        </button>
      </header>

      {identical ? (
        <p className="text-meta px-3 py-6 text-center text-text-muted">
          No differences - the two values are identical.
        </p>
      ) : (
        <ol className="mono max-h-[520px] overflow-auto text-12 leading-relaxed">
          {visible.map((line, index) => (
            <li
              key={`${line.path}-${line.kind}-${index}`}
              className="border-b border-border-subtle last:border-b-0"
            >
              <div className="flex items-center gap-2 px-2 py-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    'w-3 shrink-0 text-center font-semibold',
                    line.kind === 'added' && 'text-diff-added',
                    line.kind === 'removed' && 'text-diff-removed',
                    line.kind === 'changed' && 'text-diff-changed',
                    line.kind === 'same' && 'text-text-subtle',
                  )}
                >
                  {KIND_GUTTER[line.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-subtle" title={line.path}>
                  {line.path}
                </span>
                <span className="sr-only">
                  {line.kind === 'same'
                    ? 'unchanged'
                    : line.kind === 'added'
                      ? 'added'
                      : line.kind === 'removed'
                        ? 'removed'
                        : 'changed'}
                </span>
              </div>

              {line.kind === 'same' ? (
                <p className="px-2 pb-1 pl-7 text-text-muted">{line.before}</p>
              ) : null}

              {line.kind === 'added' ? (
                <p className="diff-added px-2 pb-1 pl-7 rounded-[2px]">
                  <Segments segments={undefined} fallback={line.after ?? ''} />
                </p>
              ) : null}

              {line.kind === 'removed' ? (
                <p className="diff-removed px-2 pb-1 pl-7 rounded-[2px] line-through decoration-diff-removed/60">
                  <Segments segments={undefined} fallback={line.before ?? ''} />
                </p>
              ) : null}

              {line.kind === 'changed' ? (
                <>
                  <p className="diff-removed px-2 pb-0.5 pl-7">
                    <Segments segments={line.beforeSegments} fallback={line.before ?? ''} />
                  </p>
                  <p className="diff-added px-2 pb-1 pl-7">
                    <Segments segments={line.afterSegments} fallback={line.after ?? ''} />
                  </p>
                </>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
