'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Inbox, MessagesSquare, Search, Tags, X } from 'lucide-react';
import { apiFetch, jsonBody } from '@/lib/api';
import { formatDateTime } from '@/lib/format-date';
import { ROUTES } from '@/lib/navigation';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { MarkdownContent } from '@/components/shared/MarkdownContent';
import { PageContainer } from '@/components/shared/PageContainer';
import { RiseIn } from '@/components/shared/RiseIn';
import { useAnimatedNumber } from '@/hooks/use-animated-number';
import { useDeferredSkeleton } from '@/hooks/use-deferred-skeleton';
import { KnowledgeDashboardSkeleton } from './KnowledgeDashboardSkeleton';

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

// Category swatches are data-driven colour coding, not decorative chrome —
// they stay as literal colour values rather than Tailwind palette classes.
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

export function KnowledgeDashboard() {
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dashboardQuery = useQuery({
    queryKey: qk.knowledge.dashboard(),
    queryFn: ({ signal }) => apiFetch<DashboardData>('/api/dashboard', { signal }),
  });
  const data = dashboardQuery.data;

  // Query cancels a superseded in-flight request on its own (once the query
  // key changes), so there is no manual AbortController here — the request's
  // signal still has to reach `apiFetch`, though, or a stale response could
  // resolve after a newer one.
  const searchResultsQuery = useQuery({
    queryKey: qk.knowledge.search(debouncedQuery),
    queryFn: ({ signal }) =>
      apiFetch<{ entries: SearchEntry[] }>(
        '/api/dashboard/search',
        { ...jsonBody('POST', { query: debouncedQuery, limit: 20 }), signal },
      ),
    enabled: debouncedQuery.length > 0,
    // Keeps the previous search's results on screen while the next term's
    // request is in flight, instead of the old behaviour of swapping to a
    // loading skeleton on every keystroke.
    placeholderData: keepPreviousData,
  });

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    debounceRef.current = setTimeout(() => setDebouncedQuery(trimmed), 500);
  }, []);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const isSearchActive = debouncedQuery.length > 0;
  // `isPending` (no cached data for this query yet) rather than `isFetching`:
  // once a search has resolved once, switching to a new term keeps the
  // previous results visible (via placeholderData) instead of blanking to a
  // skeleton on every keystroke.
  const isSearching = isSearchActive && searchResultsQuery.isPending;
  const searchError = isSearchActive && searchResultsQuery.isError;
  const searchResults = isSearchActive ? (searchResultsQuery.data?.entries ?? null) : null;

  const showSkeleton = useDeferredSkeleton(dashboardQuery.isPending);

  if (dashboardQuery.isPending) {
    // Within the initial grace period this renders nothing at all — see
    // useDeferredSkeleton — so a fast response never flashes the skeleton.
    return showSkeleton ? <KnowledgeDashboardSkeleton /> : null;
  }

  if (dashboardQuery.isError || !data) {
    return (
      <PageContainer>
        <EmptyState
          icon={Inbox}
          title="Couldn't load the dashboard"
          description="Try refreshing the page."
        />
      </PageContainer>
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
  const visibleEntries = searchResults ?? filteredEntries;

  return (
    <PageContainer className="space-y-8">
      {/* Stats */}
      <RiseIn delay={0} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Knowledge Pages" value={data.stats.totalEntries} />
        <StatCard label="Conversations" value={data.stats.totalConversations} />
        <StatCard label="Messages" value={data.stats.totalMessages} />
        <StatCard label="Topics" value={data.tags.length} />
      </RiseIn>

      {/* Category breakdown */}
      <RiseIn delay={0.06}>
        <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">By Category</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(CATEGORY_LABELS)
            .filter(([key]) => data.isAdmin || key !== 'developer')
            .map(([key, label]) => {
              const count = data.stats.categories[key] || 0;
              return <CategoryCard key={key} label={label} count={count} color={CATEGORY_COLORS[key]} />;
            })}
        </div>
      </RiseIn>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Tag Cloud */}
        <RiseIn delay={0.12} className="lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
            Topics
            {selectedTag && (
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => setSelectedTag(null)}
                className="ml-2 h-auto p-0 text-xs font-normal normal-case"
              >
                Clear filter
              </Button>
            )}
          </h2>
          <Card size="sm">
            <CardContent>
              {data.tags.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {(showAllTopics ? data.tags : data.tags.slice(0, 12)).map(({ tag, count }) => {
                    const scale = 0.75 + (count / maxTagCount) * 0.5;
                    const isActive = selectedTag === tag;
                    return (
                      <Button
                        key={tag}
                        type="button"
                        variant={isActive ? 'default' : 'secondary'}
                        size="sm"
                        onClick={() => setSelectedTag(isActive ? null : tag)}
                        className="h-auto rounded-full px-3 py-1"
                        style={{ fontSize: `${scale}rem` }}
                      >
                        {tag}
                        <span className={cn(isActive ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
                          {count}
                        </span>
                      </Button>
                    );
                  })}
                  {data.tags.length > 12 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllTopics(!showAllTopics)}
                      className="rounded-full text-primary"
                    >
                      {showAllTopics ? 'Show less' : `Show ${data.tags.length - 12} more`}
                    </Button>
                  )}
                </div>
              ) : (
                <EmptyState icon={Tags} title="No topics yet" className="p-6" />
              )}
            </CardContent>
          </Card>

          {/* Recent conversations */}
          <h2 className="mb-3 mt-8 text-sm font-semibold uppercase text-muted-foreground">
            Recent Conversations
          </h2>
          <Card size="sm" className="py-0">
            <CardContent className="px-0">
              {data.recentConversations.length > 0 ? (
                data.recentConversations.map((conv, i) => (
                  <Link
                    key={conv.id}
                    href={ROUTES.chat(conv.id)}
                    className={cn(
                      'block px-4 py-3 text-sm text-foreground hover:bg-muted',
                      i > 0 && 'border-t border-border',
                    )}
                  >
                    <div className="truncate font-medium">{conv.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {data.isAdmin && <span className="mr-1">{conv.userName} &middot;</span>}
                      {formatDateTime(conv.createdAt)}
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState icon={MessagesSquare} title="No conversations yet" className="p-6" />
              )}
            </CardContent>
          </Card>
        </RiseIn>

        {/* Timeline */}
        <RiseIn delay={0.18} className="lg:col-span-2">
          {/* Search bar */}
          <InputGroup className="mb-4">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search knowledge..."
              aria-label="Search knowledge"
            />
            {searchQuery && (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  size="icon-xs"
                  aria-label="Clear search"
                  onClick={() => handleSearchChange('')}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>

          <h2 className="mb-3 text-sm font-semibold uppercase text-muted-foreground">
            {searchResults !== null ? (
              <>
                Search Results
                <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
                  {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
                </span>
              </>
            ) : (
              <>
                Knowledge Timeline
                {selectedTag && (
                  <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
                    Filtered by: {selectedTag}
                  </span>
                )}
              </>
            )}
          </h2>

          {isSearching ? (
            <div className="space-y-3">
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : searchError ? (
            <EmptyState
              icon={Inbox}
              title="Couldn't search knowledge"
              description="Try again in a moment."
            />
          ) : (
            <div className="space-y-3">
              {visibleEntries.length > 0 ? (
                visibleEntries.map((entry) => (
                  <Card key={entry.id} size="sm">
                    <CardContent>
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: CATEGORY_COLORS[entry.category] || '#6b7280' }}
                          />
                          <span className="text-xs font-medium uppercase text-muted-foreground">
                            {CATEGORY_LABELS[entry.category] || entry.category}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {'similarity' in entry && (
                            <Badge variant="secondary">{(entry as SearchEntry).similarity}% match</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {formatDateTime(entry.updatedAt)}
                          </span>
                        </div>
                      </div>
                      {entry.subject && (
                        <h3 className="mb-1 text-sm font-semibold text-foreground">{entry.subject}</h3>
                      )}
                      <MarkdownContent content={entry.content} density="compact" />
                      {entry.tags && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.tags.split(',').map((tag, i) => {
                            const t = tag.trim();
                            if (!t) return null;
                            return (
                              <Button
                                key={`${entry.id}-${i}`}
                                type="button"
                                variant="secondary"
                                size="xs"
                                onClick={() => setSelectedTag(t.toLowerCase())}
                                className="h-auto rounded-full px-2 py-0.5 text-xs"
                              >
                                {t}
                              </Button>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))
              ) : (
                <EmptyState
                  icon={Inbox}
                  title={
                    searchResults !== null
                      ? 'No matching knowledge found'
                      : selectedTag
                        ? `No entries tagged with "${selectedTag}"`
                        : 'No knowledge entries yet'
                  }
                  description={
                    searchResults !== null
                      ? 'Try different search terms'
                      : selectedTag
                        ? undefined
                        : 'Start asking questions in the chat to build the knowledge base'
                  }
                />
              )}
            </div>
          )}
        </RiseIn>
      </div>
    </PageContainer>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  const animated = useAnimatedNumber(value);
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-1 text-3xl font-bold text-foreground">{animated}</div>
      </CardContent>
    </Card>
  );
}

function CategoryCard({ label, count, color }: { label: string; count: number; color: string }) {
  const animated = useAnimatedNumber(count);
  return (
    <Card size="sm">
      <CardContent>
        <div className="flex items-center gap-2">
          <span className="size-3 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-sm text-muted-foreground">{label}</span>
        </div>
        <div className="mt-1 text-2xl font-bold text-foreground">{animated}</div>
      </CardContent>
    </Card>
  );
}
