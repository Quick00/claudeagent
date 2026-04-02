export { default } from 'next-auth/middleware';

export const config = {
  matcher: ['/', '/api/chat/:path*', '/api/conversations/:path*'],
};
