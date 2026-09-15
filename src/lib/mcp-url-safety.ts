import { lookup } from 'dns/promises';
import { isIP } from 'net';

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    lower.startsWith('fe8') ||
    lower.startsWith('fe9') ||
    lower.startsWith('fea') ||
    lower.startsWith('feb')
  );
}

/**
 * Meant for a developer's own machine only: throws rather than silently
 * no-op if it's ever set where NODE_ENV=production, so it can't end up
 * enabled anywhere but local dev.
 */
export function isLocalMcpAllowed(): boolean {
  const enabled = process.env.ALLOW_LOCAL_MCP_SERVERS === 'true';
  if (enabled && process.env.NODE_ENV === 'production') {
    throw new Error('ALLOW_LOCAL_MCP_SERVERS must not be set when NODE_ENV=production');
  }
  return enabled;
}

/**
 * Throws unless `input` is an https URL resolving to a public address.
 * Applied to every URL fetched while linking an MCP server — the admin's
 * `serverUrl`, every endpoint discovered from it, and each redirect hop —
 * not only the one address an admin typed in.
 */
export async function assertSafeMcpUrl(input: string | URL): Promise<void> {
  const url = typeof input === 'string' ? new URL(input) : input;
  const allowLocal = isLocalMcpAllowed();

  if (allowLocal) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`${url} must use http or https`);
    }
    return;
  }

  if (url.protocol !== 'https:') {
    throw new Error(`${url} must use https`);
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error(`${url} resolves to a local address, which is not allowed`);
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true }).catch(() => {
        throw new Error(`${url} hostname could not be resolved`);
      });

  for (const { address, family } of addresses) {
    if ((family === 4 && isPrivateIPv4(address)) || (family === 6 && isPrivateIPv6(address))) {
      throw new Error(`${url} resolves to a private address (${address}), which is not allowed`);
    }
  }
}

/**
 * A `fetch`-compatible function that validates a URL before every request
 * AND before following each redirect, since OAuth discovery chases several
 * server-supplied URLs that aren't the one an admin typed in. Passed as
 * `fetchFn` to every `@modelcontextprotocol/sdk` client-auth call.
 */
export function createSafeFetch(maxRedirects = 5) {
  return async function safeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    let url = typeof input === 'string' ? new URL(input) : input;
    for (let i = 0; i <= maxRedirects; i++) {
      await assertSafeMcpUrl(url);
      const res = await fetch(url, { ...init, redirect: 'manual' });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        url = new URL(location, url);
        continue;
      }
      return res;
    }
    throw new Error(`too many redirects fetching ${input}`);
  };
}
