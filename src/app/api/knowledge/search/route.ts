import { NextResponse } from 'next/server';
import { findRelevantEntries } from '@/lib/embeddings';

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.KNOWLEDGE_API_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const body = await request.json();
  const { query, limit } = body as { query: string; limit?: number };

  if (!query?.trim()) {
    return new Response('query is required', { status: 400 });
  }

  try {
    const entries = await findRelevantEntries(query, limit || 10);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error('[knowledge/search] Error:', (err as Error).message);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
