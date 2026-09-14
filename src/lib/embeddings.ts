import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
import { config } from '@/lib/config';
export { embedText };

export interface SimilarPage {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  kind: string;
  similarity: number;
}

export async function findSimilarPages(
  embedding: number[],
  limit: number = 5,
): Promise<SimilarPage[]> {
  const threshold = parseFloat(process.env.KNOWLEDGE_SIMILARITY_THRESHOLD || '0.7');
  const vectorStr = `[${embedding.join(',')}]`;

  const results: SimilarPage[] = await prisma.$queryRaw`
    SELECT id, subject, category, content, tags, kind,
           1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM "KnowledgeEntry"
    WHERE embedding IS NOT NULL
    AND status = 'active'
    AND 1 - (embedding <=> ${vectorStr}::vector) > ${threshold}
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  return results;
}

export interface KnowledgeEntryResult {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  kind: string;
  createdAt: Date;
  updatedAt: Date;
  similarity: number;
}

/**
 * Nearest active entries above the cosine-similarity threshold. Logs the
 * similarity of every returned row so the default threshold can be tuned
 * from real traffic.
 */
export async function findRelevantEntries(
  query: string,
  limit: number = 5,
  threshold: number = config.knowledgeRetrievalThreshold,
): Promise<KnowledgeEntryResult[]> {
  const queryEmbedding = await embedText(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const results: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT ke.id, ke.subject, ke.category, ke.content, ke.tags, ke.kind, ke."createdAt", ke."updatedAt",
           1 - (ke.embedding <=> ${vectorStr}::vector) AS similarity
    FROM "KnowledgeEntry" ke
    WHERE ke.embedding IS NOT NULL
    AND ke.status = 'active'
    AND 1 - (ke.embedding <=> ${vectorStr}::vector) >= ${threshold}
    ORDER BY ke.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  console.log(`[knowledge] retrieval: ${results.length} rows ≥ ${threshold}; similarities=${results.map((r) => r.similarity.toFixed(3)).join(',')}`);
  return results;
}
