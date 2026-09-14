/**
 * The shell's section registry. Pure and isomorphic: no React, no `next/*`, so
 * both server layouts and client components can import it and it is testable
 * under the node Jest project.
 *
 * Icons and panel components live in `src/components/shell/sections.tsx`, keyed
 * by the `SectionId`s declared here.
 */

export const ROUTES = {
  chat: (id?: string) => (id ? `/chat/${id}` : '/chat'),
  knowledgeMap: '/knowledge/map',
  knowledgeDashboard: '/knowledge/dashboard',
  adminUsers: '/admin/users',
  adminFlags: '/admin/flags',
  adminFeedback: '/admin/feedback',
  adminRepos: '/admin/repos',
  adminKnowledge: '/admin/knowledge',
  adminSettings: '/admin/settings',
  settings: '/settings',
  login: '/login',
  pending: '/pending',
} as const;

export type SectionId = 'chat' | 'knowledge' | 'admin' | 'settings';

/** Counters `NotificationsProvider` exposes and section children can badge. */
export type BadgeKey = 'pendingFlags' | 'pendingFeedback';

export type SectionChild = {
  label: string;
  href: string;
  badge?: BadgeKey;
};

export type Section = {
  id: SectionId;
  label: string;
  href: string;
  adminOnly: boolean;
  /** Where the rail renders the item. */
  placement: 'top' | 'bottom';
  children?: SectionChild[];
};

export const SECTIONS: Section[] = [
  {
    id: 'chat',
    label: 'Chat',
    href: ROUTES.chat(),
    adminOnly: false,
    placement: 'top',
  },
  {
    id: 'knowledge',
    label: 'Knowledge',
    href: ROUTES.knowledgeMap,
    adminOnly: false,
    placement: 'top',
    children: [
      { label: 'Map', href: ROUTES.knowledgeMap },
      { label: 'Dashboard', href: ROUTES.knowledgeDashboard },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    href: ROUTES.adminUsers,
    adminOnly: true,
    placement: 'top',
    children: [
      { label: 'Users', href: ROUTES.adminUsers },
      { label: 'Flags', href: ROUTES.adminFlags, badge: 'pendingFlags' },
      { label: 'Feedback', href: ROUTES.adminFeedback, badge: 'pendingFeedback' },
      { label: 'Repositories', href: ROUTES.adminRepos },
      { label: 'Knowledge', href: ROUTES.adminKnowledge },
      { label: 'Settings', href: ROUTES.adminSettings },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    href: ROUTES.settings,
    adminOnly: false,
    placement: 'bottom',
  },
];

/** True when `pathname` is `href` itself or a segment nested under it. */
export function isActiveHref(href: string, pathname: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Which rail section owns this pathname, or null if it is outside the shell. */
export function sectionIdForPathname(pathname: string): SectionId | null {
  // Longest href first, so `/knowledge/map` beats a hypothetical `/knowledge`.
  const match = [...SECTIONS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((section) => isActiveHref(sectionRoot(section), pathname));
  return match?.id ?? null;
}

export function visibleSections(role: string): Section[] {
  return SECTIONS.filter((section) => !section.adminOnly || role === 'admin');
}

/**
 * The path prefix a section owns. A section's `href` is its landing page, which
 * may be nested (`/knowledge/map`), so ownership is the first segment of it.
 */
function sectionRoot(section: Section): string {
  return `/${section.href.split('/').filter(Boolean)[0]}`;
}
