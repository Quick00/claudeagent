import { buildAttention } from '@/lib/knowledge-attention';
import { prisma } from '@/lib/prisma';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgeEntry: { findMany: jest.fn() },
    knowledgeReview: { findMany: jest.fn() },
    repoSync: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/knowledge-repos', () => ({ loadActiveHeadTrees: jest.fn() }));

const mockEntries = prisma.knowledgeEntry.findMany as jest.Mock;
const mockReviews = prisma.knowledgeReview.findMany as jest.Mock;
const mockSyncs = prisma.repoSync.findMany as jest.Mock;
const mockTrees = loadActiveHeadTrees as jest.Mock;

const common = { category: 'p', content: 'c', tags: '', correctionCount: 0, updatedAt: new Date('2026-09-01'), lastRetrievedAt: null };

type Row = Record<string, unknown> & { kind: string };

/** buildAttention queries derived and pinned entries separately; answer each. */
function withEntries(rows: Row[]) {
  mockEntries.mockImplementation(async ({ where }: { where: { kind: string } }) => rows.filter((r) => r.kind === where.kind));
}

describe('buildAttention', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTrees.mockResolvedValue(new Map([[1, { commitSha: 'h', blobs: new Map([['a.php', 'A']]) }]]));
    mockReviews.mockResolvedValue([]);
    mockSyncs.mockResolvedValue([]);
  });

  it('splits derived entries into stale and unverified, sorted by hitCount desc, and never lists pinned or fresh', async () => {
    withEntries([
      { ...common, id: 'fresh', subject: 'F', kind: 'derived', hitCount: 9, sources: [{ gitlabProjectId: 1, path: 'a.php', blobSha: 'A', verifiedAt: new Date('2026-09-05') }] },
      { ...common, id: 'stale-lo', subject: 'S1', kind: 'derived', hitCount: 1, sources: [{ gitlabProjectId: 1, path: 'a.php', blobSha: 'OLD', verifiedAt: new Date('2026-08-01') }] },
      { ...common, id: 'stale-hi', subject: 'S2', kind: 'derived', hitCount: 5, sources: [{ gitlabProjectId: 1, path: 'gone.php', blobSha: 'X', verifiedAt: new Date('2026-08-02') }] },
      { ...common, id: 'unv', subject: 'U', kind: 'derived', hitCount: 3, sources: [] },
      { ...common, id: 'pin', subject: 'P', kind: 'pinned', hitCount: 0, sources: [] },
    ]);

    const out = await buildAttention();

    expect(out.stale.map((i) => i.id)).toEqual(['stale-hi', 'stale-lo']);
    expect(out.stale[0]).toMatchObject({ changedPaths: ['gone.php'], sourceCount: 1, lastVerifiedAt: new Date('2026-08-02') });
    expect(out.unverified.map((i) => i.id)).toEqual(['unv']);
    expect(out.stale.map((i) => i.id)).not.toContain('pin');
    expect(out.unverified.map((i) => i.id)).not.toContain('pin');
    expect(mockEntries).toHaveBeenCalledWith({ where: { status: 'active', kind: 'derived' }, include: { sources: true } });
  });

  it('lists active pinned entries in their own bucket so they stay reachable for unpin, edit and retire', async () => {
    // Pinned entries are always fresh, so they appear in neither stale nor
    // unverified. Without this list, pinning an entry hid it from the panel
    // for good and unpinning (spec 10.2) could only be done in the database.
    withEntries([
      { ...common, id: 'd1', subject: 'D', kind: 'derived', hitCount: 0, sources: [] },
      { ...common, id: 'pin', subject: 'Refund policy', kind: 'pinned', hitCount: 4, sources: [] },
    ]);

    const out = await buildAttention();

    expect(out.pinned.map((i) => i.id)).toEqual(['pin']);
    expect(out.pinned[0]).toMatchObject({ subject: 'Refund policy', kind: 'pinned', changedPaths: [], hitCount: 4 });
    expect(mockEntries).toHaveBeenCalledWith({ where: { status: 'active', kind: 'pinned' }, include: { sources: true }, orderBy: { updatedAt: 'desc' } });
  });

  it('passes through open reviews and the last 20 syncs with repository names', async () => {
    withEntries([]);
    mockReviews.mockResolvedValue([{ id: 'r1', type: 'supersedes', payload: { newEntryId: 'n' }, createdAt: new Date(), entry: { id: 'e', subject: 'S', kind: 'derived', content: 'c' } }]);
    mockSyncs.mockResolvedValue([{ id: 's1', gitlabProjectId: 1, fromSha: 'a', toSha: 'b', changedFiles: ['x', 'y'], reason: 'sync', wouldStaleCount: 2, syncedAt: new Date(), repository: { name: 'Core' } }]);

    const out = await buildAttention();

    expect(out.reviews).toHaveLength(1);
    expect(out.syncs[0]).toMatchObject({ repositoryName: 'Core', changedFileCount: 2, wouldStaleCount: 2 });
    expect(mockReviews).toHaveBeenCalledWith({ where: { status: 'open' }, orderBy: { createdAt: 'desc' }, include: { entry: { select: { id: true, subject: true, kind: true, content: true } } } });
    expect(mockSyncs).toHaveBeenCalledWith({ orderBy: { syncedAt: 'desc' }, take: 20, include: { repository: { select: { name: true } } } });
  });
});
