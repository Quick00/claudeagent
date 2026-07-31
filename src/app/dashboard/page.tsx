'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDateTime } from '@/lib/format-date';

interface DashboardData {
  isAdmin: boolean;
  stats: {
    totalEntries: number;
    totalConversations: number;
    totalMessages: number;
    categories: Record<string, number>;
  };
  tags: { tag: string; count: number }[];
  entries: {
    id: string;
    subject: string;
    category: string;
    content: string;
    tags: string;
    createdAt: string;
    updatedAt: string;
  }[];
  entriesByDay: Record<string, number>;
  recentConversations: {
    id: string;
    title: string;
    createdAt: string;
    userName: string;
  }[];
}

interface SearchEntry {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
  similarity: number;
}

const CATEGORY_COLORS: Record<string, string> = {
  terminology: '#8b5cf6',
  product_insight: '#10b981',
  process: '#f59e0b',
  developer: '#0ea5e9',
};

const CATEGORY_LABELS: Record<string, string> = {
  terminology: 'Terminology',
  product_insight: 'Product Insights',
  process: 'Processes',
  developer: 'Developer',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchEntry[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then(setData);
  }, []);

  const performSearch = useCallback((query: string) => {
    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    fetch('/api/dashboard/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), limit: 20 }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        if (!controller.signal.aborted) setSearchResults(data.entries);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSearchResults(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsSearching(false);
      });
  }, []);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) {
        if (abortControllerRef.current) abortControllerRef.current.abort();
        setSearchResults(null);
        setIsSearching(false);
        return;
      }
      setIsSearching(true);
      debounceRef.current = setTimeout(() => performSearch(value), 500);
    },
    [performSearch],
  );

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400 dark:text-gray-500">
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              &larr; Chat
            </Link>
            <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Dashboard</h1>
          </div>
          <a
            href="/knowledge"
            className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Knowledge Map &rarr;
          </a>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Knowledge Pages" value={data.stats.totalEntries} />
          <StatCard label="Conversations" value={data.stats.totalConversations} />
          <StatCard label="Messages" value={data.stats.totalMessages} />
          <StatCard
            label="Topics"
            value={data.tags.length}
          />
        </div>

        {/* Category breakdown */}
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">
            By Category
          </h2>
          <div className="flex gap-3">
            {Object.entries(CATEGORY_LABELS)
              .filter(([key]) => data.isAdmin || key !== 'developer')
              .map(([key, label]) => {
              const count = data.stats.categories[key] || 0;
              return (
                <div
                  key={key}
                  className="flex-1 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: CATEGORY_COLORS[key] }}
                    />
                    <span className="text-sm text-gray-600 dark:text-gray-400">{label}</span>
                  </div>
                  <div className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
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
            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">
              Topics
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag(null)}
                  className="ml-2 text-xs font-normal normal-case text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  Clear filter
                </button>
              )}
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900">
              {data.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(showAllTopics ? data.tags : data.tags.slice(0, 12)).map(({ tag, count }) => {
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
                            : 'bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                        style={{ fontSize: `${scale}rem` }}
                      >
                        {tag}
                        <span
                          className={`ml-1 text-xs ${
                            isActive ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'
                          }`}
                        >
                          {count}
                        </span>
                      </button>
                    );
                  })}
                  {data.tags.length > 12 && (
                    <button
                      onClick={() => setShowAllTopics(!showAllTopics)}
                      className="rounded-full px-3 py-1 text-sm text-blue-500 hover:bg-blue-50 hover:text-blue-600 dark:text-blue-400 dark:hover:bg-gray-800 dark:hover:text-blue-300"
                    >
                      {showAllTopics ? 'Show less' : `Show ${data.tags.length - 12} more`}
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">No topics yet</p>
              )}
            </div>

            {/* Recent conversations */}
            <h2 className="mb-3 mt-8 text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">
              Recent Conversations
            </h2>
            <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
              {data.recentConversations.length > 0 ? (
                data.recentConversations.map((conv, i) => (
                  <a
                    key={conv.id}
                    href={`/conversation/${conv.id}`}
                    className={`block px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800 ${
                      i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''
                    }`}
                  >
                    <div className="truncate font-medium">{conv.title}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {data.isAdmin && (
                        <span className="mr-1 text-gray-500 dark:text-gray-400">{conv.userName} &middot;</span>
                      )}
                      {formatDateTime(conv.createdAt)}
                    </div>
                  </a>
                ))
              ) : (
                <p className="p-4 text-sm text-gray-400 dark:text-gray-500">No conversations yet</p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="lg:col-span-2">
            {/* Search bar */}
            <div className="relative mb-4">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                <svg className="h-4 w-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search knowledge..."
                aria-label="Search knowledge"
                className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-10 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 dark:focus:border-blue-500 dark:focus:ring-blue-500"
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange('')}
                  aria-label="Clear search"
                  className="absolute inset-y-0 right-0 flex items-center pr-3.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500 dark:text-gray-400">
              {searchResults !== null ? (
                <>
                  Search Results
                  <span className="ml-2 text-xs font-normal normal-case text-gray-400 dark:text-gray-500">
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
                  </span>
                </>
              ) : (
                <>
                  Knowledge Timeline
                  {selectedTag && (
                    <span className="ml-2 text-xs font-normal normal-case text-gray-400 dark:text-gray-500">
                      Filtered by: {selectedTag}
                    </span>
                  )}
                </>
              )}
            </h2>

            {isSearching ? (
              <div className="rounded-xl border border-gray-200 bg-white p-8 text-center dark:border-gray-700 dark:bg-gray-900">
                <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
                <p className="mt-2 text-sm text-gray-400 dark:text-gray-500">Searching...</p>
              </div>
            ) : (
            <div className="space-y-3">
              {(searchResults ?? filteredEntries).length > 0 ? (
                (searchResults ?? filteredEntries).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
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
                        <span className="text-xs font-medium uppercase text-gray-500 dark:text-gray-400">
                          {CATEGORY_LABELS[entry.category] || entry.category}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {'similarity' in entry && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                            {(entry as SearchEntry).similarity}% match
                          </span>
                        )}
                        <span className="text-xs text-gray-400 dark:text-gray-500">
                          {formatDateTime(entry.updatedAt)}
                        </span>
                      </div>
                    </div>
                    {entry.subject && (
                      <h3 className="mb-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {entry.subject}
                      </h3>
                    )}
                    <div className="prose prose-sm max-w-none leading-relaxed text-gray-800 prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:mb-1 prose-headings:mt-2 prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600 dark:prose-invert dark:text-gray-200 dark:prose-pre:bg-gray-900">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {entry.content}
                      </ReactMarkdown>
                    </div>
                    {entry.tags && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {entry.tags.split(',').map((tag, i) => {
                          const t = tag.trim();
                          if (!t) return null;
                          return (
                            <button
                              key={`${entry.id}-${i}`}
                              onClick={() => setSelectedTag(t.toLowerCase())}
                              className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500 hover:bg-blue-50 hover:text-blue-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
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
                <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500">
                  {searchResults !== null
                    ? 'No matching knowledge found — try different terms'
                    : selectedTag
                      ? `No entries tagged with "${selectedTag}"`
                      : 'No knowledge entries yet — start asking questions!'}
                </div>
              )}
            </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-3xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}
