import {
  BookOpen,
  Flag,
  FolderGit2,
  LayoutDashboard,
  MessageSquare,
  MessageSquareText,
  MessagesSquare,
  Network,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import type { ChildIconKey, SectionId } from '@/lib/navigation';

/**
 * Every glyph the shell's navigation uses, keyed by the plain string ids that
 * `@/lib/navigation` declares. The registry stays pure of `next/*` and React
 * components so the rail, the section panels and the sub-nav can all import it
 * without cycling back through `sections.tsx`.
 */
export const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  chat: MessageSquare,
  knowledge: Network,
  admin: ShieldCheck,
  settings: Settings,
};

export const CHILD_ICONS: Record<ChildIconKey, LucideIcon> = {
  map: Waypoints,
  dashboard: LayoutDashboard,
  users: Users,
  conversations: MessagesSquare,
  flags: Flag,
  feedback: MessageSquareText,
  repos: FolderGit2,
  knowledge: BookOpen,
  settings: SlidersHorizontal,
};
