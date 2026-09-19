import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight, Keyboard } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { NAV_GROUPS, ORG_NAV_ITEMS, ROUTES } from '@/lib/constants';
import { useActiveOrg, useRole } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { cn } from '@/lib/cn';

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function Sidebar(): JSX.Element {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const setKeyboardHelpOpen = useUiStore((state) => state.setKeyboardHelpOpen);
  const activeOrg = useActiveOrg();
  const role = useRole();

  const isAdmin = role !== null && (ROLE_RANK[role] ?? 0) >= (ROLE_RANK.admin ?? 2);
  // Non-admins only see the roster they are allowed to read.
  const orgItems = isAdmin
    ? ORG_NAV_ITEMS
    : ORG_NAV_ITEMS.filter((item) => item.pattern === ROUTES.orgMembers);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'dur-normal flex h-full shrink-0 flex-col border-r border-border bg-bg-raised transition-[width]',
        collapsed ? 'w-[52px]' : 'w-[228px]',
      )}
    >
      <div className="flex h-11 items-center justify-between gap-1 border-b border-border px-2">
        {collapsed ? null : (
          <span className="text-micro font-semibold tracking-wide text-text-subtle uppercase">
            Workbench
          </span>
        )}
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          icon={collapsed ? ChevronsRight : ChevronsLeft}
          size="sm"
          onClick={toggleSidebar}
          aria-expanded={!collapsed}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => !item.orgScoped || activeOrg !== null);
          if (items.length === 0) return null;

          return (
            <section key={group.id} className="mb-3">
              {collapsed ? (
                <div aria-hidden="true" className="mx-2 mb-1 h-px bg-border" />
              ) : (
                <h2 className="text-micro mb-1 px-1.5 font-semibold tracking-wide text-text-subtle uppercase">
                  {group.label}
                </h2>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/'}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'dur-fast group flex items-center gap-2 rounded-input px-1.5 py-1.5 text-13 no-underline outline-none',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          collapsed && 'justify-center px-0',
                          isActive
                            ? 'bg-bg-selected font-medium text-text'
                            : 'text-text-muted hover:bg-bg-hover hover:text-text',
                        )
                      }
                    >
                      <item.icon aria-hidden="true" className="size-4 shrink-0" />
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                          {item.shortcut ? (
                            <span className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                              <Kbd keys={item.shortcut} />
                            </span>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        {activeOrg ? (
          <section className="mb-3">
            {collapsed ? (
              <div aria-hidden="true" className="mx-2 mb-1 h-px bg-border" />
            ) : (
              <h2 className="text-micro mb-1 px-1.5 font-semibold tracking-wide text-text-subtle uppercase">
                {activeOrg.name}
              </h2>
            )}
            <ul className="flex flex-col gap-0.5">
              {orgItems.map((item) => {
                const href = item.href(activeOrg.id);
                return (
                  <li key={item.pattern}>
                    <NavLink
                      to={href}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'dur-fast flex items-center gap-2 rounded-input px-1.5 py-1.5 text-13 no-underline outline-none',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                          collapsed && 'justify-center px-0',
                          isActive
                            ? 'bg-bg-selected font-medium text-text'
                            : 'text-text-muted hover:bg-bg-hover hover:text-text',
                        )
                      }
                    >
                      <item.icon aria-hidden="true" className="size-4 shrink-0" />
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="border-t border-border p-1.5">
        <button
          type="button"
          onClick={() => setKeyboardHelpOpen(true)}
          className={cn(
            'text-12 dur-fast flex w-full items-center gap-2 rounded-input px-1.5 py-1.5 text-text-muted outline-none hover:bg-bg-hover hover:text-text',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
            collapsed && 'justify-center px-0',
          )}
        >
          <Keyboard aria-hidden="true" className="size-4 shrink-0" />
          {collapsed ? <span className="sr-only">Keyboard shortcuts</span> : <span>Shortcuts</span>}
        </button>
      </div>
    </nav>
  );
}
