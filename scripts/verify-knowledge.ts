import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { spawn } from 'child_process';
import { createDecipheriv } from 'crypto';
import { mkdirSync } from 'fs';
import path from 'path';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

function decrypt(ciphertext: string): string {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be a 64-character hex string');
  }
  const key = Buffer.from(hex, 'hex');
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(buf.length - 16);
  const encrypted = buf.subarray(12, buf.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

function parseArgs(): { userId: string; batchSize: number } {
  const args = process.argv.slice(2);
  let userId = '';
  let batchSize = 10;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user-id' && args[i + 1]) {
      userId = args[i + 1];
      i++;
    } else if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }

  if (!userId) {
    console.error('Usage: npx tsx scripts/verify-knowledge.ts --user-id <id> [--batch-size <n>]');
    process.exit(1);
  }

  return { userId, batchSize };
}

function runClaudeVerification(
  message: string,
  repoPath: string,
  claudeToken: string,
  userId: string,
  repositoryId: string | undefined,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const projectRoot = path.resolve(process.cwd());
    const sessionsDir = process.env.SESSIONS_DIR || path.join('/tmp', 'claude-sessions');
    const userHome = path.join(sessionsDir, userId);
    mkdirSync(userHome, { recursive: true });

    const mcpConfig = JSON.stringify({
      mcpServers: {
        knowledge: {
          command: 'node',
          args: [path.join(projectRoot, 'src/mcp/knowledge-server.mjs')],
          env: {
            KNOWLEDGE_API_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge`,
            KNOWLEDGE_SEARCH_URL: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/knowledge/search`,
            KNOWLEDGE_API_SECRET: process.env.KNOWLEDGE_API_SECRET || '',
            REPOSITORY_ID: repositoryId || '',
          },
        },
      },
    });

    const systemPrompt = `You are verifying a knowledge base entry against the current codebase. Check if the information is still accurate. If it's outdated or wrong, call save_knowledge with the corrected version. If it's still accurate, respond with exactly "VERIFIED".`;

    const proc = spawn('claude', [
      '--print',
      '--output-format', 'stream-json',
      '--max-turns', '10',
      '--add-dir', repoPath,
      '--system-prompt', systemPrompt,
      '--mcp-config', mcpConfig,
      '--permission-mode', 'bypassPermissions',
    ], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: userHome,
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
      },
    });

    let output = '';
    proc.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.error(`  [claude stderr] ${text}`);
    });

    proc.stdin!.write(message);
    proc.stdin!.end();

    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`Claude process exited with code ${code}`));
      } else {
        resolve(output);
      }
    });

    proc.on('error', reject);
  });
}

async function main() {
  const { userId, batchSize } = parseArgs();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, claudeToken: true },
  });

  if (!user) {
    console.error(`User not found: ${userId}`);
    process.exit(1);
  }

  if (!user.claudeToken) {
    console.error(`User ${user.email} has no linked Claude account`);
    process.exit(1);
  }

  const claudeToken = decrypt(user.claudeToken);
  console.log(`=== Knowledge Verification ===`);
  console.log(`User: ${user.email}`);
  console.log(`Batch size: ${batchSize}\n`);

  const pages = await prisma.knowledgeEntry.findMany({
    orderBy: { updatedAt: 'asc' },
    take: batchSize,
    include: { repository: { select: { localPath: true, name: true } } },
  });

  if (pages.length === 0) {
    console.log('No pages to verify');
    await prisma.$disconnect();
    return;
  }

  console.log(`Verifying ${pages.length} pages...\n`);

  let verified = 0;
  let updated = 0;
  let failed = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const repoPath = page.repository?.localPath || process.env.REPO_PATH || '';
    const repoName = page.repository?.name || 'default';

    if (!repoPath) {
      console.log(`  [${i + 1}/${pages.length}] SKIP "${page.subject}" — no repo path`);
      failed++;
      continue;
    }

    console.log(`  [${i + 1}/${pages.length}] Verifying "${page.subject}" (${repoName})...`);

    const message = `Verify this knowledge page against the current codebase:

Subject: ${page.subject}
Category: ${page.category}
Content: ${page.content}
Tags: ${page.tags}

Check the codebase to confirm this is still accurate. If it's outdated or wrong, call save_knowledge with the corrected version (use subject "${page.subject}"). If it's still accurate, respond with "VERIFIED".`;

    try {
      const resultText = await runClaudeVerification(message, repoPath, claudeToken, userId, page.repositoryId || undefined);

      if (resultText.includes('"VERIFIED"') || resultText.includes('VERIFIED')) {
        console.log(`    ✓ Verified`);
        verified++;
      } else if (resultText.includes('save_knowledge')) {
        console.log(`    ↻ Updated via save_knowledge`);
        updated++;
      } else {
        console.log(`    ? Unclear result`);
      }

      await prisma.knowledgeEntry.update({
        where: { id: page.id },
        data: { updatedAt: new Date() },
      });
    } catch (err) {
      console.error(`    ✗ Failed: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n=== Results: ${verified} verified, ${updated} updated, ${failed} failed ===`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
