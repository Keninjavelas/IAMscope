import type { JSX } from 'react';
import { PencilLine } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { cn } from '@/lib/cn';

export interface PresencePeer {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface PresenceBadgeProps {
  peers: PresencePeer[];
  /** Verb shown after the names. Defaults to "editing". */
  label?: string;
  /** Cap how many names are listed before collapsing to "+N". */
  max?: number;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
}

/**
 * "Alice is editing" / "Alice and Bob are editing" (Plan §14.3). Renders nothing
 * when no peer is present so callers can drop it in unconditionally.
 */
export function PresenceBadge({
  peers,
  label = 'editing',
  max = 2,
  size = 'xs',
  className,
}: PresenceBadgeProps): JSX.Element | null {
  if (peers.length === 0) return null;

  const shown = peers.slice(0, max);
  const overflow = peers.length - shown.length;
  const names = shown.map((peer) => peer.name);
  const subject =
    overflow > 0
      ? `${names.join(', ')} +${overflow}`
      : names.length > 1
        ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`
        : (names[0] ?? '');

  const verb = peers.length > 1 && overflow === 0 ? 'are' : 'is';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent-subtle px-2 py-0.5 text-micro text-text',
        className,
      )}
      // Announce changes politely rather than interrupting the user mid-edit.
      aria-live="polite"
    >
      <span className="flex items-center -space-x-1" aria-hidden="true">
        {shown.map((peer) => (
          <Avatar key={peer.id} name={peer.name} src={peer.avatarUrl ?? null} size={size} ring />
        ))}
      </span>
      <PencilLine className="size-3 shrink-0 text-accent" aria-hidden="true" />
      <span className="truncate">
        {subject} {verb} {label}
      </span>
    </span>
  );
}
