import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBEDDING_MODEL = 'openai/text-embedding-3-large';

async function embedText(text: string): Promise<number[]> {
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
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter embeddings error (${res.status}): ${body}`);
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
