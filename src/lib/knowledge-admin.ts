import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import { KNOWLEDGE_CATEGORIES } from '@/lib/knowledge-save';

export interface EntryPatch {
  subject?: string;
  content?: string;
  tags?: string;
  category?: string;
  kind?: 'derived' | 'pinned';
  status?: 'active' | 'retired';
}

/** The embedding vector for `content`, as the literal pgvector takes. */
async function embedVector(content: string): Promise<string> {
  const embedding = await embedText(content);
  return `[${embedding.join(',')}]`;
}

async function writeEmbedding(id: string, vectorStr: string): Promise<void> {
  await prisma.$executeRaw`UPDATE "KnowledgeEntry" SET embedding = ${vectorStr}::vector WHERE id = ${id}`;
}

/**
 * Admin edit of an entry's fields. Unlike Claude's save path, an admin may
 * write to a pinned entry — the pinned guard lives in knowledge-save.ts, not
 * here. Re-embeds only when content actually changes, since embedding is
 * driven by content alone.
 *
 * The embedding is computed *before* the content is written. `embedText` is a
 * network call to OpenRouter: computing it afterwards means an outage leaves
 * committed content described by the previous text's vector — retrieval then
 * matches the old subject and returns the new words, with nothing to detect
 * it — and makes both callers that compensate on failure (applyVerificationResult
 * marking the run "failed", resolveReview reopening the review) report the
 * opposite of what happened. Failing before the update keeps them honest.
 */
export async function updateEntry(id: string, patch: EntryPatch): Promise<void> {
  if (patch.category !== undefined && !KNOWLEDGE_CATEGORIES.includes(patch.category as (typeof KNOWLEDGE_CATEGORIES)[number])) {
    throw new Error('Invalid category');
  }
  if (patch.kind !== undefined && patch.kind !== 'derived' && patch.kind !== 'pinned') {
    throw new Error('Invalid kind');
  }
  if (patch.status !== undefined && patch.status !== 'active' && patch.status !== 'retired') {
    throw new Error('Invalid status');
  }

  const data: Record<string, string> = {};
  for (const key of ['subject', 'content', 'tags', 'category', 'kind', 'status'] as const) {
    const value = patch[key];
    if (typeof value === 'string') data[key] = value;
  }
  if (Object.keys(data).length === 0) return;

  const vectorStr = typeof patch.content === 'string' ? await embedVector(patch.content) : null;
  await prisma.knowledgeEntry.update({ where: { id }, data });
  if (vectorStr) {
    await writeEmbedding(id, vectorStr);
  }
}

/** Admin-authored pinned entry: a human-owned rule, created with no sources. */
export async function createPinnedEntry(input: { subject: string; content: string; category: string; tags: string }): Promise<string> {
  if (!KNOWLEDGE_CATEGORIES.includes(input.category as (typeof KNOWLEDGE_CATEGORIES)[number])) {
    throw new Error('Invalid category');
  }
  // Embed first, for the same reason as updateEntry: an embedding failure
  // should leave nothing behind rather than an unretrievable entry.
  const vectorStr = await embedVector(input.content);
  const entry = await prisma.knowledgeEntry.create({ data: { ...input, kind: 'pinned' } });
  await writeEmbedding(entry.id, vectorStr);
  return entry.id;
}

/**
 * A human assertion that the entry is still correct: re-point every source at
 * the current HEAD blob/commit without touching the entry's content. Updates
 * existing KnowledgeSource rows via their id (found through the
 * entryId_gitlabProjectId_path compound unique) rather than creating
 * duplicates. A source whose file no longer exists at HEAD is removed rather
 * than left pointing at a hash that can never match again.
 */
export async function refreshSourcesToHead(entryId: string): Promise<number> {
  const [headTrees, sources] = await Promise.all([
    loadActiveHeadTrees(),
    prisma.knowledgeSource.findMany({ where: { entryId } }),
  ]);

  const gone: string[] = [];
  const updates: Array<Promise<unknown>> = [];
  const verifiedAt = new Date();
  for (const s of sources) {
    const tree = headTrees.get(s.gitlabProjectId);
    const blobSha = tree?.blobs.get(s.path);
    if (!tree || !blobSha) {
      gone.push(s.id);
      continue;
    }
    updates.push(prisma.knowledgeSource.update({
      where: { id: s.id },
      data: { blobSha, commitSha: tree.commitSha, verifiedAt },
    }));
  }
  // Bounded by knowledgeMaxSourcesPerSave (15) and issued together rather than
  // as a sequential await chain; this runs on every accept and every confirm.
  await Promise.all(updates);
  const refreshed = updates.length;
  if (gone.length > 0) {
    await prisma.knowledgeSource.deleteMany({ where: { id: { in: gone } } });
  }
  return refreshed;
}
