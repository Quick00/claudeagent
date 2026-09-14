import { GET, PATCH } from '@/app/api/admin/settings/route';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import { defaultIgnorePatternsText } from '@/lib/settings';

jest.mock('next-auth');
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
    appSetting: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  },
}));

const mockGetServerSession = getServerSession as jest.Mock;
const mockUserFindUnique = prisma.user.findUnique as jest.Mock;
const mockSettingFindUnique = prisma.appSetting.findUnique as jest.Mock;
const mockSettingUpsert = prisma.appSetting.upsert as jest.Mock;

function signedInAs(role: string, status = 'APPROVED') {
  mockGetServerSession.mockResolvedValue({ user: { email: 'someone@example.com' } });
  mockUserFindUnique.mockResolvedValue({ id: 'u1', email: 'someone@example.com', role, status });
}

/** Stubs appSetting.findUnique to answer per-key, like the real table would. */
function stubSettings(values: Record<string, string>) {
  mockSettingFindUnique.mockImplementation(({ where }: { where: { key: string } }) =>
    Promise.resolve(where.key in values ? { key: where.key, value: values[where.key] } : null)
  );
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/admin/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('GET /api/admin/settings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not signed in', async () => {
    mockGetServerSession.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
  });

  it('returns 403 for a non-admin', async () => {
    signedInAs('user');

    expect((await GET()).status).toBe(403);
  });

  it('reports the approval setting as off by default', async () => {
    signedInAs('admin');
    stubSettings({});

    const response = await GET();

    expect(await response.json()).toEqual({
      requireUserApproval: false,
      knowledgeIgnorePatterns: defaultIgnorePatternsText(),
    });
  });

  it('reports the approval setting when enabled', async () => {
    signedInAs('admin');
    stubSettings({ requireUserApproval: 'true' });

    expect(await (await GET()).json()).toEqual({
      requireUserApproval: true,
      knowledgeIgnorePatterns: defaultIgnorePatternsText(),
    });
  });

  it('reports saved ignore patterns', async () => {
    signedInAs('admin');
    stubSettings({ knowledgeIgnorePatterns: 'legacy/\nfoo.lock' });

    expect(await (await GET()).json()).toEqual({
      requireUserApproval: false,
      knowledgeIgnorePatterns: 'legacy/\nfoo.lock',
    });
  });
});

describe('PATCH /api/admin/settings', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 403 for a non-admin', async () => {
    signedInAs('user');

    const response = await PATCH(patchRequest({ requireUserApproval: true }));

    expect(response.status).toBe(403);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean value', async () => {
    signedInAs('admin');

    const response = await PATCH(patchRequest({ requireUserApproval: 'yes' }));

    expect(response.status).toBe(400);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
  });

  it('turns the setting on', async () => {
    signedInAs('admin');

    const response = await PATCH(patchRequest({ requireUserApproval: true }));

    expect(response.status).toBe(200);
    expect(mockSettingUpsert).toHaveBeenCalledWith({
      where: { key: 'requireUserApproval' },
      update: { value: 'true' },
      create: { key: 'requireUserApproval', value: 'true' },
    });
  });

  it('turns the setting off', async () => {
    signedInAs('admin');

    await PATCH(patchRequest({ requireUserApproval: false }));

    expect(mockSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: { value: 'false' } })
    );
  });
});
