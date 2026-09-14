import { findRelevantEntries, findSimilarPages } from '@/lib/embeddings';
import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { config } from '@/lib/config';

jest.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: jest.fn() } }));
jest.mock('@/lib/embed-text', () => ({ embedText: jest.fn() }));

const mockQuery = prisma.$queryRaw as unknown as jest.Mock;
const mockEmbed = embedText as jest.Mock;

/** `$queryRaw` is a tagged template: call[0] is the literal chunks, the rest are bound values. */
function sql(): string {
  return (mockQuery.mock.calls[0][0] as string[]).join(' ? ');
}
function boundValues(): unknown[] {
  return mockQuery.mock.calls[0].slice(1);
}

describe('retrieval queries', () => {
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  afterAll(() => consoleLog.mockRestore());

  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbed.mockResolvedValue([0.1, 0.2]);
    mockQuery.mockResolvedValue([]);
  });

  describe('findRelevantEntries', () => {
    it('excludes retired entries', async () => {
      await findRelevantEntries('badge printing');
      expect(sql()).toMatch(/ke\.status\s*=\s*'active'/);
      expect(sql()).not.toMatch(/retired/);
    });

    it('binds the configured retrieval threshold with an inclusive comparison', async () => {
      await findRelevantEntries('badge printing');
      expect(sql()).toMatch(/>=\s*\?/);
      expect(boundValues()).toContain(config.knowledgeRetrievalThreshold);
    });

    it('honours an explicit threshold over the default', async () => {
      await findRelevantEntries('badge printing', 5, 0.9);
      expect(boundValues()).toContain(0.9);
      expect(boundValues()).not.toContain(config.knowledgeRetrievalThreshold);
    });

    it('returns the rows the query produced, similarity included', async () => {
      mockQuery.mockResolvedValue([{ id: 'e1', subject: 'Badge Printing', similarity: 0.71 }]);
      const rows = await findRelevantEntries('badge printing');
      expect(rows).toEqual([{ id: 'e1', subject: 'Badge Printing', similarity: 0.71 }]);
    });
  });

  describe('findSimilarPages', () => {
    it('excludes retired entries from librarian candidates too', async () => {
      await findSimilarPages([0.1, 0.2]);
      expect(sql()).toMatch(/status\s*=\s*'active'/);
    });
  });
});
