import { updateEntry, createPinnedEntry, refreshSourcesToHead } from '@/lib/knowledge-admin';
import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgeEntry: { update: jest.fn(), create: jest.fn() },
    knowledgeSource: { findMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    $executeRaw: jest.fn(),
  },
}));
jest.mock('@/lib/embed-text', () => ({ embedText: jest.fn().mockResolvedValue([0.5]) }));
jest.mock('@/lib/knowledge-repos', () => ({ loadActiveHeadTrees: jest.fn() }));

const mockUpdate = prisma.knowledgeEntry.update as jest.Mock;
const mockCreate = prisma.knowledgeEntry.create as jest.Mock;
const mockSources = prisma.knowledgeSource.findMany as jest.Mock;
const mockSourceUpdate = prisma.knowledgeSource.update as jest.Mock;
const mockSourceDelete = prisma.knowledgeSource.deleteMany as jest.Mock;
const mockTrees = loadActiveHeadTrees as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('updateEntry', () => {
  it('updates fields and re-embeds only when content changes', async () => {
    await updateEntry('e1', { subject: 'New' });
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { subject: 'New' } });
    expect(embedText).not.toHaveBeenCalled();

    await updateEntry('e1', { content: 'changed' });
    expect(embedText).toHaveBeenCalledWith('changed');
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });

  it('does not write the content when the embedding call fails', async () => {
    // Embedding is a network call. Writing content first would leave the entry
    // described by the previous text's vector, with nothing to detect it — and
    // would make the callers that compensate on failure (the verification run
    // marking itself "failed", the review reopening) report the opposite of
    // what happened.
    (embedText as jest.Mock).mockRejectedValueOnce(new Error('openrouter down'));

    await expect(updateEntry('e1', { content: 'new text' })).rejects.toThrow('openrouter down');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects an invalid category or kind', async () => {
    await expect(updateEntry('e1', { category: 'nope' })).rejects.toThrow('Invalid category');
    await expect(updateEntry('e1', { kind: 'other' as never })).rejects.toThrow('Invalid kind');
  });
});

describe('createPinnedEntry', () => {
  it('creates nothing when the embedding call fails', async () => {
    (embedText as jest.Mock).mockRejectedValueOnce(new Error('openrouter down'));
    await expect(createPinnedEntry({ subject: 'S', content: 'C', category: 'process', tags: '' })).rejects.toThrow('openrouter down');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('creates with kind pinned and embeds', async () => {
    mockCreate.mockResolvedValue({ id: 'p1' });
    const id = await createPinnedEntry({ subject: 'Refund Policy', content: '14 days', category: 'process', tags: 'refunds' });
    expect(id).toBe('p1');
    expect(mockCreate).toHaveBeenCalledWith({ data: { subject: 'Refund Policy', content: '14 days', category: 'process', tags: 'refunds', kind: 'pinned' } });
    expect(prisma.$executeRaw).toHaveBeenCalled();
  });
});

describe('refreshSourcesToHead', () => {
  it('rewrites blob and commit for sources present at HEAD and deletes sources whose file is gone', async () => {
    mockTrees.mockResolvedValue(new Map([[1, { commitSha: 'h2', blobs: new Map([['a.php', 'NEW']]) }]]));
    mockSources.mockResolvedValue([
      { id: 's1', gitlabProjectId: 1, path: 'a.php', blobSha: 'OLD' },
      { id: 's2', gitlabProjectId: 1, path: 'gone.php', blobSha: 'X' },
    ]);
    const n = await refreshSourcesToHead('e1');
    expect(n).toBe(1);
    expect(mockSourceUpdate).toHaveBeenCalledWith({ where: { id: 's1' }, data: { blobSha: 'NEW', commitSha: 'h2', verifiedAt: expect.any(Date) } });
    expect(mockSourceDelete).toHaveBeenCalledWith({ where: { id: { in: ['s2'] } } });
  });
});
