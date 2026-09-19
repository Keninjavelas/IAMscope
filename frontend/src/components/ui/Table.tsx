import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Check, Minus } from 'lucide-react';
import { DENSITY, TABLE } from '@iamscope/tokens';
import type { DensityMode } from '@iamscope/types';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

export interface Column<T> {
  id: string;
  header: ReactNode;
  accessor: (row: T) => ReactNode;
  width?: number | undefined;
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  sortable?: boolean | undefined;
  align?: 'left' | 'right' | 'center' | undefined;
  mono?: boolean | undefined;
  truncate?: boolean | undefined;
}

export interface SortState {
  id: string;
  desc: boolean;
}

export interface TableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  getRowId: (row: T) => string;
  loading?: boolean | undefined;
  sort?: SortState | null | undefined;
  onSortChange?: ((next: SortState | null) => void) | undefined;
  onRowClick?: ((row: T) => void) | undefined;
  rowActions?: ((row: T) => ReactNode) | undefined;
  emptyState?: ReactNode | undefined;
  selectedIds?: readonly string[] | undefined;
  onSelectionChange?: ((ids: string[]) => void) | undefined;
  stickyHeader?: boolean | undefined;
  virtualize?: boolean | undefined;
  className?: string | undefined;
  density?: DensityMode | undefined;
  /** Rendered while `loading` - defaults to skeleton rows matching the layout. */
  loadingState?: ReactNode | undefined;
}

function columnStyle<T>(column: Column<T>): CSSProperties {
  return {
    width: column.width,
    minWidth: column.minWidth,
    maxWidth: column.maxWidth,
  };
}

function alignClass(align: Column<unknown>['align']): string {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

/**
 * Virtualized, sortable, keyboard-navigable table (Plan §15.3, §20).
 *
 * Virtualization keeps real `<table>` semantics: out-of-window rows are replaced
 * by two spacer rows sized exactly to the skipped height, so screen readers and
 * sticky headers both keep working while 10k rows scroll at 60fps.
 */
export function Table<T>({
  columns,
  rows,
  getRowId,
  loading = false,
  sort = null,
  onSortChange,
  onRowClick,
  rowActions,
  emptyState,
  selectedIds,
  onSelectionChange,
  stickyHeader = true,
  virtualize = true,
  className,
  density,
  loadingState,
}: TableProps<T>): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const storeDensity = useUiStore((state) => state.density);
  const resolvedDensity = density ?? storeDensity;
  const rowHeight = DENSITY[resolvedDensity].rowHeight;

  const selectable = selectedIds !== undefined && onSelectionChange !== undefined;
  const hasActions = rowActions !== undefined;
  const columnCount = columns.length + (selectable ? 1 : 0) + (hasActions ? 1 : 0);

  const shouldVirtualize = virtualize && rows.length > TABLE.virtualizationThreshold;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: TABLE.overscan,
    enabled: shouldVirtualize,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const visibleEntries = useMemo<{ row: T; index: number }[]>(() => {
    if (!shouldVirtualize) return rows.map((row, index) => ({ row, index }));
    return virtualItems.flatMap((item) => {
      const row = rows[item.index];
      return row === undefined ? [] : [{ row, index: item.index }];
    });
  }, [rows, shouldVirtualize, virtualItems]);

  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      virtualizer.measure();
    },
    [virtualizer],
  );

  // Re-measure when density changes: the row height token moved.
  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const handleSort = (column: Column<T>): void => {
    if (!onSortChange || column.sortable !== true) return;
    if (sort?.id !== column.id) {
      onSortChange({ id: column.id, desc: false });
      return;
    }
    if (!sort.desc) {
      onSortChange({ id: column.id, desc: true });
      return;
    }
    onSortChange(null);
  };

  const toggleRow = (id: string): void => {
    // `selectable` is an aliased condition over both props, so TypeScript already knows
    // they are defined here.
    if (!selectable) return;
    const set = new Set(selectedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    onSelectionChange([...set]);
  };

  const allSelected = rows.length > 0 && (selectedIds?.length ?? 0) === rows.length;
  const someSelected = (selectedIds?.length ?? 0) > 0 && !allSelected;

  const handleRowKeyDown = (
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    row: T,
    index: number,
  ): void => {
    const focusRow = (nextIndex: number): void => {
      const clamped = Math.min(Math.max(nextIndex, 0), rows.length - 1);
      const target = scrollRef.current?.querySelector<HTMLTableRowElement>(
        `[data-row-index="${clamped}"]`,
      );
      target?.focus();
      target?.scrollIntoView({ block: 'nearest' });
    };

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusRow(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusRow(0);
        break;
      case 'End':
        event.preventDefault();
        focusRow(rows.length - 1);
        break;
      case ' ':
        if (selectable) {
          event.preventDefault();
          toggleRow(getRowId(row));
        }
        break;
      case 'Enter':
        if (onRowClick) {
          event.preventDefault();
          onRowClick(row);
        }
        break;
      default:
        break;
    }
  };

  const totalSize = virtualizer.getTotalSize();
  const paddingTop = shouldVirtualize && virtualItems[0] ? virtualItems[0].start : 0;
  const lastItem = virtualItems[virtualItems.length - 1];
  const paddingBottom = shouldVirtualize && lastItem ? Math.max(0, totalSize - lastItem.end) : 0;

  if (loading) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {loadingState ?? (
          <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col">
            <span className="sr-only">Loading rows</span>
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="flex items-center gap-3 border-b border-border-subtle px-2"
                style={{ height: rowHeight }}
              >
                {columns.map((column) => (
                  <span
                    key={column.id}
                    aria-hidden="true"
                    className="skeleton block h-3"
                    style={{ width: column.width ?? 120, flex: column.width ? undefined : '1 1 0' }}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (rows.length === 0 && emptyState !== undefined) {
    return (
      <div className={cn('panel overflow-hidden', className)}>
        <div className="min-h-40">{emptyState}</div>
      </div>
    );
  }

  return (
    <div
      ref={measureRef}
      className={cn('panel relative overflow-auto', className)}
      style={{ maxHeight: '100%' }}
    >
      <table
        className="w-full border-collapse"
        style={{ fontSize: 'var(--row-font-size)' }}
        aria-rowcount={rows.length}
      >
        <thead className={cn('z-10 bg-bg-raised', stickyHeader ? 'sticky top-0' : 'relative')}>
          <tr className="border-b border-border">
            {selectable ? (
              <th scope="col" className="w-8 px-2 py-0">
                <RadixCheckbox.Root
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={(next) => {
                    onSelectionChange(next === true ? rows.map(getRowId) : []);
                  }}
                  aria-label={allSelected ? 'Clear selection' : 'Select all rows'}
                  className="dur-fast flex size-3.5 items-center justify-center rounded-[3px] border border-border-strong bg-bg-inset outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=checked]:border-accent data-[state=checked]:bg-accent"
                >
                  <RadixCheckbox.Indicator>
                    {someSelected ? (
                      <Minus aria-hidden="true" className="size-2.5 text-accent-contrast" />
                    ) : (
                      <Check aria-hidden="true" className="size-2.5 text-accent-contrast" />
                    )}
                  </RadixCheckbox.Indicator>
                </RadixCheckbox.Root>
              </th>
            ) : null}

            {columns.map((column) => {
              const isSorted = sort?.id === column.id;
              const ariaSort = isSorted ? (sort.desc ? 'descending' : 'ascending') : undefined;
              return (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={ariaSort}
                  style={columnStyle(column)}
                  className={cn(
                    'text-12 font-medium whitespace-nowrap text-text-muted',
                    'px-[var(--cell-padding-x)] py-[var(--cell-padding-y)]',
                    alignClass(column.align),
                  )}
                >
                  {column.sortable === true && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => handleSort(column)}
                      className={cn(
                        'dur-fast inline-flex items-center gap-1 rounded-input outline-none hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                        column.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {column.header}
                      {isSorted ? (
                        sort.desc ? (
                          <ArrowDown aria-hidden="true" className="size-3" />
                        ) : (
                          <ArrowUp aria-hidden="true" className="size-3" />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}

            {hasActions ? (
              <th scope="col" className="w-10 px-2 py-0">
                <span className="sr-only">Row actions</span>
              </th>
            ) : null}
          </tr>
        </thead>

        <tbody>
          {paddingTop > 0 ? (
            <tr aria-hidden="true" style={{ height: paddingTop }}>
              <td colSpan={columnCount} />
            </tr>
          ) : null}

          {visibleEntries.map(({ row, index }) => {
            const id = getRowId(row);
            const selected = selectedIds?.includes(id) ?? false;
            return (
              <tr
                key={id}
                data-row-index={index}
                tabIndex={-1}
                aria-selected={selected}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={(event) => handleRowKeyDown(event, row, index)}
                className={cn(
                  'dur-fast border-b border-border-subtle outline-none transition-colors last:border-b-0',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
                  selected ? 'bg-bg-selected' : 'hover:bg-bg-hover',
                  onRowClick && 'cursor-pointer',
                )}
                style={{ height: rowHeight }}
              >
                {selectable ? (
                  <td className="w-8 px-2" onClick={(event) => event.stopPropagation()}>
                    <RadixCheckbox.Root
                      checked={selected}
                      onCheckedChange={() => toggleRow(id)}
                      aria-label={selected ? `Deselect row` : `Select row`}
                      className="dur-fast flex size-3.5 items-center justify-center rounded-[3px] border border-border-strong bg-bg-inset outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-[state=checked]:border-accent data-[state=checked]:bg-accent"
                    >
                      <RadixCheckbox.Indicator>
                        <Check aria-hidden="true" className="size-2.5 text-accent-contrast" />
                      </RadixCheckbox.Indicator>
                    </RadixCheckbox.Root>
                  </td>
                ) : null}

                {columns.map((column) => (
                  <td
                    key={column.id}
                    style={columnStyle(column)}
                    className={cn(
                      'px-[var(--cell-padding-x)] py-0 align-middle',
                      alignClass(column.align),
                      column.mono && 'mono text-12',
                      column.truncate && 'max-w-0 truncate',
                    )}
                  >
                    {column.accessor(row)}
                  </td>
                ))}

                {hasActions ? (
                  <td className="w-10 px-2 text-right" onClick={(event) => event.stopPropagation()}>
                    {rowActions(row)}
                  </td>
                ) : null}
              </tr>
            );
          })}

          {paddingBottom > 0 ? (
            <tr aria-hidden="true" style={{ height: paddingBottom }}>
              <td colSpan={columnCount} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
