import { NextResponse } from 'next/server';
import { requireApprovedUser } from '@/lib/api-auth';

export async function GET() {
  const auth = await requireApprovedUser();
  if (!auth.ok) return auth.response;
  const user = auth.user;

  return NextResponse.json({
    linked: !!user.claudeToken,
    email: user.claudeEmail ?? null,
  });
}
