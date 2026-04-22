import { prisma } from '@/lib/prisma';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_MODEL = 'openai/text-embedding-3-large';

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text,
      model: EMBEDDING_MODEL,
      dimensions: 1024,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter embeddings error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

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

interface KnowledgeEntryResult {
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
