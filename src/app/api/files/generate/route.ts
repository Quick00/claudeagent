import { NextResponse } from 'next/server';
import { createGeneratedFile } from '@/lib/generated-files';

/**
 * Called by the knowledge MCP server's `create_file` tool, so it carries the shared
 * KNOWLEDGE_API_SECRET rather than a user session. `provenanceKey` is the turn's
 * message id from the server's environment; the rest is Claude's tool arguments —
 * untrusted, and validated in `createGeneratedFile`.
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
    return new Response('Invalid JSON body', { status: 400 });
  }

  const { provenanceKey, ...input } = body;
  if (typeof provenanceKey !== 'string' || !provenanceKey) {
    return new Response('provenanceKey is required', { status: 400 });
  }

  const result = await createGeneratedFile(provenanceKey, input);
  if (!result.ok) return new Response(result.error, { status: result.status });
  return NextResponse.json({ id: result.file.id, filename: result.file.filename });
}
