import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

function isMaintenanceMode() {
  return process.env.MAINTENANCE_MODE === 'true';
}

export async function proxy(request: NextRequest) {
  if (isMaintenanceMode()) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Service temporarily unavailable' },
        { status: 503, headers: { 'Retry-After': '120' } },
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = '/maintenance';
    return NextResponse.redirect(url);
  }

  const token = await getToken({ req: request });

  if (!token) {
    if (request.nextUrl.pathname.startsWith('/api/')) {
      return new NextResponse('Unauthorized', { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!maintenance|api/auth|api/maintenance-status|api/knowledge|_next/static|_next/image|favicon\\.ico|robots\\.txt|login|install).*)',
  ],
};
