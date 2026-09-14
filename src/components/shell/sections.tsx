'use client';

import type { ComponentType } from 'react';
import { MessageSquare, Network, Settings, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Section, SectionId } from '@/lib/navigation';
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
