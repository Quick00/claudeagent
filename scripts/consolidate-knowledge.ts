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
const SIMILARITY_THRESHOLD = 0.7;

interface Entry {
  id: string;
  category: string;
  content: string;
  tags: string;
  createdAt: Date;
  repositoryId: string | null;
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

async function clusterEntries(entryIds: string[]): Promise<string[][]> {
  const assigned = new Set<string>();
  const clusters: string[][] = [];

  for (const id of entryIds) {
    if (assigned.has(id)) continue;
    assigned.add(id);

    const similar: { id: string }[] = await prisma.$queryRaw`
      SELECT b.id
      FROM "KnowledgeEntry" a, "KnowledgeEntry" b
      WHERE a.id = ${id}
        AND b.id != a.id
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
        AND 1 - (a.embedding <=> b.embedding) >= ${SIMILARITY_THRESHOLD}
    `;

    const cluster = [id];
    for (const row of similar) {
      if (!assigned.has(row.id)) {
        assigned.add(row.id);
        cluster.push(row.id);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

async function mergeCluster(entries: Entry[]): Promise<ConsolidatedPage> {
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

  // Step 1: Load all entries (embeddings stay in the DB)
  const rawEntries: Entry[] = await prisma.knowledgeEntry.findMany({
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

  // Step 2: Group by repository, then cluster within each group using pgvector
  const entryMap = new Map<string, Entry>();
  for (const e of rawEntries) entryMap.set(e.id, e);

  const byRepo = new Map<string | null, string[]>();
  for (const entry of rawEntries) {
    const key = entry.repositoryId;
    if (!byRepo.has(key)) byRepo.set(key, []);
    byRepo.get(key)!.push(entry.id);
  }

  const allPages: (ConsolidatedPage & { repositoryId: string | null })[] = [];

  for (const [repoId, entryIds] of byRepo) {
    console.log(`\nProcessing ${entryIds.length} entries (repo: ${repoId || 'global'})...`);

    const clusters = await clusterEntries(entryIds);
    const multiClusters = clusters.filter((c) => c.length > 1);
    const singletons = clusters.filter((c) => c.length === 1);
    console.log(`  ${clusters.length} clusters: ${multiClusters.length} groups to merge, ${singletons.length} unique entries`);

    for (let i = 0; i < clusters.length; i++) {
      const clusterEntries = clusters[i].map((id) => entryMap.get(id)!);
      try {
        const page = await mergeCluster(clusterEntries);
        allPages.push({ ...page, repositoryId: repoId });
        const label = clusterEntries.length > 1 ? `merged ${clusterEntries.length} entries` : 'subject assigned';
        console.log(`  [${i + 1}/${clusters.length}] "${page.subject}" (${label})`);
      } catch (err) {
        console.error(`  [${i + 1}/${clusters.length}] Failed: ${(err as Error).message}`);
        const newest = clusterEntries[clusterEntries.length - 1];
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
