import { NextResponse } from 'next/server';
import { applyVerificationResult, type Tier2Outcome } from '@/lib/knowledge-verify-run';

const OUTCOMES: Tier2Outcome[] = ['confirmed', 'changed', 'retired'];

/**
 * Called by the knowledge MCP server on behalf of a tier 2 verification run, so
 * it carries the shared KNOWLEDGE_API_SECRET rather than an admin session.
 * The body is Claude's tool arguments — untrusted — so every field is checked
 * here, and the run/entry pairing is checked again in applyVerificationResult.
 */
export async function POST(request: Request) {
  const secret = process.env.KNOWLEDGE_API_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, entryId, outcome } = body;
  if (typeof runId !== 'string' || !runId || typeof entryId !== 'string' || !entryId || !OUTCOMES.includes(outcome as Tier2Outcome)) {
    return NextResponse.json({ error: 'runId, entryId and a valid outcome are required' }, { status: 400 });
  }

  try {
    await applyVerificationResult({
      runId,
      entryId,
      outcome: outcome as Tier2Outcome,
      content: typeof body.content === 'string' ? body.content : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
