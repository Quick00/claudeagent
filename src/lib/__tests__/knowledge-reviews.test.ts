import { resolveReview } from '@/lib/knowledge-reviews';
import { prisma } from '@/lib/prisma';
import { updateEntry, refreshSourcesToHead } from '@/lib/knowledge-admin';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgeReview: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    knowledgeEntry: { findUnique: jest.fn() },
  },
}));
jest.mock('@/lib/knowledge-admin', () => ({ updateEntry: jest.fn(), refreshSourcesToHead: jest.fn() }));

const mockFind = prisma.knowledgeReview.findUnique as jest.Mock;
const mockUpdateMany = prisma.knowledgeReview.updateMany as jest.Mock;
const mockUpdate = prisma.knowledgeReview.update as jest.Mock;
const mockFindEntry = prisma.knowledgeEntry.findUnique as jest.Mock;
const mockUpdateEntry = updateEntry as jest.Mock;
const mockRefreshSources = refreshSourcesToHead as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateMany.mockResolvedValue({ count: 1 });
  mockFindEntry.mockResolvedValue({ kind: 'derived' });
});

function review(type: string, payload: unknown, status = 'open') {
  return { id: 'r1', entryId: 'e1', type, payload, status };
}

describe('resolveReview', () => {
  it('throws for an unknown review', async () => {
    mockFind.mockResolvedValue(null);
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow('Review not found');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('throws for an already-resolved review without writing anything', async () => {
    mockFind.mockResolvedValue(review('supersedes', {}, 'resolved'));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow('already resolved');
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('dismiss only closes the review and never touches the entry', async () => {
    mockFind.mockResolvedValue(review('pinned_conflict', { proposedContent: 'x' }));
    await resolveReview('r1', 'dismiss', 'a1');
    expect(mockUpdateEntry).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'open' },
      data: { status: 'resolved', resolvedAt: expect.any(Date), resolvedById: 'a1' },
    });
  });

  it('accept pinned_conflict rewrites the pinned entry content', async () => {
    mockFind.mockResolvedValue(review('pinned_conflict', { proposedContent: 'Refunds within 30 days.' }));
    await resolveReview('r1', 'accept', 'a1');
    expect(mockUpdateEntry).toHaveBeenCalledWith('e1', { content: 'Refunds within 30 days.' });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'open' },
      data: { status: 'resolved', resolvedAt: expect.any(Date), resolvedById: 'a1' },
    });
  });

  it('accept supersedes retires the stale entry (the review\'s own entry, not the payload)', async () => {
    mockFind.mockResolvedValue(review('supersedes', { newEntryId: 'n1' }));
    await resolveReview('r1', 'accept', 'a1');
    expect(mockUpdateEntry).toHaveBeenCalledWith('e1', { status: 'retired' });
  });

  it('accept proposed_update applies suggested content and refreshes sources to HEAD', async () => {
    mockFind.mockResolvedValue(review('proposed_update', { suggestedContent: 'new text' }));
    await resolveReview('r1', 'accept', 'a1');
    expect(mockUpdateEntry).toHaveBeenCalledWith('e1', { content: 'new text' });
    expect(mockRefreshSources).toHaveBeenCalledWith('e1');
  });

  it('fails safely on a malformed pinned_conflict payload: no claim, no entry write', async () => {
    mockFind.mockResolvedValue(review('pinned_conflict', { reason: 'missing the content field' }));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow(/malformed/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it('fails safely on a malformed proposed_update payload (wrong type for suggestedContent)', async () => {
    mockFind.mockResolvedValue(review('proposed_update', { suggestedContent: 123 }));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow(/malformed/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it('fails safely on a null payload', async () => {
    mockFind.mockResolvedValue(review('pinned_conflict', null));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow(/malformed/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects an unrecognized review type', async () => {
    mockFind.mockResolvedValue(review('something_else', {}));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow(/unknown review type/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('refuses a proposed_update accept on an entry pinned since the review was queued', async () => {
    // Pinning is how a human takes ownership of a page. Accepting a queued
    // model suggestion afterwards would write Claude's text into that rule.
    mockFind.mockResolvedValue(review('proposed_update', { suggestedContent: 'model text' }));
    mockFindEntry.mockResolvedValue({ kind: 'pinned' });

    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow(/pinned/i);
    expect(mockUpdateMany).not.toHaveBeenCalled();
    expect(mockUpdateEntry).not.toHaveBeenCalled();
    expect(mockRefreshSources).not.toHaveBeenCalled();
  });

  it('still allows a pinned_conflict accept on a pinned entry — overwriting the rule is its purpose', async () => {
    mockFind.mockResolvedValue(review('pinned_conflict', { proposedContent: 'admin-approved text' }));
    mockFindEntry.mockResolvedValue({ kind: 'pinned' });

    await resolveReview('r1', 'accept', 'a1');
    expect(mockUpdateEntry).toHaveBeenCalledWith('e1', { content: 'admin-approved text' });
  });

  it('dismissing a proposed_update on a pinned entry is always allowed', async () => {
    mockFind.mockResolvedValue(review('proposed_update', { suggestedContent: 'model text' }));
    mockFindEntry.mockResolvedValue({ kind: 'pinned' });

    await resolveReview('r1', 'dismiss', 'a1');
    expect(mockUpdateEntry).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it('is race-safe: a lost claim (updateMany matches zero rows) throws instead of applying the mutation', async () => {
    mockFind.mockResolvedValue(review('supersedes', {}));
    mockUpdateMany.mockResolvedValue({ count: 0 });
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow('already resolved');
    expect(mockUpdateEntry).not.toHaveBeenCalled();
  });

  it('reverts the claim if the accept mutation unexpectedly fails, instead of leaving the review falsely resolved', async () => {
    mockFind.mockResolvedValue(review('supersedes', {}));
    mockUpdateEntry.mockRejectedValue(new Error('db exploded'));
    await expect(resolveReview('r1', 'accept', 'a1')).rejects.toThrow('db exploded');
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { status: 'open', resolvedAt: null, resolvedById: null },
    });
  });
});
