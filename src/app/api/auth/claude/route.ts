import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { authOptions } from '@/lib/auth';
import { generatePKCE, buildAuthorizeUrl } from '@/lib/claude-oauth';
import { encrypt } from '@/lib/crypto';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const { verifier, challenge } = await generatePKCE();
  const state = randomBytes(32).toString('hex');

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/claude/callback`;

  // Store verifier and state in encrypted cookie
  const cookiePayload = JSON.stringify({ verifier, state });
  const encryptedPayload = encrypt(cookiePayload);

  const cookieStore = await cookies();
  cookieStore.set('claude_oauth', encryptedPayload, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  });

  const authorizeUrl = buildAuthorizeUrl({
    codeChallenge: challenge,
    state,
    redirectUri,
  });

  return NextResponse.redirect(authorizeUrl);
}
