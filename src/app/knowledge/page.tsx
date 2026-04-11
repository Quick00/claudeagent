'use client';

import dynamic from 'next/dynamic';

const KnowledgeGraph = dynamic(() => import('@/components/KnowledgeGraph'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900">
      Loading knowledge map...
    </div>
  ),
});

export default function KnowledgePage() {
  return <KnowledgeGraph />;
}
