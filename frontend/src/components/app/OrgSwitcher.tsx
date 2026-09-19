import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Check, ChevronsUpDown, Plus, Users } from 'lucide-react';
import type { Org } from '@iamscope/types';
import { Popover } from '@/components/ui/Popover';
import { Badge } from '@/components/ui/Badge';
import { ROLE_LABELS } from '@/lib/constants';
import { ROUTES } from '@/lib/constants';
import { useSwitchOrg } from '@/api/mutations/auth';
import { useActiveOrg, useUserOrgs } from '@/stores/session';
import { cn } from '@/lib/cn';

function initialsFor(org: Org): string {
  return org.name.trim().slice(0, 2).toUpperCase();
}

export function OrgSwitcher(): JSX.Element {
  const orgs = useUserOrgs();
  const activeOrg = useActiveOrg();
  const switchOrg = useSwitchOrg();
  const [open, setOpen] = useState(false);

  const label = activeOrg?.name ?? 'Select organization';

  const handleSelect = (org: Org): void => {
    setOpen(false);
    if (org.id === activeOrg?.id) return;
    switchOrg.mutate({ orgId: org.id });
  };

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={300}
      align="start"
      side="bottom"
      trigger={
        <button
          type="button"
          aria-label={`Organization: ${label}. Switch organization.`}
          className={cn(
            'dur-fast flex max-w-[240px] items-center gap-2 rounded-input border border-border bg-bg-raised px-2 py-1 text-left outline-none',
            'hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-5 shrink-0 items-center justify-center rounded-input bg-accent-subtle text-11 font-semibold text-accent"
          >
            {activeOrg ? initialsFor(activeOrg) : <Building2 className="size-3" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-13 text-text">{label}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-text-subtle" />
        </button>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-micro px-1 font-medium text-text-subtle">Your organizations</p>

        {orgs.length === 0 ? (
          <p className="text-meta px-1 py-2 text-text-muted">
            You are not a member of any organization yet.
          </p>
        ) : (
          <ul role="listbox" aria-label="Organizations" className="flex flex-col gap-0.5">
            {orgs.map((org) => {
              const selected = org.id === activeOrg?.id;
              return (
                <li key={org.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleSelect(org)}
                    disabled={switchOrg.isPending}
                    className={cn(
                      'dur-fast flex w-full items-center gap-2 rounded-input px-2 py-1.5 text-left outline-none',
                      'hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                      'disabled:opacity-60',
                      selected && 'bg-bg-selected',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-5 shrink-0 items-center justify-center rounded-input bg-bg-inset text-11 font-semibold text-text-muted"
                    >
                      {initialsFor(org)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="text-13 block truncate text-text">{org.name}</span>
                      <span className="text-micro block truncate text-text-subtle">{org.slug}</span>
                    </span>
                    {org.memberCount === undefined ? null : (
                      <span className="text-micro flex items-center gap-1 text-text-subtle">
                        <Users aria-hidden="true" className="size-3" />
                        {org.memberCount}
                      </span>
                    )}
                    {org.role ? (
                      <Badge variant="muted" hideIcon>
                        {ROLE_LABELS[org.role]}
                      </Badge>
                    ) : null}
                    {selected ? (
                      <Check aria-hidden="true" className="size-3.5 shrink-0 text-accent" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <Link
          to={ROUTES.orgNew}
          onClick={() => setOpen(false)}
          className="text-13 dur-fast mt-1 flex items-center gap-2 rounded-input border-t border-border px-2 py-1.5 text-text-muted no-underline outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          New organization
        </Link>
      </div>
    </Popover>
  );
}
