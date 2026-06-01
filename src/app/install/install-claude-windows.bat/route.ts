import { NextRequest, NextResponse } from 'next/server';
import os from 'node:os';

function getLanOrigin(port: string): string | null {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const addr of list) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `http://${addr.address}:${port}`;
      }
    }
  }
  return null;
}

export function GET(request: NextRequest) {
  let origin: string;

  // The URL baked into the .bat must be reachable from the Windows machine
  // running the installer. APP_PUBLIC_URL is the source of truth: in production
  // request.nextUrl.origin reflects the bind address (e.g. 0.0.0.0:3000) rather
  // than the public host, so we always prefer the explicit override when set.
  const override = process.env.APP_PUBLIC_URL;
  if (override) {
    origin = override.replace(/\/$/, '');
  } else {
    origin = request.nextUrl.origin;
    // Dev fallback: if the request came in via localhost, rewrite to the first
    // non-loopback IPv4 so other LAN machines can reach the dev server.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:|$|\/)/.test(origin)) {
      const port = request.nextUrl.port || '3000';
      const lan = getLanOrigin(port);
      if (lan) origin = lan;
    }
  }

  const bat =
    '@echo off\r\n' +
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm ${origin}/install/install-windows.ps1 | iex"\r\n` +
    'echo.\r\n' +
    'echo Press any key to close this window...\r\n' +
    'pause >nul\r\n';

  return new NextResponse(bat, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="install-claude.bat"',
    },
  });
}
