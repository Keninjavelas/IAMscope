import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { CloudOff, Keyboard, Menu, Search, ShieldCheck } from 'lucide-react';
import { AvatarStack } from '@/components/ui/AvatarStack';
import { Button, IconButton } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/Kbd';
import { ROUTES } from '@/lib/constants';
import { usePresenceList } from '@/api/queries/presence';
import { reconnectSse, useSseStatus } from '@/hooks/useSSE';
import { useActiveOrg, useActiveOrgId, useCurrentUser } from '@/stores/session';
import { useUiStore } from '@/stores/ui';
import { DensityToggle } from './DensityToggle';
import { OrgSwitcher } from './OrgSwitcher';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';
import { cn } from '@/lib/cn';

function SseIndicator(): JSX.Element {
  const status = useSseStatus();
  const label =
    status === 'open'
      ? 'Live updates connected'
      : status === 'connecting'
        ? 'Connecting to live updates'
        : status === 'reconnecting'
          ? 'Reconnecting to live updates'
          : status === 'closed'
            ? 'Live updates disconnected'
            : 'Live updates idle';

  const tone =
    status === 'open'
      ? 'bg-success'
      : status === 'connecting' || status === 'reconnecting'
        ? 'bg-warn'
        : 'bg-text-subtle';

  return (
    <span className="flex items-center gap-1.5" title={label}>
      <span
        aria-hidden="true"
        className={cn(
          'size-2 shrink-0 rounded-full',
          tone,
          status === 'reconnecting' && 'animate-pulse',
        )}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {label}
      </span>
      {status === 'closed' ? (
        <Button size="sm" variant="ghost" iconLeft={CloudOff} onClick={reconnectSse}>
          Reconnect
        </Button>
      ) : null}
    </span>
  );
}

function PresenceRoster(): JSX.Element | null {
  const orgId = useActiveOrgId();
  const user = useCurrentUser();
  const roster = usePresenceList(orgId);

  const entries = roster.data ?? [];
  if (orgId === null) return null;

  const users = entries.map((entry) => ({
    id: entry.userId,
    name: entry.user.name,
    avatarUrl: entry.user.avatarUrl,
  }));

  return (
    <span className="hidden md:flex items-center gap-2">
      {users.length === 0 ? (
        <span className="text-micro text-text-subtle">Only you here</span>
      ) : (
        <AvatarStack
          users={users}
          max={5}
          size="md"
          label="People currently in this organization"
          describe={(entry) => (entry.id === user?.id ? 'you' : undefined)}
        />
      )}
    </span>
  );
}

export interface HeaderProps {
  /** Opens/closes the sidebar on small screens. */
  onToggleMobileNav?: (() => void) | undefined;
  mobileNavOpen?: boolean | undefined;
}

export function Header({ onToggleMobileNav, mobileNavOpen = false }: HeaderProps): JSX.Element {
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const toggleKeyboardHelp = useUiStore((state) => state.toggleKeyboardHelp);
  const activeOrg = useActiveOrg();

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg-raised px-2">
      {onToggleMobileNav ? (
        <IconButton
          label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
          icon={Menu}
          size="sm"
          className="lg:hidden"
          aria-expanded={mobileNavOpen}
          onClick={onToggleMobileNav}
        />
      ) : null}

      <Link
        to={ROUTES.home}
        className="dur-fast flex shrink-0 items-center gap-1.5 rounded-input px-1 py-1 no-underline outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <ShieldCheck aria-hidden="true" className="size-4 text-accent" />
        <span className="text-13 font-semibold tracking-tight text-text">IAMScope</span>
      </Link>

      {activeOrg ? <OrgSwitcher /> : null}

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className={cn(
          'text-13 dur-fast mx-auto hidden h-7 w-full max-w-[420px] items-center gap-2 rounded-input border border-border bg-bg-inset px-2 text-left text-text-subtle outline-none sm:flex',
          'hover:border-border-strong hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">Search policies, principals, actions…</span>
        <Kbd keys="mod+k" />
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton
          label="Search"
          icon={Search}
          size="sm"
          className="sm:hidden"
          onClick={() => setPaletteOpen(true)}
        />
        <SseIndicator />
        <PresenceRoster />
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        <IconButton
          label="Keyboard shortcuts"
          icon={Keyboard}
          size="sm"
          onClick={toggleKeyboardHelp}
        />
        <ThemeToggle />
        <DensityToggle />
        <UserMenu />
      </div>
    </header>
  );
}
