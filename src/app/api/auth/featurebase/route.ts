import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { authOptions } from '@/lib/auth';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const secret = process.env.FEATUREBASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Featurebase not configured' }, { status: 500 });
  }

  const token = jwt.sign(
    {
      email: session.user.email,
      name: session.user.name ?? undefined,
    },
    secret,
    { algorithm: 'HS256' }
  );

  return NextResponse.json({ token });
}
