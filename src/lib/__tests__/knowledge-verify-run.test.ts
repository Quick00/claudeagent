import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { applyVerificationResult, provenanceKeyForRun, startTier2 } from '@/lib/knowledge-verify-run';
import { prisma } from '@/lib/prisma';
import { refreshSourcesToHead, updateEntry } from '@/lib/knowledge-admin';
import { provenanceCollector } from '@/lib/provenance-collector';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import { sessionManager } from '@/lib/session-manager';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    verificationRun: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    knowledgeEntry: { findUnique: jest.fn() },
    knowledgeSource: { upsert: jest.fn() },
    repository: { findMany: jest.fn() },
  },
}));
jest.mock('@/lib/knowledge-admin', () => ({ refreshSourcesToHead: jest.fn(), updateEntry: jest.fn() }));
jest.mock('@/lib/knowledge-repos', () => ({ loadActiveHeadTrees: jest.fn() }));
jest.mock('@/lib/session-manager', () => ({ sessionManager: { startSession: jest.fn() } }));
jest.mock('@/lib/settings', () => ({ getKnowledgeIgnoreLists: jest.fn().mockResolvedValue({ segments: [], basenames: [] }) }));
jest.mock('@/lib/config', () => ({
  config: {
    verificationSystemPrompt: 'verify',
    verificationTimeoutMs: 50,
    knowledgeMaxSourcesPerSave: 15,
    knowledgeIgnoreSegments: [],
    knowledgeIgnoreBasenames: [],
    knowledgeRetrievalThreshold: 0.45,
    knowledgeSupersedesThreshold: 0.8,
  },
}));

const mockFindRun = prisma.verificationRun.findUnique as jest.Mock;
const mockCreateRun = prisma.verificationRun.create as jest.Mock;
const mockUpdateRun = prisma.verificationRun.update as jest.Mock;
const mockUpdateManyRun = prisma.verificationRun.updateMany as jest.Mock;
const mockFindEntry = prisma.knowledgeEntry.findUnique as jest.Mock;
const mockRepos = prisma.repository.findMany as jest.Mock;
const mockUpsert = prisma.knowledgeSource.upsert as jest.Mock;
const mockTrees = loadActiveHeadTrees as jest.Mock;
const mockStart = sessionManager.startSession as jest.Mock;

function fakeChild() {
  const proc = new EventEmitter() as EventEmitter & {
    stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; pid: number; kill: jest.Mock;
  };
  proc.stdin = new PassThrough();
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.pid = 123;
  proc.kill = jest.fn();
  return proc;
}

const tick = () => new Promise((r) => setImmediate(r));

// Failure paths log by design; keep the suite output clean.
const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => consoleError.mockRestore());

beforeEach(() => {
  jest.clearAllMocks();
  mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', tier: 2, outcome: 'pending', reason: '' });
  mockFindEntry.mockResolvedValue({ id: 'e1', kind: 'derived', subject: 'S', category: 'process', content: 'C', tags: 't', sources: [] });
  mockUpdateManyRun.mockResolvedValue({ count: 1 });
  mockCreateRun.mockResolvedValue({ id: 'run-1' });
  mockRepos.mockResolvedValue([{ gitlabProjectId: 1, localPath: '/repos/1' }]);
  mockTrees.mockResolvedValue(new Map([[1, { commitSha: 'h', blobs: new Map([['a.php', 'A']]) }]]));
});

afterEach(() => {
  provenanceCollector.end(provenanceKeyForRun('run-1'));
});

describe('applyVerificationResult', () => {
  it('rejects an unknown run', async () => {
    mockFindRun.mockResolvedValue(null);
    await expect(applyVerificationResult({ runId: 'x', entryId: 'e1', outcome: 'confirmed' })).rejects.toThrow('Run not found');
    expect(mockUpdateManyRun).not.toHaveBeenCalled();
  });

  it('rejects a run belonging to a different entry', async () => {
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'other', tier: 2, outcome: 'pending' });
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'confirmed' })).rejects.toThrow('does not match');
    expect(updateEntry).not.toHaveBeenCalled();
    expect(mockUpdateManyRun).not.toHaveBeenCalled();
  });

  it('rejects a run that is already resolved', async () => {
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', tier: 2, outcome: 'confirmed' });
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'confirmed' })).rejects.toThrow('not pending');
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('rejects a second concurrent resolution at the write, not just the read', async () => {
    // Read still says pending (stale), but the conditional write matches no row.
    mockUpdateManyRun.mockResolvedValue({ count: 0 });
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'confirmed' })).rejects.toThrow('not pending');
    expect(updateEntry).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('refuses to touch a pinned entry', async () => {
    mockFindEntry.mockResolvedValue({ id: 'e1', kind: 'pinned' });
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'changed', content: 'x' })).rejects.toThrow('pinned');
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('confirmed: upserts the files the verifier read, refreshes the rest to HEAD, marks the run', async () => {
    const key = provenanceKeyForRun('run-1');
    provenanceCollector.start(key, [{ gitlabProjectId: 1, localPath: '/repos/1' }]);
    provenanceCollector.recordToolUse(key, 'Read', { file_path: '/repos/1/a.php' });

    await applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'confirmed' });

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { entryId_gitlabProjectId_path: { entryId: 'e1', gitlabProjectId: 1, path: 'a.php' } },
      update: { blobSha: 'A', commitSha: 'h', verifiedAt: expect.any(Date) },
      create: { entryId: 'e1', gitlabProjectId: 1, path: 'a.php', blobSha: 'A', commitSha: 'h' },
    });
    expect(refreshSourcesToHead).toHaveBeenCalledWith('e1');
    expect(mockUpdateManyRun).toHaveBeenCalledWith({
      where: { id: 'run-1', outcome: 'pending' },
      data: { outcome: 'confirmed', reason: 'verifier confirmed' },
    });
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('changed: updates content (and subject/tags when given) then refreshes sources', async () => {
    await applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'changed', content: 'new', subject: 'S' });
    expect(updateEntry).toHaveBeenCalledWith('e1', { content: 'new', subject: 'S' });
    expect(refreshSourcesToHead).toHaveBeenCalledWith('e1');
  });

  it('changed without content is rejected before anything is written', async () => {
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'changed' })).rejects.toThrow('content is required');
    expect(mockUpdateManyRun).not.toHaveBeenCalled();
    expect(updateEntry).not.toHaveBeenCalled();
  });

  it('retired: sets status retired and does not refresh sources', async () => {
    await applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'retired' });
    expect(updateEntry).toHaveBeenCalledWith('e1', { status: 'retired' });
    expect(refreshSourcesToHead).not.toHaveBeenCalled();
  });

  it('marks the claimed run failed when applying the change throws', async () => {
    (updateEntry as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    await expect(applyVerificationResult({ runId: 'run-1', entryId: 'e1', outcome: 'retired' })).rejects.toThrow('db down');
    expect(mockUpdateRun).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { outcome: 'failed', reason: 'db down' },
    });
  });
});

describe('startTier2', () => {
  it('refuses a pinned entry and creates no run', async () => {
    mockFindEntry.mockResolvedValue({ id: 'e1', kind: 'pinned', sources: [] });
    await expect(startTier2('e1', { id: 'a1', claudeToken: 't' })).rejects.toThrow('Pinned');
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('refuses an unknown entry and creates no run', async () => {
    mockFindEntry.mockResolvedValue(null);
    await expect(startTier2('nope', { id: 'a1', claudeToken: 't' })).rejects.toThrow('Entry not found');
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('feeds the verifier reads to the provenance collector and records cost on a resolved run', async () => {
    const proc = fakeChild();
    mockStart.mockReturnValue(proc);
    // resolve_verification lands while the process runs, so the final claim matches no pending row.
    mockUpdateManyRun.mockResolvedValue({ count: 0 });
    mockUpdateRun.mockResolvedValue({ id: 'run-1', outcome: 'confirmed', reason: 'verifier confirmed' });

    const promise = startTier2('e1', { id: 'a1', claudeToken: 'tok' });
    await tick();

    const key = provenanceKeyForRun('run-1');
    proc.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repos/1/a.php' } }] } }) + '\n');
    await tick();
    expect(provenanceCollector.snapshot(key)).toEqual([{ gitlabProjectId: 1, relativePath: 'a.php' }]);

    proc.stdout.write(JSON.stringify({ type: 'result', total_cost_usd: 0.42 }) + '\n');
    await tick();
    proc.emit('close', 0);

    const result = await promise;
    expect(result).toEqual({ runId: 'run-1', outcome: 'confirmed', reason: 'verifier confirmed', costUsd: 0.42 });
    expect(provenanceCollector.has(key)).toBe(false);

    // Records cost/duration without stealing the outcome the tool already wrote.
    expect(mockUpdateManyRun.mock.calls[0][0].where).toEqual({ id: 'run-1', outcome: 'pending' });
    expect(mockUpdateRun).toHaveBeenCalledWith({ where: { id: 'run-1' }, data: { costUsd: 0.42, durationMs: expect.any(Number) } });

    const prompt = mockStart.mock.calls[0];
    expect(prompt[2]).toBe('verify');
    expect(prompt[1]).toContain('run-1');
    expect(prompt[6]).toBe(key);
  });

  it('lands on "unsure" when the verifier never calls resolve_verification', async () => {
    const proc = fakeChild();
    mockStart.mockReturnValue(proc);
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', outcome: 'pending', reason: '' });

    const promise = startTier2('e1', { id: 'a1', claudeToken: 'tok' });
    await tick();
    proc.emit('close', 0);

    const result = await promise;
    expect(result.outcome).toBe('unsure');
    expect(mockUpdateManyRun).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', outcome: 'pending' },
      data: expect.objectContaining({ outcome: 'unsure' }),
    }));
    expect(provenanceCollector.has(provenanceKeyForRun('run-1'))).toBe(false);
  });

  it('lands on "failed" when the process errors instead of closing', async () => {
    const proc = fakeChild();
    mockStart.mockReturnValue(proc);
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', outcome: 'pending', reason: '' });

    const promise = startTier2('e1', { id: 'a1', claudeToken: 'tok' });
    await tick();
    proc.emit('error', new Error('spawn ENOENT'));

    const result = await promise;
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('spawn ENOENT');
    expect(provenanceCollector.has(provenanceKeyForRun('run-1'))).toBe(false);
  });

  it('lands on "failed" and ends provenance when the spawn itself throws', async () => {
    mockStart.mockImplementation(() => { throw new Error('no slot'); });
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', outcome: 'pending', reason: '' });

    const result = await startTier2('e1', { id: 'a1', claudeToken: 'tok' });
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('no slot');
    expect(mockUpdateManyRun).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ outcome: 'failed' }),
    }));
    expect(provenanceCollector.has(provenanceKeyForRun('run-1'))).toBe(false);
  });

  it('kills a process that never exits and lands on "failed"', async () => {
    const proc = fakeChild();
    mockStart.mockReturnValue(proc);
    mockFindRun.mockResolvedValue({ id: 'run-1', entryId: 'e1', outcome: 'pending', reason: '' });

    const result = await startTier2('e1', { id: 'a1', claudeToken: 'tok' });
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.outcome).toBe('failed');
    expect(result.reason).toContain('timed out');
    expect(provenanceCollector.has(provenanceKeyForRun('run-1'))).toBe(false);
  });
});
