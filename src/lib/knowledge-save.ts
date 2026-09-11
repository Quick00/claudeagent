import { prisma } from '@/lib/prisma';
import { embedText, findSimilarPages, type SimilarPage } from '@/lib/embeddings';
import { askLibrarian, type LibrarianCandidate, type LibrarianDecision } from '@/lib/knowledge-librarian';
import { provenanceCollector, narrowByBasedOn, type CapturedPath } from '@/lib/provenance-collector';
import { computeFreshness } from '@/lib/knowledge-freshness';
import { loadActiveHeadTrees } from '@/lib/knowledge-repos';
import type { HeadTree } from '@/lib/repo-tree';

export const KNOWLEDGE_CATEGORIES = ['terminology', 'product_insight', 'process', 'developer'] as const;

export interface SaveKnowledgeInput {
  category: string;
  content: string;
  tags?: string;
  subject?: string;
  provenanceKey?: string;
  basedOn?: string[];
}

export interface SourceInput {
  gitlabProjectId: number;
  path: string;
  blobSha: string;
  commitSha: string;
}

export type SaveResult =
  | { status: 'saved'; action: 'create' | 'update'; id: string; subject: string; message: string; sourceCount: number }
  | { status: 'skipped'; action: 'skip'; reason: string; message: string };

interface PageData {
  subject: string;
  category: string;
  content: string;
  tags: string;
}

/** Attach the HEAD blob/commit to each captured path; paths not in HEAD are dropped. */
export function toSourceInputs(paths: CapturedPath[], headTrees: Map<number, HeadTree>): SourceInput[] {
  const out: SourceInput[] = [];
  for (const p of paths) {
    const tree = headTrees.get(p.gitlabProjectId);
    const blobSha = tree?.blobs.get(p.relativePath);
    if (!tree || !blobSha) continue;
    out.push({ gitlabProjectId: p.gitlabProjectId, path: p.relativePath, blobSha, commitSha: tree.commitSha });
  }
  return out;
}

function vector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

async function createEntry(data: PageData, embedding: number[] | null, sources: SourceInput[]): Promise<string> {
  const entry = await prisma.knowledgeEntry.create({
    data: { ...data, sources: { create: sources } },
  });
  if (embedding) {
    const vectorStr = vector(embedding);
    await prisma.$executeRaw`UPDATE "KnowledgeEntry" SET embedding = ${vectorStr}::vector WHERE id = ${entry.id}`;
  }
  return entry.id;
}

/**
 * Merge into an existing page. Only the sources observed in THIS run are
 * refreshed; the rest keep their old blob hashes, so the page becomes fresh
 * again only when every source matches HEAD. If the page was fresh before
 * this update, the entry was wrong rather than stale: count the correction.
 */
async function updateEntry(
  decision: Extract<LibrarianDecision, { action: 'update' }>,
  sources: SourceInput[],
  headTrees: Map<number, HeadTree>,
): Promise<void> {
  const existing = await prisma.knowledgeEntry.findUnique({
    where: { id: decision.pageId },
    include: { sources: true },
  });
  const wasFresh = existing ? computeFreshness(existing, existing.sources, headTrees).state === 'fresh' : false;
  const embedding = await embedText(decision.content);
  const vectorStr = vector(embedding);

  await prisma.$transaction(async (tx) => {
    await tx.knowledgeEntry.update({
      where: { id: decision.pageId },
      data: {
        subject: decision.subject,
        content: decision.content,
        tags: decision.tags,
        ...(wasFresh ? { correctionCount: { increment: 1 } } : {}),
      },
    });
    for (const s of sources) {
      await tx.knowledgeSource.upsert({
        where: {
          entryId_gitlabProjectId_path: { entryId: decision.pageId, gitlabProjectId: s.gitlabProjectId, path: s.path },
        },
        update: { blobSha: s.blobSha, commitSha: s.commitSha, verifiedAt: new Date() },
        create: { entryId: decision.pageId, ...s },
      });
    }
    await tx.$executeRaw`UPDATE "KnowledgeEntry" SET embedding = ${vectorStr}::vector WHERE id = ${decision.pageId}`;
  });
}

async function buildCandidates(pages: SimilarPage[], headTrees: Map<number, HeadTree>): Promise<LibrarianCandidate[]> {
  const sources = await prisma.knowledgeSource.findMany({ where: { entryId: { in: pages.map((p) => p.id) } } });
  return pages.map((p) => ({
    id: p.id,
    subject: p.subject,
    content: p.content,
    category: p.category,
    tags: p.tags,
    kind: p.kind,
    freshness: computeFreshness(p, sources.filter((s) => s.entryId === p.id), headTrees),
  }));
}

function created(id: string, subject: string, sourceCount: number): SaveResult {
  return { status: 'saved', action: 'create', id, subject, message: `Created new page '${subject}'.`, sourceCount };
}

/**
 * Save or merge a knowledge page.
 *
 * The provenance window is consumed only when something was actually written:
 * a `skip` persists nothing, so the reads it looked at stay available to the
 * next save in the same run rather than being silently dropped.
 */
export async function saveKnowledge(input: SaveKnowledgeInput): Promise<SaveResult> {
  const result = await runSave(input);
  if (input.provenanceKey && result.status === 'saved') provenanceCollector.markSave(input.provenanceKey);
  return result;
}

async function runSave(input: SaveKnowledgeInput): Promise<SaveResult> {
  const category = input.category;
  const content = input.content;
  const tags = input.tags || '';
  const subject = input.subject || '';

  // 1. Provenance: what this run read, narrowed by Claude's hint, hashed at HEAD.
  if (input.provenanceKey && !provenanceCollector.has(input.provenanceKey)) {
    console.warn(
      `[knowledge] save with provenanceKey ${input.provenanceKey} but no live run — saving unverified`,
    );
  }
  const headTrees = await loadActiveHeadTrees();
  const captured = input.provenanceKey ? provenanceCollector.snapshot(input.provenanceKey) : [];
  const sources = toSourceInputs(narrowByBasedOn(captured, input.basedOn), headTrees);

  // 2. Embed; without an embedding we can only append.
  let embedding: number[];
  try {
    embedding = await embedText(content);
  } catch (err) {
    console.error('[knowledge] Failed to generate embedding, saving without dedup:', (err as Error).message);
    const id = await createEntry({ subject, category, content, tags }, null, sources);
    return created(id, subject, sources.length);
  }

  const similar = await findSimilarPages(embedding, 5);
  if (similar.length === 0) {
    const id = await createEntry({ subject, category, content, tags }, embedding, sources);
    console.log(`[knowledge] New page created: "${subject}" [${category}] (${sources.length} sources)`);
    return created(id, subject, sources.length);
  }

  // 3. Librarian decides create / update / skip with freshness in view.
  let decision: LibrarianDecision;
  try {
    decision = await askLibrarian({
      content,
      category,
      subject: input.subject,
      basedOnPaths: sources.map((s) => s.path),
      candidates: await buildCandidates(similar, headTrees),
    });
  } catch (err) {
    console.error('[knowledge] Librarian failed, saving as new:', (err as Error).message);
    const id = await createEntry({ subject, category, content, tags }, embedding, sources);
    return created(id, subject, sources.length);
  }

  if (decision.action === 'update') {
    const { pageId } = decision;
    if (!similar.some((p) => p.id === pageId)) {
      console.error(`[knowledge] Librarian returned invalid pageId: ${pageId}`);
      decision = { action: 'create', subject: decision.subject, content: decision.content, tags: decision.tags };
    }
  }

  if (decision.action === 'update') {
    await updateEntry(decision, sources, headTrees);
    console.log(`[knowledge] Updated page: "${decision.subject}" (${decision.pageId}, ${sources.length} sources refreshed)`);
    return {
      status: 'saved',
      action: 'update',
      id: decision.pageId,
      subject: decision.subject,
      message: `Updated page '${decision.subject}' — integrated your finding.`,
      sourceCount: sources.length,
    };
  }

  if (decision.action === 'create') {
    const createEmbedding = await embedText(decision.content);
    const id = await createEntry(
      { subject: decision.subject, category, content: decision.content, tags: decision.tags },
      createEmbedding,
      sources,
    );
    console.log(`[knowledge] New page created: "${decision.subject}" [${category}] (${sources.length} sources)`);
    return created(id, decision.subject, sources.length);
  }

  console.log(`[knowledge] Skipped: ${decision.reason} (covered by "${decision.coveredBy}")`);
  return { status: 'skipped', action: 'skip', reason: decision.reason, message: `Already covered in '${decision.coveredBy}'.` };
}
