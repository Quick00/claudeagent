import { prisma } from '@/lib/prisma';
import { computeFreshness } from '@/lib/knowledge-freshness';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';

export interface AttentionItem {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  kind: string;
  hitCount: number;
  lastRetrievedAt: Date | null;
  correctionCount: number;
  updatedAt: Date;
  sourceCount: number;
  lastVerifiedAt: Date | null;
  changedPaths: string[];
}

export interface AttentionReview {
  id: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  entry: { id: string; subject: string; kind: string; content: string };
}

export interface AttentionSync {
  id: string;
  gitlabProjectId: number;
  repositoryName: string | null;
  fromSha: string;
  toSha: string;
  changedFileCount: number;
  reason: string;
  wouldStaleCount: number;
  syncedAt: Date;
}

export interface Attention {
  stale: AttentionItem[];
  unverified: AttentionItem[];
  pinned: AttentionItem[];
  reviews: AttentionReview[];
  syncs: AttentionSync[];
}

interface EntryWithSources {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  kind: string;
  hitCount: number;
  lastRetrievedAt: Date | null;
  correctionCount: number;
  updatedAt: Date;
  sources: Array<{ verifiedAt: Date }>;
}

function toItem(e: EntryWithSources, changedPaths: string[]): AttentionItem {
  return {
    id: e.id,
    subject: e.subject,
    category: e.category,
    content: e.content,
    tags: e.tags,
    kind: e.kind,
    hitCount: e.hitCount,
    lastRetrievedAt: e.lastRetrievedAt,
    correctionCount: e.correctionCount,
    updatedAt: e.updatedAt,
    sourceCount: e.sources.length,
    lastVerifiedAt: e.sources.reduce<Date | null>(
      (max: Date | null, s: { verifiedAt: Date }) => (!max || s.verifiedAt > max ? s.verifiedAt : max),
      null,
    ),
    changedPaths,
  };
}

/**
 * Everything an admin might need to act on. Stale/unverified are computed
 * live from KnowledgeSource blob hashes against the current HEAD trees on
 * every call — nothing about freshness is stored. Pinned entries are always
 * fresh (see computeFreshness) so they never appear in those two lists; they
 * get their own list instead, because spec §10.2 makes unpin an admin action
 * and a pinned entry that appeared in no tab could never be unpinned, edited
 * or retired from the panel again.
 */
export async function buildAttention(): Promise<Attention> {
  const [headTrees, entries, pinnedEntries, reviews, syncs] = await Promise.all([
    loadActiveHeadTrees(),
    prisma.knowledgeEntry.findMany({ where: { status: 'active', kind: 'derived' }, include: { sources: true } }),
    prisma.knowledgeEntry.findMany({ where: { status: 'active', kind: 'pinned' }, include: { sources: true }, orderBy: { updatedAt: 'desc' } }),
    prisma.knowledgeReview.findMany({
      where: { status: 'open' },
      orderBy: { createdAt: 'desc' },
      include: { entry: { select: { id: true, subject: true, kind: true, content: true } } },
    }),
    prisma.repoSync.findMany({ orderBy: { syncedAt: 'desc' }, take: 20, include: { repository: { select: { name: true } } } }),
  ]);

  const stale: AttentionItem[] = [];
  const unverified: AttentionItem[] = [];

  for (const e of entries) {
    const freshness = computeFreshness(e, e.sources, headTrees);
    if (freshness.state === 'fresh') continue;
    const item = toItem(e, freshness.state === 'stale' ? freshness.changedPaths : []);
    (freshness.state === 'stale' ? stale : unverified).push(item);
  }

  const byHitsDesc = (a: AttentionItem, b: AttentionItem) => b.hitCount - a.hitCount;
  stale.sort(byHitsDesc);
  unverified.sort(byHitsDesc);

  return {
    stale,
    unverified,
    pinned: pinnedEntries.map((e) => toItem(e, [])),
    reviews: reviews.map((r) => ({ id: r.id, type: r.type, payload: r.payload, createdAt: r.createdAt, entry: r.entry })),
    syncs: syncs.map((s) => ({
      id: s.id,
      gitlabProjectId: s.gitlabProjectId,
      repositoryName: s.repository?.name ?? null,
      fromSha: s.fromSha,
      toSha: s.toSha,
      changedFileCount: s.changedFiles.length,
      reason: s.reason,
      wouldStaleCount: s.wouldStaleCount,
      syncedAt: s.syncedAt,
    })),
  };
}
