import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  if (process.env.MAINTENANCE_MODE !== 'true') {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = '/maintenance';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/((?!maintenance|api/auth|_next/static|_next/image|favicon\\.ico|robots\\.txt).*)',
  ],
};
