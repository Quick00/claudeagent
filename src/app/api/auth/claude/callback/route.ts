import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { authOptions } from '@/lib/auth';
import { exchangeCodeForTokens } from '@/lib/claude-oauth';
import { encrypt, decrypt } from '@/lib/crypto';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(new URL(`/settings?error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL('/settings?error=missing_params', request.url));
  }

  // Retrieve and validate PKCE state from cookie
  const cookieStore = await cookies();
  const oauthCookie = cookieStore.get('claude_oauth');
  if (!oauthCookie) {
    return NextResponse.redirect(new URL('/settings?error=missing_cookie', request.url));
  }

  let verifier: string;
  let savedState: string;
  try {
    const payload = JSON.parse(decrypt(oauthCookie.value));
    verifier = payload.verifier;
    savedState = payload.state;
  } catch {
    return NextResponse.redirect(new URL('/settings?error=invalid_cookie', request.url));
  }

  if (state !== savedState) {
    return NextResponse.redirect(new URL('/settings?error=invalid_state', request.url));
  }

  // Exchange code for tokens
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/claude/callback`;

  let tokens;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      codeVerifier: verifier,
      redirectUri,
    });
  } catch {
    return NextResponse.redirect(new URL('/settings?error=token_exchange_failed', request.url));
  }

  // Store encrypted tokens on user record
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

  await prisma.user.update({
    where: { email: session.user.email },
    data: {
      claudeToken: encrypt(tokens.accessToken),
      claudeRefreshToken: encrypt(tokens.refreshToken),
      claudeTokenExpiresAt: expiresAt,
      claudeEmail: session.user.email,
    },
  });

  // Clear the OAuth cookie
  cookieStore.delete('claude_oauth');

  return NextResponse.redirect(new URL('/settings?success=linked', request.url));
}
