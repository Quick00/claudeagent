'use client';

import dynamic from 'next/dynamic';
import { KnowledgeMapSkeleton } from './KnowledgeMapSkeleton';

// The force graph touches `window` at module scope, so it must never be
// evaluated on the server.
const KnowledgeGraph = dynamic(() => import('./KnowledgeGraph'), {
  ssr: false,
  loading: () => <KnowledgeMapSkeleton />,
});

export function KnowledgeMap() {
  return <KnowledgeGraph />;
}
