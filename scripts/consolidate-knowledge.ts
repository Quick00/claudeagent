import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';
const CONSOLIDATION_MODEL = 'anthropic/claude-sonnet-4.6';
const EMBEDDING_MODEL = 'openai/text-embedding-3-large';
const SIMILARITY_THRESHOLD = 0.75;

interface EntryWithEmbedding {
  id: string;
  category: string;
  content: string;
  tags: string;
  createdAt: Date;
  repositoryId: string | null;
  embedding: number[];
}

interface ConsolidatedPage {
  subject: string;
  category: string;
  content: string;
  tags: string;
}

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

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function clusterEntries(entries: EntryWithEmbedding[]): EntryWithEmbedding[][] {
  const assigned = new Set<number>();
  const clusters: EntryWithEmbedding[][] = [];

  for (let i = 0; i < entries.length; i++) {
    if (assigned.has(i)) continue;
    assigned.add(i);
    const cluster = [entries[i]];

    for (let j = i + 1; j < entries.length; j++) {
      if (assigned.has(j)) continue;
      const sim = cosineSimilarity(entries[i].embedding, entries[j].embedding);
      if (sim >= SIMILARITY_THRESHOLD) {
        cluster.push(entries[j]);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

async function mergeCluster(entries: EntryWithEmbedding[]): Promise<ConsolidatedPage> {
  if (entries.length === 1) {
    const e = entries[0];
    const category = e.category === 'correction' ? 'product_insight' : e.category;
    const subject = await generateSubject(e.content, category);
    return { subject, category, content: e.content, tags: e.tags };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const entryList = entries
    .map((e, i) => `${i + 1}. [${e.category}] (${e.createdAt.toISOString().slice(0, 10)}) ${e.content}\n   Tags: ${e.tags}`)
    .join('\n');

  const prompt = `You are consolidating duplicate/overlapping knowledge entries into a single page.

These ${entries.length} entries are about the same topic:

${entryList}

Merge them into ONE consolidated page. Rules:
- Write a clear, broad subject title
- Content should be comprehensive but concise (2-4 sentences for simple topics, more for complex ones)
- Newer entries take priority over older ones when they conflict
- Entries marked [correction] override the content they correct — apply the correction, don't keep it as a separate fact
- Generalize specific instances into broader principles
- For non-developer categories: strip code references, file paths, class names, or technical jargon
- For developer category: technical details are fine
- Merge tags, keeping only relevant ones
- Category must be one of: terminology, product_insight, process, developer (never "correction")

Respond with ONLY valid JSON (no markdown, no explanation):
{"subject":"...","category":"...","content":"...","tags":"..."}`;

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
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LLM error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content?.trim();
  if (!responseText) throw new Error('LLM returned empty response');

  const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  const page = JSON.parse(cleaned) as ConsolidatedPage;
  const validCategories = ['terminology', 'product_insight', 'process', 'developer'];
  if (!validCategories.includes(page.category)) {
    page.category = 'product_insight';
  }
  return page;
}

async function generateSubject(content: string, category: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: `Give this knowledge entry a short, clear subject title (3-7 words). Respond with ONLY the title, nothing else.\n\nCategory: ${category}\nContent: ${content}` }],
      temperature: 0,
      max_tokens: 50,
    }),
  });

  if (!res.ok) return content.slice(0, 60);

  const data = await res.json();
  const title = data.choices?.[0]?.message?.content?.trim();
  return title || content.slice(0, 60);
}

async function main() {
  console.log('=== Knowledge Consolidation ===\n');

  // Step 1: Load all entries with embeddings
  const rawEntries: { id: string; category: string; content: string; tags: string; createdAt: Date; repositoryId: string | null }[] =
    await prisma.knowledgeEntry.findMany({
      orderBy: { createdAt: 'asc' },
      select: { id: true, category: true, content: true, tags: true, createdAt: true, repositoryId: true },
    });

  if (rawEntries.length === 0) {
    console.log('No entries to consolidate');
    await prisma.$disconnect();
    return;
  }

  // Backup
  const backupFile = `knowledge-backup-${new Date().toISOString().slice(0, 10)}.json`;
  writeFileSync(backupFile, JSON.stringify(rawEntries, null, 2));
  console.log(`Backed up ${rawEntries.length} entries to ${backupFile}`);

  // Fetch embeddings via raw SQL (Prisma doesn't expose vector columns directly)
  const embeddingRows: { id: string; vec: string }[] = await prisma.$queryRaw`
    SELECT id, embedding::text as vec FROM "KnowledgeEntry" WHERE embedding IS NOT NULL
  `;
  const embeddingMap = new Map<string, number[]>();
  for (const row of embeddingRows) {
    const nums = row.vec.replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
    embeddingMap.set(row.id, nums);
  }

  const entries: EntryWithEmbedding[] = rawEntries
    .filter((e) => embeddingMap.has(e.id))
    .map((e) => ({ ...e, embedding: embeddingMap.get(e.id)! }));

  const skipped = rawEntries.length - entries.length;
  if (skipped > 0) console.log(`Skipping ${skipped} entries without embeddings`);

  // Step 2: Group by repository, then cluster within each group
  const byRepo = new Map<string | null, EntryWithEmbedding[]>();
  for (const entry of entries) {
    const key = entry.repositoryId;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(entry);
  }

  const allPages: (ConsolidatedPage & { repositoryId: string | null })[] = [];

  for (const [repoId, repoEntries] of byRepo) {
    console.log(`\nProcessing ${repoEntries.length} entries (repo: ${repoId || 'global'})...`);

    const clusters = clusterEntries(repoEntries);
    const multiClusters = clusters.filter((c) => c.length > 1);
    const singletons = clusters.filter((c) => c.length === 1);
    console.log(`  ${clusters.length} clusters: ${multiClusters.length} groups to merge, ${singletons.length} unique entries`);

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      try {
        const page = await mergeCluster(cluster);
        allPages.push({ ...page, repositoryId: repoId });
        const label = cluster.length > 1 ? `merged ${cluster.length} entries` : 'subject assigned';
        console.log(`  [${i + 1}/${clusters.length}] "${page.subject}" (${label})`);
      } catch (err) {
        console.error(`  [${i + 1}/${clusters.length}] Failed: ${(err as Error).message}`);
        // Fall back: keep the newest entry from the cluster as-is
        const newest = cluster[cluster.length - 1];
        allPages.push({
          subject: newest.content.slice(0, 60),
          category: newest.category,
          content: newest.content,
          tags: newest.tags,
          repositoryId: repoId,
        });
      }
    }
  }

  // Step 3: Delete old entries and insert consolidated pages
  console.log(`\nDeleting ${rawEntries.length} old entries...`);
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
      console.error(`  Failed to embed "${page.subject}": ${(err as Error).message}`);
    }

    if ((i + 1) % 10 === 0 || i === allPages.length - 1) {
      console.log(`  Inserted ${i + 1}/${allPages.length}`);
    }
  }

  console.log(`\n=== Done: ${rawEntries.length} entries → ${allPages.length} pages ===`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
