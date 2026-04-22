import { prisma } from '@/lib/prisma';
import { embedText } from '@/lib/embed-text';
export { embedText };

interface SimilarPage {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  similarity: number;
}

export async function findSimilarPages(
  embedding: number[],
  limit: number = 5,
): Promise<SimilarPage[]> {
  const threshold = parseFloat(process.env.KNOWLEDGE_SIMILARITY_THRESHOLD || '0.7');
  const vectorStr = `[${embedding.join(',')}]`;

  const results: SimilarPage[] = await prisma.$queryRaw`
    SELECT id, subject, category, content, tags,
           1 - (embedding <=> ${vectorStr}::vector) as similarity
    FROM "KnowledgeEntry"
    WHERE embedding IS NOT NULL
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
  source: string | null;
  createdAt: Date;
  repositoryName: string | null;
}

export async function findRelevantEntries(
  query: string,
  limit: number = 5,
): Promise<KnowledgeEntryResult[]> {
  const queryEmbedding = await embedText(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const results: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT ke.id, ke.subject, ke.category, ke.content, ke.tags, ke.source, ke."createdAt", r.name as "repositoryName"
    FROM "KnowledgeEntry" ke
    LEFT JOIN "Repository" r ON ke."repositoryId" = r.id
    WHERE ke.embedding IS NOT NULL
    ORDER BY ke.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `;

  return results;
}
