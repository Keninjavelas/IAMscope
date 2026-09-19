import { useMemo, useState, type ReactNode, type JSX } from 'react';
import { Command } from 'cmdk';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { Popover } from './Popover';
import { cn } from '@/lib/cn';

export interface ComboboxItem {
  value: string;
  label: string;
  description?: string | undefined;
  group?: string | undefined;
  /** Extra text that should match the query (ARNs, tags). */
  keywords?: readonly string[] | undefined;
  disabled?: boolean | undefined;
  /** Rendered at the right edge of the row (badges, status). */
  meta?: ReactNode | undefined;
}

export interface ComboboxProps {
  value: string | null;
  onChange: (next: string | null) => void;
  items: readonly ComboboxItem[];
  placeholder?: string | undefined;
  emptyMessage?: string | undefined;
  allowClear?: boolean | undefined;
  disabled?: boolean | undefined;
  /** Accessible name for the trigger. */
  label?: ReactNode | undefined;
  error?: string | null | undefined;
  className?: string | undefined;
  searchPlaceholder?: string | undefined;
}

/**
 * Popover + cmdk (Plan §5.2/§15.3). cmdk owns the fuzzy match and the arrow-key
 * navigation; Radix owns the focus restore. The trigger is a real button so it
 * is reachable and named.
 */
export function Combobox({
  value,
  onChange,
  items,
  placeholder = 'Select…',
  emptyMessage = 'No matches',
  allowClear = false,
  disabled = false,
  label,
  error,
  className,
  searchPlaceholder = 'Search…',
}: ComboboxProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => items.find((item) => item.value === value) ?? null,
    [items, value],
  );

  const groups = useMemo(() => {
    const map = new Map<string, ComboboxItem[]>();
    for (const item of items) {
      const key = item.group ?? '';
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return [...map.entries()];
  }, [items]);

  const triggerLabel = selected ? selected.label : placeholder;

  return (
    <div className={cn('flex w-full flex-col gap-1', className)}>
      {label ? <span className="text-12 font-medium text-text-muted">{label}</span> : null}

      <div className="flex w-full items-center gap-1">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery('');
          }}
          padded={false}
          width={360}
          trigger={
            <button
              type="button"
              disabled={disabled}
              aria-invalid={error ? true : undefined}
              aria-label={typeof label === 'string' ? label : placeholder}
              className={cn(
                'dur-fast control-height flex w-full items-center gap-2 rounded-input border bg-bg-inset px-2 text-left text-13 outline-none transition-colors',
                'hover:bg-bg-hover focus:border-accent focus:ring-1 focus:ring-accent',
                'disabled:cursor-not-allowed disabled:opacity-50',
                error ? 'border-danger' : 'border-border-strong',
              )}
            >
              <span
                className={cn(
                  'min-w-0 flex-1 truncate',
                  selected ? 'text-text' : 'text-text-subtle',
                )}
              >
                {triggerLabel}
              </span>
              <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
            </button>
          }
        >
          <Command shouldFilter className="flex max-h-[320px] flex-col" loop>
            <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
              <Search aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={searchPlaceholder}
                className="w-full border-0 bg-transparent p-0 text-13 text-text outline-none placeholder:text-text-subtle"
              />
            </div>

            <Command.List className="min-h-0 flex-1 overflow-auto p-1">
              <Command.Empty className="text-meta px-2 py-4 text-center text-text-subtle">
                {emptyMessage}
              </Command.Empty>

              {groups.map(([group, groupItems]) => (
                <Command.Group
                  key={group === '' ? '__ungrouped' : group}
                  heading={group === '' ? undefined : group}
                  className="[&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-subtle"
                >
                  {groupItems.map((item) => (
                    <Command.Item
                      key={item.value}
                      value={item.label}
                      {...(item.keywords === undefined ? {} : { keywords: [...item.keywords] })}
                      disabled={item.disabled === true}
                      onSelect={() => {
                        onChange(item.value);
                        setOpen(false);
                        setQuery('');
                      }}
                      className={cn(
                        'dur-fast flex cursor-pointer items-start gap-2 rounded-input px-2 py-1.5 outline-none select-none',
                        'data-[selected=true]:bg-bg-hover data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
                      )}
                    >
                      <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center">
                        {item.value === value ? (
                          <Check aria-hidden="true" className="size-3.5 text-accent" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-13 block truncate text-text">{item.label}</span>
                        {item.description ? (
                          <span className="text-micro mono block truncate text-text-subtle">
                            {item.description}
                          </span>
                        ) : null}
                      </span>
                      {item.meta ? <span className="shrink-0">{item.meta}</span> : null}
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </Popover>

        {allowClear && selected ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Clear selection"
            title="Clear selection"
            className="dur-fast inline-flex size-6 shrink-0 items-center justify-center rounded-input text-text-subtle outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-micro text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
