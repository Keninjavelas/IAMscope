import { useCallback, useMemo, useState, type JSX } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FilterX, Search, SlidersHorizontal } from 'lucide-react';
import { useAttribution, useAuditEvents } from '@/api/queries';
import type { AuditFilters } from '@/api/params';
import { AuditTimeline } from '@/components/domain/AuditTimeline';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { Toolbar, ToolbarSpacer } from '@/components/ui/Toolbar';
import { formatDate } from '@/lib/format';
import { useActiveOrgId, useSessionReady } from '@/stores/session';
import { AttributionPanel } from '@/features/impact/components/AttributionPanel';

const PAGE_SIZE = 50;

const TARGET_TYPES = [
  { value: '', label: 'Any target' },
  { value: 'policy', label: 'Policy' },
  { value: 'policy_version', label: 'Policy version' },
  { value: 'principal', label: 'Principal' },
  { value: 'resource', label: 'Resource' },
  { value: 'scenario', label: 'Scenario' },
  { value: 'membership', label: 'Membership' },
  { value: 'apikey', label: 'API key' },
  { value: 'org', label: 'Organization' },
];

interface DraftFilters {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
  q: string;
}

const EMPTY_DRAFT: DraftFilters = {
  actorId: '',
  action: '',
  targetType: '',
  targetId: '',
  from: '',
  to: '',
  q: '',
};

/** `datetime-local` values are local time; the API expects ISO instants. */
function toIso(local: string): string | undefined {
  if (local.trim() === '') return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** …and back, for refilling the inputs from the URL. */
function toLocalInput(iso: string): string {
  if (iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

/**
 * The audit explorer (Plan §8.11, §12.4).
 *
 * Every filter lives in the URL, so a view can be pasted into an incident ticket.
 * Arriving with `?scenarioId=&before=&after=` opens the attribution panel, which
 * explains which recorded edit caused that scenario's decision to flip.
 */
export default function AuditPage(): JSX.Element {
  const orgId = useActiveOrgId();
  const ready = useSessionReady();
  const [params, setParams] = useSearchParams();

  const scenarioId = params.get('scenarioId');
  const before = params.get('before');
  const after = params.get('after');

  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);

  const [draft, setDraft] = useState<DraftFilters>(() => ({
    actorId: params.get('actorId') ?? '',
    action: params.get('action') ?? '',
    targetType: params.get('targetType') ?? '',
    targetId: params.get('targetId') ?? '',
    from: toLocalInput(params.get('from') ?? ''),
    to: toLocalInput(params.get('to') ?? ''),
    q: params.get('q') ?? '',
  }));

  const filters = useMemo<AuditFilters>(() => {
    const next: AuditFilters = { page, pageSize: PAGE_SIZE };
    if (draft.actorId.trim() !== '') next.actorId = draft.actorId.trim();
    if (draft.action.trim() !== '') next.action = draft.action.trim();
    if (draft.targetType !== '') next.targetType = draft.targetType;
    if (draft.targetId.trim() !== '') next.targetId = draft.targetId.trim();
    if (draft.q.trim() !== '') next.q = draft.q.trim();
    const from = toIso(draft.from);
    if (from !== undefined) next.from = from;
    const to = toIso(draft.to);
    if (to !== undefined) next.to = to;
    return next;
  }, [draft, page]);

  const events = useAuditEvents(orgId, filters, { enabled: ready });
  const attribution = useAttribution(orgId, scenarioId, before, after, { enabled: ready });

  const commit = useCallback(
    (
      next: AuditFilters,
      extra: { scenarioId?: string | null; before?: string | null; after?: string | null } = {},
    ): void => {
      const merged = new URLSearchParams();
      const entries: [string, string | number | undefined][] = [
        ['actorId', next.actorId],
        ['action', next.action],
        ['targetType', next.targetType],
        ['targetId', next.targetId],
        ['from', next.from],
        ['to', next.to],
        ['q', next.q],
        ['page', next.page === undefined || next.page <= 1 ? undefined : next.page],
      ];
      for (const [key, value] of entries) {
        if (value !== undefined && value !== '') merged.set(key, String(value));
      }
      for (const [key, value] of Object.entries(extra)) {
        if (value !== null && value !== '') merged.set(key, value);
      }
      setParams(merged, { replace: true });
    },
    [setParams],
  );

  const applyFilters = useCallback(
    (nextPage: number): void => {
      const next: AuditFilters = { ...filters, page: nextPage };
      commit(next, { scenarioId, before, after });
    },
    [after, before, commit, filters, scenarioId],
  );

  const reset = useCallback((): void => {
    setDraft(EMPTY_DRAFT);
    commit({ page: 1 }, {});
  }, [commit]);

  const items = events.data?.items ?? [];
  const total = events.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const highlightIds = useMemo(
    () => (attribution.data?.causes ?? []).map((cause) => cause.auditEventId),
    [attribution.data],
  );

  const activeFilterCount = Object.values(filters).filter(
    (value) => value !== undefined && value !== '' && value !== PAGE_SIZE && value !== page,
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
      <PageHeader
        title="Audit log"
        description="Every mutation, with the exact before and after values. Filters live in the URL so a view can be shared."
        actions={
          <span className="text-micro text-text-subtle">
            {total} event{total === 1 ? '' : 's'}
            {activeFilterCount === 0
              ? ''
              : ` · ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'}`}
          </span>
        }
      />

      {scenarioId === null ? null : (
        <AttributionPanel
          attribution={attribution.data ?? null}
          loading={attribution.isLoading || attribution.isFetching}
          {...(attribution.error === null ? {} : { error: attribution.error })}
          onRetry={() => void attribution.refetch()}
          onClear={() => commit({ ...filters }, { scenarioId: null, before: null, after: null })}
        />
      )}

      <Toolbar label="Audit filters">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilters(1);
          }}
        >
          <div className="w-52">
            <Input
              label="Actor"
              inputSize="sm"
              value={draft.actorId}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, actorId: event.target.value }))
              }
              placeholder="User or API key id"
            />
          </div>

          <div className="w-48">
            <Input
              label="Action"
              inputSize="sm"
              mono
              value={draft.action}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, action: event.target.value }))
              }
              placeholder="policy.update"
            />
          </div>

          <div className="w-40">
            <Select
              label="Target type"
              size="sm"
              value={draft.targetType}
              onValueChange={(value) =>
                setDraft((previous) => ({ ...previous, targetType: value }))
              }
              options={TARGET_TYPES}
              ariaLabel="Target type"
            />
          </div>

          <div className="w-48">
            <Input
              label="Target id"
              inputSize="sm"
              mono
              value={draft.targetId}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, targetId: event.target.value }))
              }
              placeholder="Object id"
            />
          </div>

          <div className="w-48">
            <Input
              label="From"
              inputSize="sm"
              type="datetime-local"
              value={draft.from}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, from: event.target.value }))
              }
            />
          </div>

          <div className="w-48">
            <Input
              label="To"
              inputSize="sm"
              type="datetime-local"
              value={draft.to}
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, to: event.target.value }))
              }
            />
          </div>

          <div className="w-56">
            <Input
              label="Free text"
              inputSize="sm"
              type="search"
              value={draft.q}
              onChange={(event) => setDraft((previous) => ({ ...previous, q: event.target.value }))}
              placeholder="Anything in the payload"
              prefix={<Search aria-hidden="true" className="size-3.5" />}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="sm"
            iconLeft={SlidersHorizontal}
            loading={events.isFetching}
          >
            Apply
          </Button>
          <Button type="button" variant="ghost" size="sm" iconLeft={FilterX} onClick={reset}>
            Reset
          </Button>

          <ToolbarSpacer />
        </form>
      </Toolbar>

      <AuditTimeline
        events={items}
        attribution={attribution.data ?? null}
        loading={events.isLoading}
        highlightIds={highlightIds}
        className="max-h-[65vh]"
      />

      <nav className="flex items-center justify-between gap-3" aria-label="Pagination">
        <Button
          variant="secondary"
          size="sm"
          iconLeft={ChevronLeft}
          disabled={page <= 1}
          onClick={() => applyFilters(page - 1)}
        >
          Previous
        </Button>
        <span className="text-12 text-text-muted tabular">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="secondary"
          size="sm"
          iconRight={ChevronRight}
          disabled={page >= pageCount}
          onClick={() => applyFilters(page + 1)}
        >
          Next
        </Button>
      </nav>

      {items.length === 0 && !events.isLoading ? (
        <p className="text-micro text-center text-text-subtle">
          Nothing recorded for {formatDate(new Date().toISOString(), 'MMMM d, yyyy')} with these
          filters.
        </p>
      ) : null}
    </div>
  );
}
