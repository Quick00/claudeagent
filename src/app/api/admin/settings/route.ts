import { requireAdminUser } from '@/lib/api-auth';
import {
  getRequireUserApproval, setRequireUserApproval,
  getKnowledgeIgnorePatternsText, setKnowledgeIgnorePatternsText,
} from '@/lib/settings';
import { NextResponse } from 'next/server';

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    requireUserApproval: await getRequireUserApproval(),
    knowledgeIgnorePatterns: await getKnowledgeIgnorePatternsText(),
  });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as { requireUserApproval?: unknown; knowledgeIgnorePatterns?: unknown };

  if (body.requireUserApproval === undefined && body.knowledgeIgnorePatterns === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }
  if (body.requireUserApproval !== undefined && typeof body.requireUserApproval !== 'boolean') {
    return NextResponse.json({ error: 'requireUserApproval must be a boolean' }, { status: 400 });
  }
  if (body.knowledgeIgnorePatterns !== undefined && (typeof body.knowledgeIgnorePatterns !== 'string' || body.knowledgeIgnorePatterns.length > 5000)) {
    return NextResponse.json({ error: 'knowledgeIgnorePatterns must be a string under 5000 chars' }, { status: 400 });
  }

  if (typeof body.requireUserApproval === 'boolean') await setRequireUserApproval(body.requireUserApproval);
  if (typeof body.knowledgeIgnorePatterns === 'string') await setKnowledgeIgnorePatternsText(body.knowledgeIgnorePatterns);

  return NextResponse.json({
    requireUserApproval: await getRequireUserApproval(),
    knowledgeIgnorePatterns: await getKnowledgeIgnorePatternsText(),
  });
}
