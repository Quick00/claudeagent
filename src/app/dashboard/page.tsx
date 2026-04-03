'use client';

import { useEffect, useState } from 'react';

interface DashboardData {
  stats: {
    totalEntries: number;
    totalConversations: number;
    totalMessages: number;
    categories: Record<string, number>;
  };
  tags: { tag: string; count: number }[];
  entries: {
    id: string;
    category: string;
    content: string;
    tags: string;
    createdAt: string;
  }[];
  entriesByDay: Record<string, number>;
  recentConversations: {
    id: string;
    title: string;
    createdAt: string;
  }[];
}

const CATEGORY_COLORS: Record<string, string> = {
  correction: '#ef4444',
  terminology: '#8b5cf6',
  product_insight: '#10b981',
  process: '#f59e0b',
};

const CATEGORY_LABELS: Record<string, string> = {
  correction: 'Corrections',
  terminology: 'Terminology',
  product_insight: 'Product Insights',
  process: 'Processes',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Loading dashboard...
      </div>
    );
  }

  const filteredEntries = selectedTag
    ? data.entries.filter((e) =>
        e.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .includes(selectedTag)
      )
    : data.entries;

  const maxTagCount = data.tags.length > 0 ? data.tags[0].count : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <a
              href="/"
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              &larr; Chat
            </a>
            <h1 className="text-lg font-semibold text-gray-800">Dashboard</h1>
          </div>
          <a
            href="/knowledge"
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Knowledge Map &rarr;
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Knowledge Entries" value={data.stats.totalEntries} />
          <StatCard label="Conversations" value={data.stats.totalConversations} />
          <StatCard label="Messages" value={data.stats.totalMessages} />
          <StatCard
            label="Topics"
            value={data.tags.length}
          />
        </div>

        {/* Category breakdown */}
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
            By Category
          </h2>
          <div className="flex gap-3">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
              const count = data.stats.categories[key] || 0;
              return (
                <div
                  key={key}
                  className="flex-1 rounded-xl border border-gray-200 bg-white p-4"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[key] }}
                    />
                    <span className="text-sm text-gray-600">{label}</span>
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Tag Cloud */}
          <div className="lg:col-span-1">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
              Topics
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="ml-2 text-xs font-normal normal-case text-blue-500 hover:text-blue-700"
                >
                  Clear filter
                </button>
              )}
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              {data.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.tags.map(({ tag, count }) => {
                    const scale = 0.75 + (count / maxTagCount) * 0.5;
                    const isActive = selectedTag === tag;
                    return (
                      <button
                        key={tag}
                        onClick={() =>
                          setSelectedTag(isActive ? null : tag)
                        }
                        className={`rounded-full px-3 py-1 transition-colors ${
                          isActive
                            ? 'bg-blue-500 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                        }`}
                        style={{ fontSize: `${scale}rem` }}
                      >
                        {tag}
                        <span
                          className={`ml-1 text-xs ${
                            isActive ? 'text-blue-200' : 'text-gray-400'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No topics yet</p>
              )}
            </div>

            {/* Recent conversations */}
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase text-gray-500">
              Recent Conversations
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white">
              {data.recentConversations.length > 0 ? (
                data.recentConversations.map((conv, i) => (
                  <a
                    key={conv.id}
                    href={`/?conversation=${conv.id}`}
                    className={`block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 ${
                      i > 0 ? 'border-t border-gray-100' : ''
                    }`}
                  >
                    <div className="truncate font-medium">{conv.title}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(conv.createdAt).toLocaleDateString()}
                    </div>
                  </a>
                ))
              ) : (
                <p className="p-4 text-sm text-gray-400">No conversations yet</p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
              Knowledge Timeline
              {selectedTag && (
                <span className="ml-2 text-xs font-normal normal-case text-gray-400">
                  Filtered by: {selectedTag}
                </span>
              )}
            </h2>
            <div className="space-y-3">
              {filteredEntries.length > 0 ? (
                filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-gray-200 bg-white p-4"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{
                            backgroundColor:
                              CATEGORY_COLORS[entry.category] || '#6b7280',
                          }}
                        />
                        <span className="text-xs font-medium uppercase text-gray-500">
                          {CATEGORY_LABELS[entry.category] || entry.category}
                        </span>
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-gray-800">
                      {entry.content}
                    </p>
                    {entry.tags && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {entry.tags.split(',').map((tag, i) => {
                          const t = tag.trim();
                          if (!t) return null;
                          return (
                            <button
                              key={`${entry.id}-${i}`}
                              onClick={() => setSelectedTag(t.toLowerCase())}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600"
                            >
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
                  {selectedTag
                    ? `No entries tagged with "${selectedTag}"`
                    : 'No knowledge entries yet — start asking questions!'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-bold text-gray-900">{value}</div>
    </div>
  );
}
