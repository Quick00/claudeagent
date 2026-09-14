import { getRequireUserApproval, setRequireUserApproval } from '@/lib/settings';
import { parseIgnorePatterns, defaultIgnorePatternsText, getKnowledgeIgnoreLists, setKnowledgeIgnorePatternsText } from '@/lib/settings';
import { prisma } from '@/lib/prisma';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    appSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockFindUnique = prisma.appSetting.findUnique as jest.Mock;
const mockUpsert = prisma.appSetting.upsert as jest.Mock;

describe('getRequireUserApproval', () => {
  beforeEach(() => jest.clearAllMocks());

  it('defaults to false when the setting has never been saved', async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(getRequireUserApproval()).resolves.toBe(false);
  });

  it('returns true when the stored value is "true"', async () => {
    mockFindUnique.mockResolvedValue({ key: 'requireUserApproval', value: 'true' });

    await expect(getRequireUserApproval()).resolves.toBe(true);
  });

  it('returns false when the stored value is "false"', async () => {
    mockFindUnique.mockResolvedValue({ key: 'requireUserApproval', value: 'false' });

    await expect(getRequireUserApproval()).resolves.toBe(false);
  });
});

describe('setRequireUserApproval', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the row on first write', async () => {
    await setRequireUserApproval(true);

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: 'requireUserApproval' },
      update: { value: 'true' },
      create: { key: 'requireUserApproval', value: 'true' },
    });
  });

  it('stores "false" when disabled', async () => {
    await setRequireUserApproval(false);

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 'false' } })
    );
  });
});

describe('ignore patterns', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses directories (trailing slash) and basenames, skipping blanks and comments', () => {
    expect(parseIgnorePatterns('translations/\n# comment\n\nvendor/\ncomposer.lock\n')).toEqual({
      segments: ['translations', 'vendor'],
      basenames: ['composer.lock'],
    });
  });

  it('lower-cases segments and trims whitespace', () => {
    expect(parseIgnorePatterns('  Translations/  \n yarn.lock ')).toEqual({ segments: ['translations'], basenames: ['yarn.lock'] });
  });

  it('falls back to the config defaults when unset', async () => {
    mockFindUnique.mockResolvedValue(null);
    const lists = await getKnowledgeIgnoreLists();
    expect(lists).toEqual(parseIgnorePatterns(defaultIgnorePatternsText()));
    expect(lists.segments).toContain('translations');
  });

  it('falls back to the config defaults when the stored value is blank or whitespace-only', async () => {
    mockFindUnique.mockResolvedValue({ key: 'knowledgeIgnorePatterns', value: '   \n  ' });
    const lists = await getKnowledgeIgnoreLists();
    expect(lists).toEqual(parseIgnorePatterns(defaultIgnorePatternsText()));
  });

  it('stores the raw text', async () => {
    await setKnowledgeIgnorePatternsText('foo/\nbar.lock');
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { key: 'knowledgeIgnorePatterns' },
      update: { value: 'foo/\nbar.lock' },
      create: { key: 'knowledgeIgnorePatterns', value: 'foo/\nbar.lock' },
    });
  });
});
