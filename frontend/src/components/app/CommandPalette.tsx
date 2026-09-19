import { useCallback, useMemo, type JSX } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CommandDialog, type CommandEntry, type CommandGroup } from '@/components/ui/Command';
import { ROUTES, orgRoutes } from '@/lib/constants';
import {
  recordCommandUse,
  useCommandGroups,
  useRecentCommandIds,
  type CreateKind,
} from '@/features/command/commands';
import { useActiveOrg } from '@/stores/session';
import { useUiStore } from '@/stores/ui';

/**
 * The palette. It records which command ran so the next open can surface
 * recents first, and it knows how to translate "create a policy" into the
 * right route + `?new=1` so list pages can open their own dialog.
 */
export function CommandPalette(): JSX.Element {
  const open = useUiStore((state) => state.paletteOpen);
  const initialQuery = useUiStore((state) => state.paletteInitialQuery);
  const setPaletteOpen = useUiStore((state) => state.setPaletteOpen);
  const setKeyboardHelpOpen = useUiStore((state) => state.setKeyboardHelpOpen);

  const navigate = useNavigate();
  const location = useLocation();
  const activeOrg = useActiveOrg();
  const recentIds = useRecentCommandIds();

  const handleCreate = useCallback(
    (kind: CreateKind, to: string) => {
      const target = activeOrg === null && kind !== 'policy' ? to : to;
      navigate(`${target}?new=${kind}`);
    },
    [activeOrg, navigate],
  );

  /** `e` is contextual: it evaluates whatever the current route focuses. */
  const evaluateSelected = useCallback(() => {
    navigate(ROUTES.evaluate);
  }, [navigate]);

  const groups = useCommandGroups({
    navigate: (to) => navigate(to),
    create: handleCreate,
    evaluateSelected,
    openKeyboardHelp: () => setKeyboardHelpOpen(true),
  });

  /** Wrap every entry so recents are recorded before the action runs. */
  const wrapped: CommandGroup[] = useMemo(
    () =>
      groups.map((group) => ({
        heading: group.heading,
        items: group.items.map((item): CommandEntry => ({
          ...item,
          onSelect: () => {
            recordCommandUse(item.id);
            item.onSelect();
          },
        })),
      })),
    [groups],
  );

  // Contextual hint in the placeholder: the palette knows where you are.
  const placeholder =
    location.pathname === ROUTES.home
      ? 'Search commands…'
      : `Search commands, or jump from ${location.pathname}…`;

  const contextual: CommandGroup[] = useMemo(() => {
    if (activeOrg === null) return [];
    const sectionItems: CommandEntry[] = [
      {
        id: 'ctx:org-members',
        label: 'Invite someone',
        description: `Add a person to ${activeOrg.name}`,
        keywords: ['member', 'invite', 'team'],
        onSelect: () => navigate(orgRoutes.invitations(activeOrg.id)),
      },
    ];
    return [{ heading: `In ${activeOrg.name}`, items: sectionItems }];
  }, [activeOrg, navigate]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => setPaletteOpen(next)}
      groups={[...contextual, ...wrapped]}
      initialQuery={initialQuery}
      placeholder={placeholder}
      recentIds={recentIds}
    />
  );
}
