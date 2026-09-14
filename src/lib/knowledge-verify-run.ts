import type { ChildProcess } from 'child_process';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { sessionManager } from '@/lib/session-manager';
import { attachClaudeProcess } from '@/lib/claude-process-stream';
import { provenanceCollector } from '@/lib/provenance-collector';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import { toSourceInputs } from '@/lib/knowledge-save';
import { refreshSourcesToHead, updateEntry } from '@/lib/knowledge-admin';
import { getKnowledgeIgnoreLists } from '@/lib/settings';

export type Tier2Outcome = 'confirmed' | 'changed' | 'retired';

export interface VerificationResultInput {
  runId: string;
  entryId: string;
  outcome: Tier2Outcome;
  content?: string;
  subject?: string;
  tags?: string;
}

export function provenanceKeyForRun(runId: string): string {
  return `verify-${runId}`;
}

function reasonFor(outcome: Tier2Outcome): string {
  return outcome === 'confirmed' ? 'verifier confirmed' : `verifier reported ${outcome}`;
}

/**
 * Called by the resolve_verification MCP tool (through /api/knowledge/verify-result).
 *
 * Every argument is untrusted model output, so the run is validated before
 * anything is written: it must exist, belong to the entry the tool named, and
 * still be pending. The pending check is enforced by the WRITE — a conditional
 * `updateMany` that matches only a still-pending row — not by the preceding
 * read, so two calls racing through the same `findUnique` cannot both apply.
 * Claiming the run first also means a crash midway leaves the run terminal
 * ("failed") rather than pending.
 */
export async function applyVerificationResult(input: VerificationResultInput): Promise<void> {
  const run = await prisma.verificationRun.findUnique({ where: { id: input.runId } });
  if (!run) throw new Error('Run not found');
  if (run.entryId !== input.entryId) throw new Error('Run does not match this entry');
  if (run.outcome !== 'pending') throw new Error('Run is not pending');
  if (input.outcome === 'changed' && !input.content?.trim()) throw new Error('content is required for outcome "changed"');

  // A pinned entry is human-owned; Claude may never write to one, even if the
  // entry was pinned after this run started.
  const entry = await prisma.knowledgeEntry.findUnique({ where: { id: input.entryId }, select: { kind: true } });
  if (!entry) throw new Error('Entry not found');
  if (entry.kind === 'pinned') throw new Error('Cannot apply a verification result to a pinned entry');

  const claimed = await prisma.verificationRun.updateMany({
    where: { id: input.runId, outcome: 'pending' },
    data: { outcome: input.outcome, reason: reasonFor(input.outcome) },
  });
  if (claimed.count === 0) throw new Error('Run is not pending');

  try {
    if (input.outcome === 'retired') {
      await updateEntry(input.entryId, { status: 'retired' });
      return;
    }

    if (input.outcome === 'changed') {
      await updateEntry(input.entryId, {
        content: input.content!,
        ...(input.subject ? { subject: input.subject } : {}),
        ...(input.tags ? { tags: input.tags } : {}),
      });
    }

    // Files the verifier actually read become (or refresh) sources; everything else refreshes to HEAD.
    const headTrees = await loadActiveHeadTrees();
    for (const s of toSourceInputs(provenanceCollector.snapshot(provenanceKeyForRun(input.runId)), headTrees)) {
      await prisma.knowledgeSource.upsert({
        where: { entryId_gitlabProjectId_path: { entryId: input.entryId, gitlabProjectId: s.gitlabProjectId, path: s.path } },
        update: { blobSha: s.blobSha, commitSha: s.commitSha, verifiedAt: new Date() },
        create: { entryId: input.entryId, ...s },
      });
    }
    await refreshSourcesToHead(input.entryId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[knowledge-verify] applying the verification result failed:', message);
    // The run is already claimed; correct it rather than leaving a terminal
    // outcome that claims changes which were never written.
    await prisma.verificationRun.update({ where: { id: input.runId }, data: { outcome: 'failed', reason: message } });
    throw err;
  }
}

/** Wait for the verifier process to finish, feeding its reads to the provenance collector. */
function runToCompletion(
  proc: ChildProcess,
  key: string,
  timeoutMs: number,
): Promise<{ costUsd: number | null; failure: string | null }> {
  return new Promise((resolve) => {
    let costUsd: number | null = null;
    let settled = false;

    const finish = (failure: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ costUsd, failure });
    };

    // A process that never exits would otherwise leave the run pending forever.
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM');
      } catch {
        // already gone
      }
      finish(`verification timed out after ${timeoutMs}ms`);
    }, timeoutMs);

    attachClaudeProcess(proc, {
      logPrefix: '[knowledge-verify]',
      onToolUseInput: (tool, input) => provenanceCollector.recordToolUse(key, tool, input),
      onResult: (event) => {
        if (typeof event.total_cost_usd === 'number') costUsd = event.total_cost_usd;
      },
      onClose: () => finish(null),
      onProcessError: (err) => finish(err.message),
    });
  });
}

/**
 * Tier 2: a full Claude Code run on the acting admin's token, which can explore
 * the repositories rather than only re-reading the entry's own sources. The
 * outcome arrives through the resolve_verification MCP tool while the process
 * runs.
 *
 * The run never stays "pending": the process is waited on with a timeout and
 * killed if it overruns, every failure between creating the run and the final
 * write is caught, and the last statement writes a terminal outcome — "unsure"
 * when the verifier simply never reported, "failed" when it crashed or timed
 * out. That final write is conditional on the run still being pending, so it
 * records cost and duration without overwriting an outcome the tool already
 * reported. The provenance window is closed in a `finally`, on every path.
 */
export async function startTier2(
  entryId: string,
  admin: { id: string; claudeToken: string },
): Promise<{ runId: string; outcome: string; reason: string; costUsd: number | null }> {
  const entry = await prisma.knowledgeEntry.findUnique({ where: { id: entryId }, include: { sources: true } });
  if (!entry) throw new Error('Entry not found');
  if (entry.kind === 'pinned') throw new Error('Pinned entries are not verified against code');

  const repos = await prisma.repository.findMany({ where: { active: true }, select: { gitlabProjectId: true, localPath: true } });
  if (repos.length === 0) throw new Error('No active repositories');

  const run = await prisma.verificationRun.create({ data: { entryId, tier: 2, startedById: admin.id } });
  const key = provenanceKeyForRun(run.id);
  const startedAt = Date.now();

  let costUsd: number | null = null;
  let fallbackOutcome = 'unsure';
  let fallbackReason = 'verifier finished without calling resolve_verification';

  try {
    provenanceCollector.start(key, repos, await getKnowledgeIgnoreLists());

    const message = buildVerificationMessage(run.id, entryId, entry);
    const started = sessionManager.startSession(
      `verify-${run.id}`,
      message,
      config.verificationSystemPrompt,
      admin.claudeToken,
      admin.id,
      repos.map((r) => r.localPath),
      key,
    );
    const proc = await started;

    const result = await runToCompletion(proc, key, config.verificationTimeoutMs);
    costUsd = result.costUsd;
    if (result.failure) {
      fallbackOutcome = 'failed';
      fallbackReason = result.failure;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[knowledge-verify] tier 2 run failed:', message);
    fallbackOutcome = 'failed';
    fallbackReason = message;
  } finally {
    provenanceCollector.end(key);
  }

  const durationMs = Date.now() - startedAt;
  // Conditional: claim the outcome only if resolve_verification did not already.
  const claimed = await prisma.verificationRun.updateMany({
    where: { id: run.id, outcome: 'pending' },
    data: { outcome: fallbackOutcome, reason: fallbackReason, costUsd, durationMs },
  });
  if (claimed.count > 0) {
    return { runId: run.id, outcome: fallbackOutcome, reason: fallbackReason, costUsd };
  }

  // The tool reported while the process ran; keep that outcome, add the accounting.
  const final = await prisma.verificationRun.update({ where: { id: run.id }, data: { costUsd, durationMs } });
  return { runId: run.id, outcome: final.outcome, reason: final.reason, costUsd };
}

function buildVerificationMessage(
  runId: string,
  entryId: string,
  entry: { subject: string; category: string; tags: string; content: string; sources: Array<{ gitlabProjectId: number; path: string }> },
): string {
  const sourceList = entry.sources.length > 0
    ? entry.sources.map((s) => `- project ${s.gitlabProjectId}: ${s.path}`).join('\n')
    : '- (none recorded; search the codebase for the subject)';

  return `Verification run id: ${runId}
Entry id: ${entryId}

Page to verify:
Subject: ${entry.subject}
Category: ${entry.category}
Tags: ${entry.tags}
Content: ${entry.content}

Files this page was based on:
${sourceList}

Read the code, then call resolve_verification with run_id "${runId}" and entry_id "${entryId}".`;
}
