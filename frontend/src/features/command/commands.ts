/**
 * Every command-palette entry, in one place (Plan §15.4, §6 `features/command`).
 *
 * The palette is the keyboard-first escape hatch: navigate, create, evaluate,
 * switch org, open settings, get help. Entries are generated from the same
 * `NAV_GROUPS` the sidebar uses so the two can never disagree.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Building2,
  Keyboard,
  Palette,
  Plus,
  Settings,
  Share2,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { CommandGroup, CommandEntry } from '@/components/ui/Command';
import { NAV_GROUPS, ROUTES, orgRoutes } from '@/lib/constants';
import { useSwitchOrg } from '@/api/mutations/auth';
import { useActiveOrg, useCurrentUser, useUserOrgs } from '@/stores/session';

export type CreateKind = 'policy' | 'principal' | 'resource' | 'scenario';

const CREATE_TARGETS: Record<CreateKind, string> = {
  policy: ROUTES.policies,
  principal: ROUTES.principals,
  resource: ROUTES.resources,
  scenario: ROUTES.scenarios,
};

const CREATE_LABELS: Record<CreateKind, string> = {
  policy: 'policy',
  principal: 'principal',
  resource: 'resource',
  scenario: 'scenario',
};

/* ------------------------------------------------------------------ */
/* Recents (persisted; the palette shows them first)                  */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'iamscope.commands.recent.v1';
const RECENT_LIMIT = 6;
type RecentListener = (ids: string[]) => void;
const recentListeners = new Set<RecentListener>();

function readRecent(): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Called by the palette when an entry runs. */
export function recordCommandUse(id: string): void {
  const next = [id, ...readRecent().filter((entry) => entry !== id)].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable (private mode); recents are a nicety.
  }
  for (const listener of recentListeners) listener(next);
}

export function useRecentCommandIds(): string[] {
  const [ids, setIds] = useState<string[]>(() => readRecent());

  useEffect(() => {
    const listener: RecentListener = (next) => setIds(next);
    recentListeners.add(listener);
    return () => {
      recentListeners.delete(listener);
    };
  }, []);

  return ids;
}

/* ------------------------------------------------------------------ */
/* The groups                                                         */
/* ------------------------------------------------------------------ */

export interface CommandHandlers {
  navigate: (to: string) => void;
  create: (kind: CreateKind, to: string) => void;
  evaluateSelected: () => void;
  openKeyboardHelp: () => void;
}

export function useCommandGroups(handlers: CommandHandlers): CommandGroup[] {
  const orgs = useUserOrgs();
  const activeOrg = useActiveOrg();
  const currentUser = useCurrentUser();
  const switchOrg = useSwitchOrg();

  const { navigate, create, evaluateSelected, openKeyboardHelp } = handlers;

  const navigateEntry = useCallback(
    (
      id: string,
      label: string,
      to: string,
      icon: LucideIcon,
      description: string,
      shortcut?: string,
    ): CommandEntry => ({
      id,
      label,
      description,
      icon,
      ...(shortcut === undefined ? {} : { shortcut }),
      keywords: [to],
      onSelect: () => navigate(to),
    }),
    [navigate],
  );

  const groups: CommandGroup[] = [];

  // 1. Navigation, straight from the sidebar model.
  for (const group of NAV_GROUPS) {
    groups.push({
      heading: group.label,
      items: group.items.map((item) =>
        navigateEntry(
          `nav:${item.to}`,
          `Go to ${item.label}`,
          item.to,
          item.icon,
          item.description,
          item.shortcut,
        ),
      ),
    });
  }

  // Platform-admin navigation is not in NAV_GROUPS because it is conditional on the
  // allowlist, not on a membership role.
  if (currentUser?.isPlatformAdmin === true) {
    groups.push({
      heading: 'Platform',
      items: [
        navigateEntry(
          'nav:admin-users',
          'Go to Admin → Users',
          ROUTES.adminUsers,
          ShieldCheck,
          'Every account, with suspend and delete',
        ),
      ],
    });
  }

  // 2. Create.
  groups.push({
    heading: 'Create',
    items: (Object.keys(CREATE_TARGETS) as CreateKind[]).map((kind) => ({
      id: `create:${kind}`,
      label: `New ${CREATE_LABELS[kind]}`,
      description: `Open the ${CREATE_LABELS[kind]} form`,
      icon: Plus,
      keywords: ['add', 'create', kind],
      onSelect: () => create(kind, CREATE_TARGETS[kind]),
    })),
  });

  // 3. Lenses.
  groups.push({
    heading: 'Analyse',
    items: [
      {
        id: 'action:evaluate',
        label: 'Evaluate selected',
        description: 'Run the engine on the current selection',
        icon: Activity,
        shortcut: 'e',
        keywords: ['allow', 'deny', 'decision'],
        onSelect: () => {
          evaluateSelected();
          navigate(ROUTES.evaluate);
        },
      },
      {
        id: 'nav:graph-escalation',
        label: 'Find escalation paths',
        description: 'Traverse assume-role and pass-role chains',
        icon: Share2,
        keywords: ['privilege', 'escalate', 'attack'],
        onSelect: () => navigate(ROUTES.graph),
      },
    ],
  });

  // 4. Organization.
  const orgItems: CommandEntry[] = orgs.map((org) => ({
    id: `org:${org.id}`,
    label: `Switch to ${org.name}`,
    description: org.slug,
    icon: Building2,
    keywords: ['org', 'switch', org.slug],
    onSelect: () => {
      if (org.id !== activeOrg?.id) switchOrg.mutate({ orgId: org.id });
    },
  }));

  if (activeOrg) {
    orgItems.push(
      {
        id: 'org:settings',
        label: 'Organization settings',
        description: activeOrg.name,
        icon: Settings,
        onSelect: () => navigate(orgRoutes.settings(activeOrg.id)),
      },
      {
        id: 'org:members',
        label: 'Members',
        description: 'Invite, promote or remove people',
        icon: Users,
        onSelect: () => navigate(orgRoutes.members(activeOrg.id)),
      },
    );
  }

  groups.push({ heading: 'Organization', items: orgItems });

  // 5. Help.
  groups.push({
    heading: 'Help',
    items: [
      {
        id: 'help:keyboard',
        label: 'Keyboard shortcuts',
        description: 'Every binding in IAMScope',
        icon: Keyboard,
        shortcut: '?',
        onSelect: openKeyboardHelp,
      },
      {
        id: 'help:appearance',
        label: 'Appearance',
        description: 'Theme, accent and density live in the header menu',
        icon: Palette,
        keywords: ['theme', 'dark', 'light', 'density'],
        onSelect: () => openKeyboardHelp(),
      },
    ],
  });

  return groups.filter((group) => group.items.length > 0);
}
