import fs from 'fs';
import { buildTier1Prompt, askTier1, runTier1 } from '@/lib/knowledge-verifier';
import { prisma } from '@/lib/prisma';
import { refreshSourcesToHead } from '@/lib/knowledge-admin';

jest.mock('fs', () => ({ readFileSync: jest.fn(), existsSync: jest.fn(() => true) }));
jest.mock('@/lib/knowledge-admin', () => ({ refreshSourcesToHead: jest.fn().mockResolvedValue(1) }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    knowledgeEntry: { findUnique: jest.fn() },
    repository: { findMany: jest.fn() },
    verificationRun: { create: jest.fn().mockResolvedValue({ id: 'run-1' }), update: jest.fn() },
    knowledgeReview: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  },
}));

const mockEntry = prisma.knowledgeEntry.findUnique as jest.Mock;
const mockRepos = prisma.repository.findMany as jest.Mock;
const mockRunUpdate = prisma.verificationRun.update as jest.Mock;
const mockRead = fs.readFileSync as jest.Mock;

const entry = {
  id: 'e1', subject: 'Badge Printing', category: 'product_insight', content: 'Badges print per attendee.', kind: 'derived',
  sources: [{ gitlabProjectId: 1, path: 'app/Badge.php', blobSha: 'x' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  (prisma.knowledgeReview.findFirst as jest.Mock).mockResolvedValue(null);
  (prisma.knowledgeReview.create as jest.Mock).mockResolvedValue({ id: 'rev-1' });
  process.env.OPENROUTER_API_KEY = 'k';
  mockEntry.mockResolvedValue(entry);
  mockRepos.mockResolvedValue([{ gitlabProjectId: 1, localPath: '/repos/1' }]);
  mockRead.mockReturnValue('<?php class Badge {}');
});

describe('buildTier1Prompt', () => {
  it('includes the entry and each file with its path', () => {
    const p = buildTier1Prompt(entry, [{ path: 'app/Badge.php', content: 'code' }]);
    expect(p).toContain('Badge Printing');
    expect(p).toContain('--- app/Badge.php ---');
    expect(p).toContain('still_accurate');
  });
});

describe('askTier1', () => {
  it('parses a fenced JSON verdict', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '```json\n{"verdict":"changed","reason":"now per ticket","suggestedContent":"Badges print per ticket."}\n```' } }] }),
    }) as unknown as typeof fetch;
    await expect(askTier1('p')).resolves.toEqual({ verdict: 'changed', reason: 'now per ticket', suggestedContent: 'Badges print per ticket.' });
  });
  it('rejects unknown verdicts', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"maybe","reason":""}' } }] }) }) as unknown as typeof fetch;
    await expect(askTier1('p')).rejects.toThrow('invalid verdict');
  });
});

describe('runTier1', () => {
  it('confirmed: refreshes sources and records the run', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"still_accurate","reason":"matches"}' } }] }) }) as unknown as typeof fetch;
    const out = await runTier1('e1', 'admin-1');
    expect(out).toEqual({ runId: 'run-1', outcome: 'confirmed', reason: 'matches' });
    expect(refreshSourcesToHead).toHaveBeenCalledWith('e1');
    expect(mockRunUpdate).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: expect.objectContaining({ outcome: 'confirmed', reason: 'matches', durationMs: expect.any(Number) }) });
  });

  it('changed: creates a proposed_update review and does not touch sources', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"changed","reason":"r","suggestedContent":"new"}' } }] }) }) as unknown as typeof fetch;
    const out = await runTier1('e1', 'admin-1');
    expect(out.outcome).toBe('changed');
    expect(prisma.knowledgeReview.create).toHaveBeenCalledWith({ data: { entryId: 'e1', type: 'proposed_update', payload: { suggestedContent: 'new', reason: 'r', runId: 'run-1' } } });
    expect(refreshSourcesToHead).not.toHaveBeenCalled();
  });

  it('unsure when the sources exceed the budget, without calling the model', async () => {
    mockRead.mockReturnValue('x'.repeat(200_000));
    global.fetch = jest.fn() as unknown as typeof fetch;
    const out = await runTier1('e1', 'admin-1');
    expect(out.outcome).toBe('unsure');
    expect(out.reason).toContain('budget');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('failed when the model call throws', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as unknown as typeof fetch;
    const out = await runTier1('e1', 'admin-1');
    expect(out.outcome).toBe('failed');
  });

  it('refuses a pinned entry: no model call, no review, terminal outcome', async () => {
    // Pinned entries are human-owned and always fresh. A "changed" verdict
    // here would queue Haiku's text against a rule Claude may never write to.
    mockEntry.mockResolvedValue({ ...entry, kind: 'pinned' });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const out = await runTier1('e1', 'admin-1');

    expect(out.outcome).toBe('failed');
    expect(out.reason).toContain('pinned');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(prisma.knowledgeReview.create).not.toHaveBeenCalled();
    expect(refreshSourcesToHead).not.toHaveBeenCalled();
  });

  it('reuses the open proposed_update review instead of queueing a second one', async () => {
    (prisma.knowledgeReview.findFirst as jest.Mock).mockResolvedValue({ id: 'rev-existing' });
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"verdict":"changed","reason":"r2","suggestedContent":"newer"}' } }] }) }) as unknown as typeof fetch;

    await runTier1('e1', 'admin-1');

    expect(prisma.knowledgeReview.create).not.toHaveBeenCalled();
    expect(prisma.knowledgeReview.update).toHaveBeenCalledWith({
      where: { id: 'rev-existing' },
      data: { payload: { suggestedContent: 'newer', reason: 'r2', runId: 'run-1' } },
    });
  });

  it('unsure when the entry has no sources', async () => {
    mockEntry.mockResolvedValue({ ...entry, sources: [] });
    const out = await runTier1('e1', 'admin-1');
    expect(out.outcome).toBe('unsure');
    expect(out.reason).toContain('no sources');
  });
});
