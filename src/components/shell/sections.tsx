'use client';

import type { ComponentType } from 'react';
import { MessageSquare, Network, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import { SECTIONS, sectionIdForPathname, type Section, type SectionId } from '@/lib/navigation';
import { AdminPanel } from './panels/AdminPanel';
import { ChatPanel } from './panels/ChatPanel';
import { KnowledgePanel } from './panels/KnowledgePanel';

/**
 * The client half of the section registry. `@/lib/navigation` stays pure so
 * server layouts and node tests can import it; the icons and panel bodies that
 * can only exist in the browser are keyed by `SectionId` here.
 */
export type PanelProps = {
  section: Section;
  /** Called when a link inside the panel is followed; closes the mobile sheet. */
  onNavigate?: () => void;
};

export type SectionUi = {
  icon: LucideIcon;
  /** Sections with no second panel (Settings) leave this undefined. */
  Panel?: ComponentType<PanelProps>;
};

export const SECTION_UI: Record<SectionId, SectionUi> = {
  chat: { icon: MessageSquare, Panel: ChatPanel },
  knowledge: { icon: Network, Panel: KnowledgePanel },
  admin: { icon: ShieldCheck, Panel: AdminPanel },
  settings: { icon: Settings },
};

/**
 * The single resolver for "does this URL have a second column, and what is
 * in it". `SectionPanel` renders what this returns and `AppShell` sizes the
 * sidebar from whether it returns anything — reading it twice from one place
 * is what stops a section growing a panel that has no room to appear in.
 */
export function panelForPathname(
  pathname: string,
): { section: Section; Panel: ComponentType<PanelProps> } | null {
  const sectionId = sectionIdForPathname(pathname);
  if (!sectionId) return null;

  const { Panel } = SECTION_UI[sectionId];
  const section = SECTIONS.find((candidate) => candidate.id === sectionId);
  if (!Panel || !section) return null;

  return { section, Panel };
}

export function hasPanelFor(pathname: string): boolean {
  return panelForPathname(pathname) !== null;
}
