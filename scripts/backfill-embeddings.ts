import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';
const EMBEDDING_MODEL = 'voyage-3';

async function embedText(text: string): Promise<number[]> {
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

async function main() {
  const entries: { id: string; content: string }[] = await prisma.$queryRaw`
    SELECT id, content FROM "KnowledgeEntry" WHERE embedding IS NULL
  `;

  console.log(`Found ${entries.length} entries without embeddings`);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    try {
      const embedding = await embedText(entry.content);
      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE "KnowledgeEntry"
        SET embedding = ${vectorStr}::vector
        WHERE id = ${entry.id}
      `;
      console.log(`[${i + 1}/${entries.length}] Embedded: ${entry.content.slice(0, 60)}...`);
    } catch (err) {
      console.error(`[${i + 1}/${entries.length}] FAILED: ${(err as Error).message}`);
    }
  }

  console.log('Done');
  await prisma.$disconnect();
}

main();
