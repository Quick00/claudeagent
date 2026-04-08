import { prisma } from '@/lib/prisma';

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3';

export async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    throw new Error('VOYAGE_API_KEY is not set');
  }

  const res = await fetch(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: EMBEDDING_MODEL,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Voyage API error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

interface KnowledgeEntryResult {
  id: string;
  category: string;
  content: string;
  tags: string;
  source: string | null;
  createdAt: Date;
}

export async function findRelevantEntries(
  query: string,
  limit: number = 10,
): Promise<KnowledgeEntryResult[]> {
  // Always include all corrections
  const corrections: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT id, category, content, tags, source, "createdAt"
    FROM "KnowledgeEntry"
    WHERE category = 'correction'
  `;

  const remainingSlots = limit - corrections.length;
  if (remainingSlots <= 0) {
    return corrections.slice(0, limit);
  }

  const queryEmbedding = await embedText(query);
  const vectorStr = `[${queryEmbedding.join(',')}]`;

  const semanticResults: KnowledgeEntryResult[] = await prisma.$queryRaw`
    SELECT id, category, content, tags, source, "createdAt"
    FROM "KnowledgeEntry"
    WHERE embedding IS NOT NULL
    AND category != 'correction'
    ORDER BY embedding <=> ${vectorStr}::vector
    LIMIT ${remainingSlots}
  `;

  return [...corrections, ...semanticResults];
}
