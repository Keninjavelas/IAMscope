import { useState, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, KeyRound, LogOut, Settings, UserCog, Users } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { ROLE_LABELS, orgRoutes } from '@/lib/constants';
import { useLogout } from '@/api/mutations/auth';
import { useActiveOrg, useCurrentUser, useRole } from '@/stores/session';
import { DensityToggle } from './DensityToggle';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/cn';

const LINK_CLASS =
  'text-13 dur-fast flex items-center gap-2 rounded-input px-2 py-1.5 text-text-muted no-underline outline-none hover:bg-bg-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

export function UserMenu(): JSX.Element | null {
  const user = useCurrentUser();
  const role = useRole();
  const activeOrg = useActiveOrg();
  const logout = useLogout();
  const [open, setOpen] = useState(false);

  if (!user) return null;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      width={280}
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`Account menu for ${user.name}`}
          className={cn(
            'dur-fast flex items-center gap-1.5 rounded-input px-1 py-1 outline-none',
            'hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          <Avatar name={user.name} src={user.avatarUrl} size="md" decorative />
          <ChevronDown aria-hidden="true" className="size-3.5 text-text-subtle" />
        </button>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Avatar name={user.name} src={user.avatarUrl} size="lg" decorative />
          <div className="min-w-0 flex-1">
            <p className="text-13 truncate font-medium text-text">{user.name}</p>
            <p className="text-micro truncate text-text-muted">{user.email}</p>
            <div className="mt-1 flex items-center gap-1">
              {role ? (
                <Badge variant="muted" hideIcon>
                  {ROLE_LABELS[role]}
                </Badge>
              ) : null}
              {user.emailVerified ? (
                <Badge variant="success">Verified</Badge>
              ) : (
                <Badge variant="warn">Unverified</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-micro text-text-subtle">Appearance</span>
          <span className="flex items-center gap-1">
            <ThemeToggle />
            <DensityToggle />
          </span>
        </div>

        {activeOrg ? (
          <nav
            aria-label="Organization"
            className="flex flex-col gap-0.5 border-t border-border pt-1.5"
          >
            <Link
              to={orgRoutes.settings(activeOrg.id)}
              className={LINK_CLASS}
              onClick={() => setOpen(false)}
            >
              <Settings aria-hidden="true" className="size-3.5" />
              Organization settings
            </Link>
            <Link
              to={orgRoutes.members(activeOrg.id)}
              className={LINK_CLASS}
              onClick={() => setOpen(false)}
            >
              <Users aria-hidden="true" className="size-3.5" />
              Members
            </Link>
            <Link
              to={orgRoutes.apiKeys(activeOrg.id)}
              className={LINK_CLASS}
              onClick={() => setOpen(false)}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              API keys
            </Link>
          </nav>
        ) : null}

        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <p className="text-micro flex items-center gap-1 px-1 text-text-subtle">
            <UserCog aria-hidden="true" className="size-3" />
            Account
          </p>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={LogOut}
            fullWidth
            loading={logout.isPending}
            onClick={() => {
              setOpen(false);
              logout.mutate();
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    </Popover>
  );
}
