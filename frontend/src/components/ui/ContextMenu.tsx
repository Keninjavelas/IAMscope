import type { ReactNode, JSX } from 'react';
import * as RadixContextMenu from '@radix-ui/react-context-menu';
import type { LucideIcon } from 'lucide-react';
import { Kbd } from './Kbd';
import { cn } from '@/lib/cn';

export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: LucideIcon | undefined;
  shortcut?: string | undefined;
  onSelect: () => void;
  danger?: boolean | undefined;
  disabled?: boolean | undefined;
  separatorBefore?: boolean | undefined;
}

export interface ContextMenuProps {
  items: readonly ContextMenuItem[];
  children: ReactNode;
}

/**
 * Right-click menu. Everything it offers is also reachable from the row's
 * overflow button / the command palette, because a context menu is invisible to
 * keyboard-only users (Plan §15.1).
 */
export function ContextMenu({ items, children }: ContextMenuProps): JSX.Element {
  return (
    <RadixContextMenu.Root>
      <RadixContextMenu.Trigger>{children}</RadixContextMenu.Trigger>
      <RadixContextMenu.Portal>
        <RadixContextMenu.Content className="overlay-surface z-50 min-w-[200px] p-1 text-13 text-text">
          {items.map((item) => (
            <div key={item.id}>
              {item.separatorBefore ? (
                <RadixContextMenu.Separator className="my-1 h-px bg-border" />
              ) : null}
              <RadixContextMenu.Item
                disabled={item.disabled === true}
                onSelect={item.onSelect}
                className={cn(
                  'dur-fast flex cursor-pointer items-center gap-2 rounded-input px-2 py-1 outline-none select-none',
                  'data-[highlighted]:bg-bg-hover data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
                  item.danger === true && 'text-danger data-[highlighted]:bg-danger-subtle',
                )}
              >
                {item.icon ? <item.icon aria-hidden="true" className="size-3.5 shrink-0" /> : null}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut ? <Kbd keys={item.shortcut} /> : null}
              </RadixContextMenu.Item>
            </div>
          ))}
        </RadixContextMenu.Content>
      </RadixContextMenu.Portal>
    </RadixContextMenu.Root>
  );
}
