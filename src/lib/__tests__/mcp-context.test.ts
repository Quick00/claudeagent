import { prisma } from '@/lib/prisma';
import { getLinkedServersForPrompt, formatMcpServersBlock, formatMcpServersReminder } from '@/lib/mcp-context';

jest.mock('@/lib/prisma', () => ({
  prisma: { mcpServerConnection: { findMany: jest.fn() } },
}));

const mockFindMany = prisma.mcpServerConnection.findMany as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getLinkedServersForPrompt', () => {
  it('reads the name and description of every server the user has connected', async () => {
    mockFindMany.mockResolvedValue([
      { mcpServer: { name: 'jira', description: 'Customer tickets and their status.' } },
      { mcpServer: { name: 'confluence', description: null } },
    ]);

    expect(await getLinkedServersForPrompt('u1')).toEqual([
      { name: 'jira', description: 'Customer tickets and their status.' },
      { name: 'confluence', description: null },
    ]);
  });

  // Describing a server whose tools were never configured leaves the model reaching for tools that do not exist.
  it('asks only for connections that will actually be in the session config', async () => {
    mockFindMany.mockResolvedValue([]);

    await getLinkedServersForPrompt('u1');

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', status: 'CONNECTED', mcpServer: { enabled: true } },
      }),
    );
  });

  it('returns nothing when the user has connected no servers', async () => {
    mockFindMany.mockResolvedValue([]);
    expect(await getLinkedServersForPrompt('u1')).toEqual([]);
  });
});

describe('formatMcpServersBlock', () => {
  it('adds nothing to the prompt when no server is connected', () => {
    expect(formatMcpServersBlock([])).toBe('');
  });

  it('names each connected server and what it is for', () => {
    const block = formatMcpServersBlock([
      { name: 'jira', description: 'Customer tickets and their status.' },
      { name: 'confluence', description: 'Written procedures the support team follows.' },
    ]);

    expect(block).toContain('jira');
    expect(block).toContain('Customer tickets and their status.');
    expect(block).toContain('confluence');
    expect(block).toContain('Written procedures the support team follows.');
  });

  it('still names a server the admin has not described yet', () => {
    const block = formatMcpServersBlock([{ name: 'jira', description: null }]);
    expect(block).toContain('jira');
  });

  it('tells the model to reach for a source rather than answer from the code alone', () => {
    const block = formatMcpServersBlock([{ name: 'jira', description: null }]);
    expect(block).toMatch(/reach for/i);
  });

  it('tells the model to say what it could not look up when a source fails', () => {
    const block = formatMcpServersBlock([{ name: 'jira', description: null }]);
    expect(block).toMatch(/could not|cannot/i);
  });
});

describe('formatMcpServersReminder', () => {
  it('adds nothing when no server is connected', () => {
    expect(formatMcpServersReminder([])).toBe('');
  });

  it('names the connected sources so a resumed turn does not lose them', () => {
    const reminder = formatMcpServersReminder([
      { name: 'jira', description: 'Customer tickets.' },
      { name: 'confluence', description: null },
    ]);

    expect(reminder).toContain('jira');
    expect(reminder).toContain('confluence');
  });

  it('stays short by leaving the descriptions to the system prompt', () => {
    const reminder = formatMcpServersReminder([{ name: 'jira', description: 'Customer tickets.' }]);
    expect(reminder).not.toContain('Customer tickets.');
  });
});
