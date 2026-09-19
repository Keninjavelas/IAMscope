/**
 * Route table, navigation and label maps (Plan §6 `lib/constants.ts`, §16).
 *
 * Routes live in one place so the router, the sidebar, the command palette and
 * the breadcrumbs can never drift apart.
 */
import {
  Activity,
  BookOpen,
  Boxes,
  Building2,
  Database,
  FileCode2,
  FlaskConical,
  GitCompareArrows,
  History,
  Home,
  Info,
  KeyRound,
  LayoutDashboard,
  MailPlus,
  Network,
  ScrollText,
  Settings,
  Share2,
  ShieldCheck,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ApiKeyScope, EscalationSeverity, PolicyEffect, Role } from '@iamscope/types';

/* ------------------------------------------------------------------ */
/* Routes (Plan §16)                                                  */
/* ------------------------------------------------------------------ */

export const ROUTES = {
  home: '/',
  login: '/login',
  signup: '/signup',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  verifyEmail: '/verify-email',

  orgNew: '/orgs/new',
  orgSettings: '/orgs/:id/settings',
  orgMembers: '/orgs/:id/members',
  orgInvitations: '/orgs/:id/invitations',
  orgApiKeys: '/orgs/:id/api-keys',

  policies: '/policies',
  policyDetail: '/policies/:id',
  policyVersions: '/policies/:id/versions',

  principals: '/principals',
  principalDetail: '/principals/:id',
  resources: '/resources',
  scenarios: '/scenarios',

  evaluate: '/evaluate',
  impact: '/impact',
  graph: '/graph',
  timeline: '/timeline',
  audit: '/audit',

  architecture: '/architecture',
  dataModel: '/data-model',
  about: '/about',
} as const;

/* ---- Builders: turn a route template into a concrete href ---- */

function fill(template: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    template,
  );
}

export const orgRoutes = {
  settings: (orgId: string): string => fill(ROUTES.orgSettings, { id: orgId }),
  members: (orgId: string): string => fill(ROUTES.orgMembers, { id: orgId }),
  invitations: (orgId: string): string => fill(ROUTES.orgInvitations, { id: orgId }),
  apiKeys: (orgId: string): string => fill(ROUTES.orgApiKeys, { id: orgId }),
} as const;

export const policyRoutes = {
  detail: (id: string): string => fill(ROUTES.policyDetail, { id }),
  versions: (id: string): string => fill(ROUTES.policyVersions, { id }),
} as const;

export const principalRoutes = {
  detail: (id: string): string => fill(ROUTES.principalDetail, { id }),
} as const;

/** Routes reachable without a session. */
export const PUBLIC_ROUTES: readonly string[] = [
  ROUTES.home,
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.resetPassword,
  ROUTES.verifyEmail,
  ROUTES.architecture,
  ROUTES.dataModel,
  ROUTES.about,
];

/** Routes that require `admin` or above in the active org (Plan §9.5). */
export const ORG_ADMIN_ROUTE_PATTERNS: readonly string[] = [
  ROUTES.orgSettings,
  ROUTES.orgMembers,
  ROUTES.orgInvitations,
  ROUTES.orgApiKeys,
];

/* ------------------------------------------------------------------ */
/* Navigation                                                         */
/* ------------------------------------------------------------------ */

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Short description - also used as the command-palette subtitle. */
  description: string;
  /** Global keyboard sequence, matching `p` / `n` / `r` ... in §15.4. */
  shortcut?: string;
  /** Route requires an active organization. */
  orgScoped: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    id: 'workbench',
    label: 'Workbench',
    items: [
      {
        label: 'Policies',
        to: ROUTES.policies,
        icon: FileCode2,
        description: 'Versioned IAM policies and their statements',
        shortcut: 'g p',
        orgScoped: true,
      },
      {
        label: 'Principals',
        to: ROUTES.principals,
        icon: Users,
        description: 'Users, roles and groups that carry policies',
        shortcut: 'g n',
        orgScoped: true,
      },
      {
        label: 'Resources',
        to: ROUTES.resources,
        icon: Boxes,
        description: 'ARNs that policies can target',
        shortcut: 'g r',
        orgScoped: true,
      },
      {
        label: 'Scenarios',
        to: ROUTES.scenarios,
        icon: FlaskConical,
        description: 'Saved access questions with an expected answer',
        shortcut: 'g s',
        orgScoped: true,
      },
    ],
  },
  {
    id: 'lenses',
    label: 'Lenses',
    items: [
      {
        label: 'Evaluate',
        to: ROUTES.evaluate,
        icon: Activity,
        description: 'Ask the engine who can do what, and why',
        shortcut: 'g e',
        orgScoped: true,
      },
      {
        label: 'Impact',
        to: ROUTES.impact,
        icon: GitCompareArrows,
        description: 'Diff two evaluation runs, decision by decision',
        shortcut: 'g i',
        orgScoped: true,
      },
      {
        label: 'Graph',
        to: ROUTES.graph,
        icon: Share2,
        description: 'Multi-hop privilege escalation paths',
        shortcut: 'g g',
        orgScoped: true,
      },
      {
        label: 'Timeline',
        to: ROUTES.timeline,
        icon: History,
        description: 'Reconstruct the system at any past date',
        shortcut: 'g t',
        orgScoped: true,
      },
      {
        label: 'Audit',
        to: ROUTES.audit,
        icon: ScrollText,
        description: 'Every mutation, who made it and what changed',
        shortcut: 'g a',
        orgScoped: true,
      },
    ],
  },
  {
    id: 'docs',
    label: 'Reference',
    items: [
      {
        label: 'Architecture',
        to: ROUTES.architecture,
        icon: Network,
        description: 'How the pieces fit together',
        orgScoped: false,
      },
      {
        label: 'Data model',
        to: ROUTES.dataModel,
        icon: Database,
        description: 'Collections, indexes and tenant isolation',
        orgScoped: false,
      },
      {
        label: 'About',
        to: ROUTES.about,
        icon: Info,
        description: 'What IAMScope is and is not',
        orgScoped: false,
      },
    ],
  },
] as const;

export interface OrgNavItem {
  label: string;
  icon: LucideIcon;
  /** Receives the active org id. */
  href: (orgId: string) => string;
  pattern: string;
  description: string;
}

export const ORG_NAV_ITEMS: readonly OrgNavItem[] = [
  {
    label: 'Members',
    icon: Users,
    href: orgRoutes.members,
    pattern: ROUTES.orgMembers,
    description: 'Roles and access for this organization',
  },
  {
    label: 'Invitations',
    icon: MailPlus,
    href: orgRoutes.invitations,
    pattern: ROUTES.orgInvitations,
    description: 'Pending invites and their links',
  },
  {
    label: 'API keys',
    icon: KeyRound,
    href: orgRoutes.apiKeys,
    pattern: ROUTES.orgApiKeys,
    description: 'Machine credentials and their scopes',
  },
  {
    label: 'Settings',
    icon: Settings,
    href: orgRoutes.settings,
    pattern: ROUTES.orgSettings,
    description: 'Name, defaults and danger zone',
  },
] as const;

/** Icons used outside the sidebar (Home page cards, empty states). */
export const ICONS = {
  home: Home,
  dashboard: LayoutDashboard,
  shield: ShieldCheck,
  invite: UserPlus,
  org: Building2,
  docs: BookOpen,
} as const;

/* ------------------------------------------------------------------ */
/* Label maps                                                         */
/* ------------------------------------------------------------------ */

export const SEVERITY_LABELS: Record<EscalationSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const EFFECT_LABELS: Record<PolicyEffect, string> = {
  Allow: 'Allow',
  Deny: 'Deny',
};

export const EFFECT_VERBS: Record<PolicyEffect, string> = {
  Allow: 'Allows',
  Deny: 'Denies',
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  owner: 'Full control, including deleting the organization.',
  admin: 'Manages members, keys and destructive actions.',
  member: 'Creates and edits policies, principals, resources and scenarios.',
  viewer: 'Read-only access to everything in the organization.',
};

export const ROLE_ORDER: readonly Role[] = ['owner', 'admin', 'member', 'viewer'];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, string> = {
  read: 'Read',
  write: 'Write',
  evaluate: 'Evaluate',
  admin: 'Admin',
};

export const API_KEY_SCOPE_DESCRIPTIONS: Record<ApiKeyScope, string> = {
  read: 'Read policies, principals, resources and scenarios.',
  write: 'Create and edit domain objects.',
  evaluate: 'Run evaluations, escalation traversals and timeline reconstruction.',
  admin: 'Manage members, invitations and other API keys.',
};

/**
 * Display names for the tag keys the seed data uses. Unknown keys fall back to
 * `titleCase`, so a custom tag still renders sensibly.
 */
export const TAG_LABELS: Record<string, string> = {
  team: 'Team',
  environment: 'Environment',
  env: 'Environment',
  owner: 'Owner',
  'cost-center': 'Cost center',
  compliance: 'Compliance',
  dataClass: 'Data class',
  tier: 'Tier',
};

export const TAG_KEY_SUGGESTIONS: readonly string[] = [
  'team',
  'environment',
  'owner',
  'compliance',
];

export const TAG_VALUE_SUGGESTIONS: Record<string, readonly string[]> = {
  environment: ['production', 'staging', 'development'],
  compliance: ['pci', 'hipaa', 'soc2', 'none'],
  tier: ['critical', 'standard'],
};

/** Audit action prefixes, used for the audit lens category filter. */
export const AUDIT_CATEGORY_LABELS: Record<string, string> = {
  policy: 'Policies',
  principal: 'Principals',
  resource: 'Resources',
  scenario: 'Scenarios',
  member: 'Members',
  apikey: 'API keys',
  org: 'Organization',
  auth: 'Authentication',
};

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_OPTIONS: readonly number[] = [25, 50, 100, 200];
