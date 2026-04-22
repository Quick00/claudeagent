import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeFileSync } from 'fs';
import { embedText } from '../src/lib/embed-text';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const CONSOLIDATION_MODEL = 'anthropic/claude-sonnet-4.6';
const SIMILARITY_THRESHOLD = 0.7;
const CONCURRENCY = 5;

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
        AND b.id = ANY(${entryIds})
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
  const parsed = JSON.parse(cleaned);
  if (
    typeof parsed !== 'object' || parsed === null ||
    typeof parsed.subject !== 'string' ||
    typeof parsed.category !== 'string' ||
    typeof parsed.content !== 'string' ||
    typeof parsed.tags !== 'string'
  ) {
    throw new Error(`LLM returned invalid ConsolidatedPage shape: ${cleaned.slice(0, 200)}`);
  }
  const page = parsed as ConsolidatedPage;
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

  let totalPages = 0;

  for (const [repoId, entryIds] of byRepo) {
    console.log(`\nProcessing ${entryIds.length} entries (repo: ${repoId || 'global'})...`);

    const clusters = await clusterEntries(entryIds);
    const multiClusters = clusters.filter((c) => c.length > 1);
    const singletons = clusters.filter((c) => c.length === 1);
    console.log(`  ${clusters.length} clusters: ${multiClusters.length} groups to merge, ${singletons.length} unique entries`);

    let completed = 0;
    const processCluster = async (i: number) => {
      const clusterIds = clusters[i];
      const clusterData = clusterIds.map((id) => entryMap.get(id)!);
      let page: ConsolidatedPage;
      try {
        page = await mergeCluster(clusterData);
      } catch (err) {
        console.error(`  [${++completed}/${clusters.length}] Failed: ${(err as Error).message}`);
        const newest = clusterData[clusterData.length - 1];
        page = {
          subject: newest.content.slice(0, 60),
          category: newest.category,
          content: newest.content,
          tags: newest.tags,
        };
      }

      let embedding: number[] | null = null;
      try {
        embedding = await embedText(page.content);
      } catch (err) {
        console.error(`  Failed to embed "${page.subject}": ${(err as Error).message}`);
      }

      await prisma.$transaction(async (tx) => {
        await tx.knowledgeEntry.deleteMany({ where: { id: { in: clusterIds } } });
        const entry = await tx.knowledgeEntry.create({
          data: {
            subject: page.subject,
            category: page.category,
            content: page.content,
            tags: page.tags,
            repositoryId: repoId,
          },
        });
        if (embedding) {
          const vectorStr = `[${embedding.join(',')}]`;
          await tx.$executeRaw`
            UPDATE "KnowledgeEntry"
            SET embedding = ${vectorStr}::vector
            WHERE id = ${entry.id}
          `;
        }
      });

      totalPages++;
      completed++;
      const label = clusterData.length > 1 ? `merged ${clusterData.length} entries` : 'subject assigned';
      console.log(`  [${completed}/${clusters.length}] "${page.subject}" (${label})`);
    };

    // Process clusters in pools of CONCURRENCY
    for (let start = 0; start < clusters.length; start += CONCURRENCY) {
      const batch = clusters.slice(start, start + CONCURRENCY).map((_, j) => processCluster(start + j));
      await Promise.all(batch);
    }
  }

  console.log(`\n=== Done: ${rawEntries.length} entries → ${totalPages} pages ===`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
