import { getRequireUserApproval, setRequireUserApproval } from '@/lib/settings';
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
