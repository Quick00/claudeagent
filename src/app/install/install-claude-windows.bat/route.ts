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
  let origin = request.nextUrl.origin;

  // In dev, the URL baked into the .bat must be reachable from the Windows machine
  // running the installer. If the request came in via localhost, rewrite to the
  // first non-loopback IPv4 so other LAN machines can reach it. APP_PUBLIC_URL
  // overrides the auto-detect when needed.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|$|\/)/.test(origin)) {
    const override = process.env.APP_PUBLIC_URL;
    if (override) {
      origin = override.replace(/\/$/, '');
    } else {
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
