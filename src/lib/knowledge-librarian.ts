import type { Freshness } from '@/lib/knowledge-freshness';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const LIBRARIAN_MODEL = 'anthropic/claude-haiku-4.5';

export interface LibrarianCandidate {
  id: string;
  subject: string;
  content: string;
  category: string;
  tags: string;
  kind: string;
  freshness: Freshness;
}

export interface LibrarianRequest {
  content: string;
  category: string;
  subject?: string;
  basedOnPaths: string[];
  candidates: LibrarianCandidate[];
}

export interface LibrarianDecisionUpdate {
  action: 'update';
  pageId: string;
  subject: string;
  content: string;
  tags: string;
}

export interface LibrarianDecisionCreate {
  action: 'create';
  subject: string;
  content: string;
  tags: string;
}

export interface LibrarianDecisionSkip {
  action: 'skip';
  reason: string;
  coveredBy: string;
}

export interface LibrarianDecisionConflict {
  action: 'conflict';
  pageId: string;
  reason: string;
}

export type LibrarianDecision =
  | LibrarianDecisionUpdate
  | LibrarianDecisionCreate
  | LibrarianDecisionSkip
  | LibrarianDecisionConflict;

function describeFreshness(f: Freshness): string {
  if (f.state === 'stale') return `STALE — these files changed since the page was written: ${f.changedPaths.join(', ')}`;
  if (f.state === 'unverified') return 'UNVERIFIED — written without reading code';
  return 'FRESH — matches the current code';
}

export async function askLibrarian(req: LibrarianRequest): Promise<LibrarianDecision> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const candidateList = req.candidates
    .map((c, i) => {
      const status = c.kind === 'pinned'
        ? 'PINNED BUSINESS RULE — immutable. You may not update it. If the new knowledge contradicts it, answer "conflict".'
        : describeFreshness(c.freshness);
      return `Page ${i + 1} (id: ${c.id}):\n  Subject: ${c.subject}\n  Category: ${c.category}\n  Tags: ${c.tags}\n  Status: ${status}\n  Content: ${c.content}`;
    })
    .join('\n\n');

  const basedOn = req.basedOnPaths.length > 0
    ? req.basedOnPaths.join(', ')
    : '(none — the new knowledge was written without reading repository files)';

  const prompt = `You are a knowledge base librarian. Your job is to keep the knowledge base clean, honest, and free of duplicates.

A new piece of knowledge has been submitted:
- Category: ${req.category}
- Suggested subject: ${req.subject || '(none)'}
- Based on files: ${basedOn}
- Content: ${req.content}

Here are existing pages that might be related:

${candidateList}

Decide ONE of the following:

1. "update" — the new knowledge belongs on an existing page. Return the page ID and rewrite the FULL page content integrating the new information. Prefer describing where a feature lives and what its key concepts are over long behavioural descriptions; keep behavioural claims short. If the new info contradicts existing content, the new info wins (it is more recent). If the page is STALE, any claim that depends on one of the changed files must be dropped or rewritten from the new information — never carry it forward unchanged. Keep the content comprehensive but concise (2-4 sentences for simple topics, more for complex ones).

2. "create" — this is a genuinely new subject not covered by any existing page. Return a clear, broad subject title and the page content. Write it as a reusable description, not a narrow one-time observation.

3. "skip" — the existing pages already fully cover this information AND none of them is STALE. Nothing new to add.

4. "conflict" — the new knowledge contradicts a PINNED page. Pinned pages are business policy set by humans and cannot be changed by you. Return the pinned page ID and a one-sentence reason. If the new knowledge merely adds detail without contradicting the pinned rule, use "skip" (if fully covered) or "create" (if it is a separate subject).

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):

For update: {"action":"update","pageId":"<id>","subject":"<improved subject>","content":"<full rewritten page content>","tags":"<comma-separated tags>"}
For create: {"action":"create","subject":"<subject title>","content":"<page content>","tags":"<comma-separated tags>"}
For skip: {"action":"skip","reason":"<brief reason>","coveredBy":"<subject of page that covers it>"}
For conflict: {"action":"conflict","pageId":"<id>","reason":"<one sentence>"}`;

  const res = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: LIBRARIAN_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Librarian LLM error (${res.status}): ${body}`);
  }

  const data = await res.json();
  const responseText = data.choices?.[0]?.message?.content?.trim();

  if (!responseText) {
    throw new Error('Librarian returned empty response');
  }

  const cleaned = responseText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  let decision: LibrarianDecision;
  try {
    decision = JSON.parse(cleaned) as LibrarianDecision;
  } catch {
    throw new Error(`Librarian returned invalid JSON: ${cleaned.slice(0, 200)}`);
  }

  if (!['update', 'create', 'skip', 'conflict'].includes(decision.action)) {
    throw new Error(`Librarian returned invalid action: ${(decision as { action: string }).action}`);
  }

  if (decision.action === 'update') {
    if (!decision.pageId || typeof decision.pageId !== 'string') {
      throw new Error(`Librarian 'update' decision missing pageId`);
    }
    if (!decision.subject || !decision.content) {
      throw new Error(`Librarian 'update' decision missing subject or content`);
    }
  } else if (decision.action === 'create') {
    if (!decision.subject || !decision.content) {
      throw new Error(`Librarian 'create' decision missing subject or content`);
    }
  } else if (decision.action === 'skip') {
    if (!decision.reason) {
      throw new Error(`Librarian 'skip' decision missing reason`);
    }
  } else if (decision.action === 'conflict') {
    if (!decision.pageId || !decision.reason) {
      throw new Error(`Librarian 'conflict' decision missing pageId or reason`);
    }
  }

  return decision;
}
