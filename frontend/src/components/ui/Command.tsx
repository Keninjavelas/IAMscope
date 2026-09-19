import { useEffect, useMemo, useState, type JSX } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { CornerDownLeft, Search, type LucideIcon } from 'lucide-react';
import { Kbd } from './Kbd';
import { useToast } from './Toast';
import { cn } from '@/lib/cn';

export interface CommandEntry {
  id: string;
  label: string;
  description?: string | undefined;
  icon?: LucideIcon | undefined;
  shortcut?: string | undefined;
  /** Extra text that should match the query. */
  keywords?: readonly string[] | undefined;
  onSelect: () => void;
  /** Optional async side effect; rejections surface as a toast. */
  perform?: (() => Promise<void>) | undefined;
}

export interface CommandGroup {
  heading: string;
  items: readonly CommandEntry[];
}

export interface CommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: readonly CommandGroup[];
  initialQuery?: string | undefined;
  placeholder?: string | undefined;
  /** Ids to hoist into a "Recent" section, most recent first. */
  recentIds?: readonly string[] | undefined;
}

/**
 * Command palette (Plan §15.4). cmdk owns fuzzy matching and arrow-key
 * navigation; Radix Dialog owns the focus trap and restore-on-close.
 */
export function CommandDialog({
  open,
  onOpenChange,
  groups,
  initialQuery = '',
  placeholder = 'Search commands…',
  recentIds = [],
}: CommandDialogProps): JSX.Element {
  const [query, setQuery] = useState(initialQuery);
  const toast = useToast();

  // The palette can be opened with a pre-seeded query (`/` and `c` shortcuts).
  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [open, initialQuery]);

  const byId = useMemo(() => {
    const map = new Map<string, CommandEntry>();
    for (const group of groups) {
      for (const item of group.items) map.set(item.id, item);
    }
    return map;
  }, [groups]);

  const recentItems = useMemo(() => {
    const seen = new Set<string>();
    const out: CommandEntry[] = [];
    for (const id of recentIds) {
      if (seen.has(id)) continue;
      const entry = byId.get(id);
      if (entry) {
        out.push(entry);
        seen.add(id);
      }
    }
    return out;
  }, [byId, recentIds]);

  const run = (entry: CommandEntry): void => {
    onOpenChange(false);
    entry.onSelect();
    if (entry.perform) {
      void entry.perform().catch((error: unknown) => {
        toast.error(
          `Could not run "${entry.label}"`,
          error instanceof Error ? error.message : undefined,
        );
      });
    }
  };

  const renderItem = (entry: CommandEntry): JSX.Element => (
    <Command.Item
      key={entry.id}
      value={entry.label}
      {...(entry.keywords === undefined ? {} : { keywords: [...entry.keywords] })}
      onSelect={() => run(entry)}
      className={cn(
        'dur-fast flex cursor-pointer items-center gap-2 rounded-input px-2 py-1.5 outline-none select-none',
        'data-[selected=true]:bg-bg-selected data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      )}
    >
      {entry.icon ? (
        <entry.icon aria-hidden="true" className="size-3.5 shrink-0 text-text-muted" />
      ) : (
        <span aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        <span className="text-13 block truncate text-text">{entry.label}</span>
        {entry.description ? (
          <span className="text-micro block truncate text-text-subtle">{entry.description}</span>
        ) : null}
      </span>
      {entry.shortcut ? <Kbd keys={entry.shortcut} /> : null}
    </Command.Item>
  );

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dur-normal fixed inset-0 z-[55] bg-black/40 backdrop-blur-[2px]" />
        <RadixDialog.Content className="overlay-surface dur-normal ease-out-brand fixed top-[12vh] left-1/2 z-[56] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden p-0 outline-none">
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          {initialQuery === '' ? (
            <RadixDialog.Description className="sr-only">
              Search for a page, an entity or an action.
            </RadixDialog.Description>
          ) : null}

          <Command
            shouldFilter
            loop
            value={query}
            onValueChange={setQuery}
            className="flex max-h-[min(70vh,560px)] flex-col"
          >
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Search aria-hidden="true" className="size-4 shrink-0 text-text-subtle" />
              <Command.Input
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder={placeholder}
                className="text-14 w-full border-0 bg-transparent p-0 text-text outline-none placeholder:text-text-subtle"
              />
              <Kbd keys="escape" />
            </div>

            <Command.List className="min-h-0 flex-1 overflow-auto p-1.5">
              <Command.Empty className="text-13 px-3 py-8 text-center text-text-muted">
                No matching commands. Try a page name like “policies”, an ARN, or “create”.
              </Command.Empty>

              {recentItems.length > 0 && query.trim() === '' ? (
                <Command.Group
                  heading="Recent"
                  className="[&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-subtle"
                >
                  {recentItems.map(renderItem)}
                </Command.Group>
              ) : null}

              {groups.map((group) => (
                <Command.Group
                  key={group.heading}
                  heading={group.heading}
                  className="[&_[cmdk-group-heading]]:text-micro [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-text-subtle"
                >
                  {group.items.map(renderItem)}
                </Command.Group>
              ))}
            </Command.List>

            <footer className="text-micro flex items-center gap-3 border-t border-border px-3 py-1.5 text-text-subtle">
              <span className="inline-flex items-center gap-1">
                <Kbd keys="arrowup" />
                <Kbd keys="arrowdown" /> navigate
              </span>
              <span className="inline-flex items-center gap-1">
                <CornerDownLeft aria-hidden="true" className="size-3" /> run
              </span>
              <span className="inline-flex items-center gap-1">
                <Kbd keys="escape" /> close
              </span>
            </footer>
          </Command>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
