import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
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
