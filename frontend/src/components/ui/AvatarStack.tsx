import { useState, type JSX } from 'react';
import { Avatar, type AvatarSize } from './Avatar';
import { Popover } from './Popover';
import { cn } from '@/lib/cn';

export interface AvatarUser {
  id: string;
  name: string;
  avatarUrl?: string | null | undefined;
}

export interface AvatarStackProps {
  users: readonly AvatarUser[];
  max?: number | undefined;
  size?: AvatarSize | undefined;
  /** Accessible name for the group, e.g. "Present in this organization". */
  label?: string | undefined;
  /** Extra detail under each name in the overflow popover. */
  describe?: ((user: AvatarUser) => string | undefined) | undefined;
}

/**
 * Overlapping avatars with a keyboard-reachable `+N` overflow (Plan §14.3).
 * The overflow is a button that opens a real popover - never a hover-only tooltip.
 */
export function AvatarStack({
  users,
  max = 5,
  size = 'md',
  label = 'Present',
  describe,
}: AvatarStackProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const visible = users.slice(0, Math.max(1, max));
  const overflow = users.slice(Math.max(1, max));

  if (users.length === 0) {
    return (
      <span className="text-micro text-text-subtle" aria-label={`${label}: nobody yet`}>
        Nobody yet
      </span>
    );
  }

  return (
    <div className="flex items-center" role="group" aria-label={label}>
      <div className="flex items-center -space-x-1.5">
        {visible.map((user) => (
          <span
            key={user.id}
            className="ring-2 ring-bg-raised"
            style={{ borderRadius: 9999 }}
            title={user.name}
          >
            <Avatar name={user.name} src={user.avatarUrl ?? null} size={size} decorative />
          </span>
        ))}
      </div>

      {overflow.length > 0 ? (
        <Popover
          open={open}
          onOpenChange={setOpen}
          width={240}
          side="bottom"
          align="end"
          trigger={
            <button
              type="button"
              className="text-11 ml-1 inline-flex h-5 items-center rounded-input border border-border bg-bg-inset px-1 font-medium text-text-muted outline-none hover:bg-bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              aria-label={`Show ${overflow.length} more people`}
            >
              +{overflow.length}
            </button>
          }
        >
          <ul className="flex max-h-64 flex-col gap-1 overflow-auto">
            {users.map((user) => (
              <li key={user.id} className="flex items-center gap-2 px-1 py-0.5">
                <Avatar name={user.name} src={user.avatarUrl ?? null} size="sm" decorative />
                <span className="min-w-0 flex-1">
                  <span className="text-12 block truncate text-text">{user.name}</span>
                  {describe ? (
                    <span className="text-micro block truncate text-text-subtle">
                      {describe(user) ?? ''}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Popover>
      ) : null}

      <span className="sr-only-focusable">{`${users.length} people present`}</span>
      <span className={cn('sr-only')} aria-live="polite">
        {`${users.length} people present`}
      </span>
    </div>
  );
}
