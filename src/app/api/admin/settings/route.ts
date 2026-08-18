import { requireAdminUser } from '@/lib/api-auth';
import { getRequireUserApproval, setRequireUserApproval } from '@/lib/settings';
import { NextResponse } from 'next/server';

export async function GET() {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  return NextResponse.json({ requireUserApproval: await getRequireUserApproval() });
}

export async function PATCH(request: Request) {
  const auth = await requireAdminUser();
  if (!auth.ok) return auth.response;

  const { requireUserApproval } = (await request.json()) as { requireUserApproval?: unknown };

  if (typeof requireUserApproval !== 'boolean') {
    return NextResponse.json({ error: 'requireUserApproval must be a boolean' }, { status: 400 });
  }

  await setRequireUserApproval(requireUserApproval);

  return NextResponse.json({ requireUserApproval });
}
