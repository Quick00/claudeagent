import { prisma } from '@/lib/prisma';
import { findRelevantEntries } from '@/lib/embeddings';
import { computeFreshness, type Freshness } from '@/lib/knowledge-freshness';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';

export interface LabelledEntry {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  kind: string;
  similarity: number;
  verifiedAt: Date | null;
  freshness: Freshness;
}

const STATE_RANK: Record<Freshness['state'], number> = { fresh: 0, unverified: 1, stale: 2 };

/** Two entries with the same subject (case-insensitive): keep the fresher one, then the more similar one. */
function dedupeBySubject(entries: LabelledEntry[]): LabelledEntry[] {
  const best = new Map<string, LabelledEntry>();
  for (const e of entries) {
    const key = e.subject.trim().toLowerCase() || e.id;
    const current = best.get(key);
    if (!current) { best.set(key, e); continue; }
    const better =
      STATE_RANK[e.freshness.state] < STATE_RANK[current.freshness.state] ||
      (STATE_RANK[e.freshness.state] === STATE_RANK[current.freshness.state] && e.similarity > current.similarity);
    if (better) best.set(key, e);
  }
  // preserve original (similarity) order
  return entries.filter((e) => best.get(e.subject.trim().toLowerCase() || e.id) === e);
}

/**
 * Retrieve knowledge for a question, compute each entry's freshness from
 * its sources' blob hashes, and record the retrieval on the entry.
 */
export async function retrieveKnowledge(query: string, limit: number = 10): Promise<LabelledEntry[]> {
  const results = await findRelevantEntries(query, limit);
  if (results.length === 0) return [];

  const ids = results.map((r) => r.id);
  const [headTrees, sources] = await Promise.all([
    loadActiveHeadTrees(),
    prisma.knowledgeSource.findMany({ where: { entryId: { in: ids } } }),
  ]);

  const labelled: LabelledEntry[] = results.map((r) => {
    const own = sources.filter((s) => s.entryId === r.id);
    const verifiedAt = own.reduce<Date | null>((max, s) => (!max || s.verifiedAt > max ? s.verifiedAt : max), null);
    return {
      id: r.id,
      subject: r.subject,
      category: r.category,
      content: r.content,
      tags: r.tags,
      kind: r.kind,
      similarity: r.similarity,
      verifiedAt,
      freshness: computeFreshness(r, own, headTrees),
    };
  });

  await prisma.knowledgeEntry.updateMany({
    where: { id: { in: ids } },
    data: { hitCount: { increment: 1 }, lastRetrievedAt: new Date() },
  });

  return dedupeBySubject(labelled);
}

function heading(e: LabelledEntry): string {
  return e.subject || e.category.replace('_', ' ');
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** System-prompt block for the first message of a conversation. Fresh entries keep a trusted framing on purpose. */
export function formatKnowledgeBlock(entries: LabelledEntry[]): string {
  if (entries.length === 0) return '';

  const fresh = entries.filter((e) => e.freshness.state === 'fresh');
  const stale = entries.filter((e) => e.freshness.state === 'stale');
  const unverified = entries.filter((e) => e.freshness.state === 'unverified');

  let block = '';

  if (fresh.length > 0) {
    block += '\n\n---\nVERIFIED KNOWLEDGE (matches the current code):\n';
    for (const e of fresh) {
      const label = e.kind === 'pinned'
        ? ' [pinned business rule]'
        : e.verifiedAt ? ` (verified ${isoDate(e.verifiedAt)})` : '';
      block += `\n## ${heading(e)}${label}\n${e.content}\n`;
    }
  }

  if (stale.length > 0) {
    block += '\n\n---\nPOSSIBLY OUTDATED KNOWLEDGE — the code it describes has changed since it was saved. Read the code before repeating any of it:\n';
    for (const e of stale) {
      const changed = e.freshness.state === 'stale' ? e.freshness.changedPaths.join(', ') : '';
      block += `\n## ${heading(e)} (changed since: ${changed})\n${e.content}\n`;
    }
  }

  if (unverified.length > 0) {
    block += '\n\n---\nUNVERIFIED NOTES — saved without reading code. Treat as hints, not facts:\n';
    for (const e of unverified) {
      block += `\n## ${heading(e)}\n${e.content}\n`;
    }
  }

  return block;
}

function stateLabel(e: LabelledEntry): string {
  if (e.freshness.state === 'stale') return `possibly outdated — changed: ${e.freshness.changedPaths.join(', ')}`;
  if (e.freshness.state === 'unverified') return 'unverified';
  return e.kind === 'pinned' ? 'verified, pinned business rule' : 'verified';
}

/** Compact form prepended to follow-up messages, since --resume does not re-send the system prompt. */
export function formatKnowledgeDelta(entries: LabelledEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map((e) => {
    const content = e.content.length > 300 ? e.content.slice(0, 300) + '…' : e.content;
    return `- ${heading(e)} [${stateLabel(e)}]: ${content}`;
  });
  return `[KNOWLEDGE for this question — "verified" entries match the current code; "possibly outdated" entries must be checked against the code before you repeat them; "unverified" entries are hints only.\n${lines.join('\n')}\n]`;
}
