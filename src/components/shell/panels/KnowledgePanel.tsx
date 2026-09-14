'use client';

import type { PanelProps } from '../sections';
import { SubNav } from './SubNav';

export function KnowledgePanel({ section, onNavigate }: PanelProps) {
  return <SubNav items={section.children ?? []} onNavigate={onNavigate} />;
}
