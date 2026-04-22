import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';
const CONSOLIDATION_MODEL = 'anthropic/claude-sonnet-4.6';
const EMBEDDING_MODEL = 'openai/text-embedding-3-large';

async function embedText(text: string): Promise<number[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const res = await fetch(OPENROUTER_EMBED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text, model: EMBEDDING_MODEL, dimensions: 1024 }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Embedding error (${res.status}): ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

interface ConsolidatedPage {
  subject: string;
  category: string;
  content: string;
  tags: string;
}

async function consolidateBatch(
  entries: { id: string; category: string; content: string; tags: string; createdAt: Date }[],
  repoName: string | null,
): Promise<ConsolidatedPage[]> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const entryList = entries
    .map((e, i) => `${i + 1}. [${e.category}] (${e.createdAt.toISOString().slice(0, 10)}) ${e.content}\n   Tags: ${e.tags}`)
    .join('\n');

  const prompt = `You are consolidating a knowledge base. Below are individual knowledge entries${repoName ? ` from the "${repoName}" repository` : ''}. Many are duplicates, contradictions, or overly specific instances of the same concept.

Group them by subject and consolidate each group into a single page.

Rules:
- Each page should have a clear, broad subject title
- Content should be comprehensive but concise (2-4 sentences for simple topics, more for complex ones)
- Newer entries take priority over older ones when they conflict
- Generalize specific instances into broader principles
- For non-developer categories: strip any code references, file paths, class names, or technical jargon
- For developer category: technical details are fine
- Merge tags from related entries, keeping only relevant ones
- Category should match the dominant category of the merged entries

Entries:
${entryList}

Respond with ONLY a JSON array of consolidated pages (no markdown, no explanation):
[{"subject":"...","category":"...","content":"...","tags":"..."},...]`;

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CONSOLIDATION_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Consolidation LLM error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content?.trim();
  if (!responseText) throw new Error('LLM returned empty response');

  return JSON.parse(responseText) as ConsolidatedPage[];
}

async function main() {
  console.log('=== Knowledge Consolidation ===\n');

  // Step 1: Backup
  const allEntries = await prisma.knowledgeEntry.findMany({
    orderBy: { createdAt: 'asc' },
    include: { repository: { select: { name: true } } },
  });

  const backupFile = `knowledge-backup-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backupFile, JSON.stringify(allEntries, null, 2));
  console.log(`Backed up ${allEntries.length} entries to ${backupFile}`);

  if (allEntries.length === 0) {
    console.log('No entries to consolidate');
    await prisma.$disconnect();
    return;
  }

  // Step 2: Group by repository
  const byRepo = new Map<string | null, typeof allEntries>();
  for (const entry of allEntries) {
    const key = entry.repositoryId;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(entry);
  }

  // Step 3: Consolidate each group
  const allPages: (ConsolidatedPage & { repositoryId: string | null })[] = [];

  for (const [repoId, entries] of byRepo) {
    const repoName = entries[0]?.repository?.name || null;
    console.log(`\nConsolidating ${entries.length} entries${repoName ? ` from "${repoName}"` : ' (global)'}...`);

    const pages = await consolidateBatch(entries, repoName);
    for (const page of pages) {
      allPages.push({ ...page, repositoryId: repoId });
    }
    console.log(`  → ${pages.length} pages`);
  }

  // Step 4: Delete old entries and insert consolidated pages
  console.log(`\nDeleting ${allEntries.length} old entries...`);
  await prisma.knowledgeEntry.deleteMany({});

  console.log(`Inserting ${allPages.length} consolidated pages...`);
  for (let i = 0; i < allPages.length; i++) {
    const page = allPages[i];

    const entry = await prisma.knowledgeEntry.create({
      data: {
        subject: page.subject,
        category: page.category,
        content: page.content,
        tags: page.tags,
        repositoryId: page.repositoryId,
      },
    });

    try {
      const embedding = await embedText(page.content);
      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRaw`
        UPDATE "KnowledgeEntry"
        SET embedding = ${vectorStr}::vector
        WHERE id = ${entry.id}
      `;
    } catch (err) {
      console.error(`  [${i + 1}/${allPages.length}] Failed to embed "${page.subject}": ${(err as Error).message}`);
    }

    console.log(`  [${i + 1}/${allPages.length}] ${page.subject} [${page.category}]`);
  }

  console.log(`\n=== Done: ${allEntries.length} entries consolidated into ${allPages.length} pages ===`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
