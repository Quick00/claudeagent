import { saveKnowledge, toSourceInputs } from '@/lib/knowledge-save';
import { prisma } from '@/lib/prisma';
import { embedText, findSimilarPages } from '@/lib/embeddings';
import { askLibrarian } from '@/lib/knowledge-librarian';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import { provenanceCollector } from '@/lib/provenance-collector';
import type { HeadTree } from '@/lib/repo-tree';

jest.mock('@/lib/prisma', () => {
  const tx = {
    knowledgeEntry: { update: jest.fn() },
    knowledgeSource: { upsert: jest.fn() },
    $executeRaw: jest.fn(),
  };
  return {
    prisma: {
      knowledgeEntry: { create: jest.fn(), findUnique: jest.fn() },
      knowledgeSource: { findMany: jest.fn() },
      $executeRaw: jest.fn(),
      $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
      __tx: tx,
    },
  };
});
jest.mock('@/lib/embeddings', () => ({ embedText: jest.fn(), findSimilarPages: jest.fn() }));
jest.mock('@/lib/knowledge-librarian', () => ({ askLibrarian: jest.fn() }));
jest.mock('@/lib/knowledge-repos', () => ({ loadActiveHeadTrees: jest.fn() }));
jest.mock('@/lib/config', () => ({
  config: { knowledgeMaxSourcesPerSave: 15, knowledgeIgnoreSegments: [], knowledgeIgnoreBasenames: [] },
}));

const mockCreate = prisma.knowledgeEntry.create as jest.Mock;
const mockFindUnique = prisma.knowledgeEntry.findUnique as jest.Mock;
const mockEntrySources = prisma.knowledgeSource.findMany as jest.Mock;
const mockEmbed = embedText as jest.Mock;
const mockSimilar = findSimilarPages as jest.Mock;
const mockLibrarian = askLibrarian as jest.Mock;
const mockTrees = loadActiveHeadTrees as jest.Mock;
const tx = (prisma as unknown as { __tx: { knowledgeEntry: { update: jest.Mock }; knowledgeSource: { upsert: jest.Mock } } }).__tx;

const tree: HeadTree = { commitSha: 'head1', blobs: new Map([['a.php', 'blobA'], ['b.php', 'blobB']]) };
const trees = new Map([[1, tree]]);
const repos = [{ gitlabProjectId: 1, localPath: '/repos/1' }];

describe('toSourceInputs', () => {
  it('attaches blob and commit, dropping paths not in HEAD', () => {
    const out = toSourceInputs(
      [{ gitlabProjectId: 1, relativePath: 'a.php' }, { gitlabProjectId: 1, relativePath: 'gone.php' }, { gitlabProjectId: 7, relativePath: 'a.php' }],
      trees,
    );
    expect(out).toEqual([{ gitlabProjectId: 1, path: 'a.php', blobSha: 'blobA', commitSha: 'head1' }]);
  });
});

describe('saveKnowledge', () => {
  // Every branch logs its decision; keep the suite output clean.
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  afterAll(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockTrees.mockResolvedValue(trees);
    mockEmbed.mockResolvedValue([0.1, 0.2]);
    mockCreate.mockResolvedValue({ id: 'new-id' });
    mockEntrySources.mockResolvedValue([]);
    provenanceCollector.end('m1');
    provenanceCollector.start('m1', repos);
  });

  it('creates an entry with sources from the provenance window and marks the save', async () => {
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/a.php' });
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/b.php' });
    mockSimilar.mockResolvedValue([]);

    const result = await saveKnowledge({ category: 'product_insight', content: 'Badges print per attendee.', subject: 'Badge Printing', provenanceKey: 'm1' });

    expect(result).toMatchObject({ status: 'saved', action: 'create', id: 'new-id', sourceCount: 2 });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: 'Badge Printing',
        sources: {
          create: [
            { gitlabProjectId: 1, path: 'a.php', blobSha: 'blobA', commitSha: 'head1' },
            { gitlabProjectId: 1, path: 'b.php', blobSha: 'blobB', commitSha: 'head1' },
          ],
        },
      }),
    });
    // window consumed: next snapshot with a new read only contains the new read
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/b.php' });
    expect(provenanceCollector.snapshot('m1').map((p) => p.relativePath)).toEqual(['b.php']);
  });

  it('narrows sources with based_on', async () => {
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/a.php' });
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/b.php' });
    mockSimilar.mockResolvedValue([]);

    await saveKnowledge({ category: 'process', content: 'x', provenanceKey: 'm1', basedOn: ['b.php'] });

    const data = mockCreate.mock.calls[0][0].data;
    expect(data.sources.create.map((s: { path: string }) => s.path)).toEqual(['b.php']);
  });

  it('creates with zero sources when there is no provenance key (unverified)', async () => {
    mockSimilar.mockResolvedValue([]);
    const result = await saveKnowledge({ category: 'terminology', content: 'A cluster groups sessions.' });
    expect(result).toMatchObject({ action: 'create', sourceCount: 0 });
    expect(mockCreate.mock.calls[0][0].data.sources.create).toEqual([]);
  });

  it('on update refreshes only the sources read in this run and bumps correctionCount when the page was fresh', async () => {
    provenanceCollector.recordToolUse('m1', 'Read', { file_path: '/repos/1/a.php' });
    mockSimilar.mockResolvedValue([{ id: 'p1', subject: 'Badge Printing', content: 'old', category: 'product_insight', tags: 'badges', kind: 'derived', similarity: 0.9 }]);
    mockEntrySources.mockResolvedValue([
      { entryId: 'p1', gitlabProjectId: 1, path: 'a.php', blobSha: 'blobA' },
      { entryId: 'p1', gitlabProjectId: 1, path: 'b.php', blobSha: 'blobB' },
    ]);
    mockFindUnique.mockResolvedValue({
      id: 'p1', kind: 'derived',
      sources: [
        { gitlabProjectId: 1, path: 'a.php', blobSha: 'blobA' },
        { gitlabProjectId: 1, path: 'b.php', blobSha: 'blobB' },
      ],
    });
    mockLibrarian.mockResolvedValue({ action: 'update', pageId: 'p1', subject: 'Badge Printing', content: 'new', tags: 'badges' });

    const result = await saveKnowledge({ category: 'product_insight', content: 'new fact', provenanceKey: 'm1' });

    expect(result).toMatchObject({ action: 'update', id: 'p1', sourceCount: 1 });
    expect(tx.knowledgeEntry.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { subject: 'Badge Printing', content: 'new', tags: 'badges', correctionCount: { increment: 1 } },
    });
    expect(tx.knowledgeSource.upsert).toHaveBeenCalledTimes(1);
    expect(tx.knowledgeSource.upsert.mock.calls[0][0].where).toEqual({
      entryId_gitlabProjectId_path: { entryId: 'p1', gitlabProjectId: 1, path: 'a.php' },
    });
    // librarian saw freshness + based-on paths
    expect(mockLibrarian).toHaveBeenCalledWith(expect.objectContaining({
      basedOnPaths: ['a.php'],
      candidates: [expect.objectContaining({ id: 'p1', freshness: { state: 'fresh' } })],
    }));
  });

  it('does not bump correctionCount when the page was stale', async () => {
    mockSimilar.mockResolvedValue([{ id: 'p1', subject: 's', content: 'old', category: 'process', tags: '', kind: 'derived', similarity: 0.9 }]);
    mockEntrySources.mockResolvedValue([{ entryId: 'p1', gitlabProjectId: 1, path: 'a.php', blobSha: 'OLD' }]);
    mockFindUnique.mockResolvedValue({ id: 'p1', kind: 'derived', sources: [{ gitlabProjectId: 1, path: 'a.php', blobSha: 'OLD' }] });
    mockLibrarian.mockResolvedValue({ action: 'update', pageId: 'p1', subject: 's', content: 'new', tags: '' });

    await saveKnowledge({ category: 'process', content: 'x', provenanceKey: 'm1' });

    expect(tx.knowledgeEntry.update.mock.calls[0][0].data).toEqual({ subject: 's', content: 'new', tags: '' });
  });

  it('falls back to create when the librarian returns an unknown pageId', async () => {
    mockSimilar.mockResolvedValue([{ id: 'p1', subject: 's', content: 'old', category: 'process', tags: '', kind: 'derived', similarity: 0.9 }]);
    mockLibrarian.mockResolvedValue({ action: 'update', pageId: 'bogus', subject: 's2', content: 'c2', tags: 't' });
    const result = await saveKnowledge({ category: 'process', content: 'x' });
    expect(result).toMatchObject({ action: 'create', subject: 's2' });
  });

  it('returns skipped without writing', async () => {
    mockSimilar.mockResolvedValue([{ id: 'p1', subject: 's', content: 'old', category: 'process', tags: '', kind: 'derived', similarity: 0.9 }]);
    mockLibrarian.mockResolvedValue({ action: 'skip', reason: 'covered', coveredBy: 's' });
    const result = await saveKnowledge({ category: 'process', content: 'x' });
    expect(result).toEqual({ status: 'skipped', action: 'skip', reason: 'covered', message: "Already covered in 's'." });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(tx.knowledgeEntry.update).not.toHaveBeenCalled();
  });

  it('saves without embedding when embedText fails', async () => {
    mockEmbed.mockRejectedValue(new Error('down'));
    const result = await saveKnowledge({ category: 'process', content: 'x', subject: 'S' });
    expect(result).toMatchObject({ action: 'create', subject: 'S' });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
