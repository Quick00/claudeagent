'use client';

import dynamic from 'next/dynamic';

const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-gray-400">
      Loading knowledge map...
    </div>
  ),
});

export default function KnowledgePage() {
  return <KnowledgeGraph />;
}
