import type { ChildProcess } from 'child_process';
import { prisma } from '@/lib/prisma';
import { config } from '@/lib/config';
import { sessionManager } from '@/lib/session-manager';
import { attachClaudeProcess } from '@/lib/claude-process-stream';
import { provenanceCollector } from '@/lib/provenance-collector';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import { toSourceInputs } from '@/lib/knowledge-save';
import { refreshSourcesToHead, updateEntry } from '@/lib/knowledge-admin';
import { createOpenReview } from '@/lib/knowledge-review-create';
import { getKnowledgeIgnoreLists } from '@/lib/settings';

export type Tier2Outcome = 'confirmed' | 'changed' | 'retired';

export interface VerificationResultInput {
  runId: string;
  entryId: string;
  outcome: Tier2Outcome;
  content?: string;
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
 *
 * A "changed" verdict never edits the entry. The corrected text is model
 * output shaped by whatever the verifier read, and a synced repository's file
 * contents are not trusted input — a comment that looks like an instruction
 * could otherwise pick both the verdict and the replacement text, which would
 * then render as VERIFIED KNOWLEDGE in every user's system prompt with no
 * human in the loop. So "changed" queues a `proposed_update` review for an
 * admin, exactly as tier 1 does, and leaves the entry's content and sources
 * alone (refreshing sources here would mark the unchanged page fresh).
 * "confirmed" and "retired" carry no verifier-authored text and still apply
 * directly.
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
      await createOpenReview(input.entryId, 'proposed_update', {
        suggestedContent: input.content!,
        reason: 'full verification reported the page as changed',
        runId: input.runId,
      });
      return;
    }

    // Files the verifier actually read become (or refresh) sources; everything
    // else refreshes to HEAD. The snapshot is taken before the first await:
    // startTier2's timeout path can end the provenance window at any moment,
    // and a snapshot read after an await could come back empty.
    const read = provenanceCollector.snapshot(provenanceKeyForRun(input.runId));
    const headTrees = await loadActiveHeadTrees();
    for (const s of toSourceInputs(read, headTrees)) {
      await prisma.knowledgeSource.upsert({
        where: { entryId_gitlabProjectId_path: { entryId: input.entryId, gitlabProjectId: s.gitlabProjectId, path: s.path } },
        update: { blobSha: s.blobSha, commitSha: s.commitSha, verifiedAt: new Date() },
        create: { entryId: input.entryId, ...s },
      });
    }
    // Recorded decision: a "confirmed" verdict refreshes every recorded source
    // to HEAD, not only the files the verifier opened. Tier 2 judges the page
    // as a whole and is free to decide a source it did not reopen is still
    // irrelevant to the claim; a partial refresh would leave the page stale
    // immediately after a paid verification that found nothing wrong.
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
 * Wait for the session manager to hand back a process, but never forever.
 * `startSession` may queue the request when every session slot is busy, and a
 * queue that does not drain (or a caller that never resolves it) would leave
 * the VerificationRun row at "pending" with no timer running yet — the
 * runToCompletion timeout only starts once the process exists. A process that
 * arrives after we have given up is killed rather than left orphaned.
 */
function awaitProcess(started: ChildProcess | Promise<ChildProcess>, timeoutMs: number): Promise<ChildProcess> {
  return new Promise<ChildProcess>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(`timed out after ${timeoutMs}ms waiting for a session slot`));
    }, timeoutMs);

    Promise.resolve(started).then(
      (proc) => {
        clearTimeout(timer);
        if (settled) {
          try {
            proc.kill('SIGTERM');
          } catch {
            // already gone
          }
          return;
        }
        resolve(proc);
      },
      (err) => {
        clearTimeout(timer);
        if (!settled) reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/**
 * Land every VerificationRun that can no longer report back on a terminal
 * outcome.
 *
 * A run row is created before the subprocess exists and is only written again
 * when that subprocess finishes, so a deploy, crash or container restart in
 * between leaves a row at "pending" that nothing else will ever touch — and
 * `applyVerificationResult` accepts any pending run, so each stranded row
 * stays a live write target. This is run bookkeeping, not knowledge expiry:
 * no KnowledgeEntry is read or written here.
 *
 * Called when a tier 2 run starts and when the admin panel is loaded, rather
 * than from a boot hook, so the reconciliation is deterministic and testable.
 * The cutoff is the subprocess timeout plus a minute of slack, so a run that
 * is genuinely still going is never swept out from under itself.
 */
export async function reconcileStrandedRuns(): Promise<number> {
  const cutoff = new Date(Date.now() - config.verificationTimeoutMs - 60_000);
  const { count } = await prisma.verificationRun.updateMany({
    where: { outcome: 'pending', createdAt: { lt: cutoff } },
    data: { outcome: 'failed', reason: 'the run never reported back (process restart or crash)' },
  });
  if (count > 0) console.log(`[knowledge-verify] reconciled ${count} stranded verification run(s) to "failed"`);
  return count;
}

/**
 * Tier 2: a full Claude Code run on the acting admin's token, which can explore
 * the repositories rather than only re-reading the entry's own sources. The
 * outcome arrives through the resolve_verification MCP tool while the process
 * runs.
 *
 * The run never stays "pending": waiting for a session slot is bounded
 * (`awaitProcess`), the process itself is waited on with a timeout and killed
 * if it overruns, every failure between creating the run and the final write
 * is caught, and the last statement writes a terminal outcome — "unsure" when
 * the verifier simply never reported, "failed" when it crashed or timed out.
 * A row orphaned by a restart is landed by `reconcileStrandedRuns`, called
 * here and from the admin panel. That final write is conditional on the run
 * still being pending, so it records cost and duration without overwriting an
 * outcome the tool already reported. The provenance window is closed in a
 * `finally`, on every path.
 *
 * Only one tier 2 run per entry may be in flight: a paid run that the admin
 * cannot see the end of (see the route) must not be startable twice, and two
 * live runs on one entry would each be a valid write target.
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

  // Sweep first, so a row orphaned by an earlier restart cannot lock the entry
  // out of verification for good.
  await reconcileStrandedRuns();
  const inFlight = await prisma.verificationRun.findFirst({ where: { entryId, tier: 2, outcome: 'pending' } });
  if (inFlight) throw new Error('A full verification is already running for this entry');

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
      run.id,
    );
    const proc = await awaitProcess(started, config.verificationTimeoutMs);

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
