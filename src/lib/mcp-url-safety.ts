import { lookup } from 'dns/promises';
import { isIP } from 'net';
import * as ipaddr from 'ipaddr.js';

// RFC 2544 benchmarking range. ipaddr.js 2.x reports it as 'reserved', which
// the default-deny check below already catches, but 1.x reads it as plain
// 'unicast' — so it is named here rather than left to the installed version.
const IPV4_BENCHMARK_RANGE = ipaddr.IPv4.parseCIDR('198.18.0.0/15');

function isPrivateIPv4(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() !== 'ipv4') return false;
    const ipv4 = parsed as ipaddr.IPv4;
    if (ipv4.match(IPV4_BENCHMARK_RANGE)) return true;
    // Default-deny, the same shape as the IPv6 check below: only a normal
    // globally-routable ('unicast') address is public. A hand-written
    // allow-by-default list had let through CGNAT 100.64.0.0/10 (RFC 6598 —
    // common internal cloud/k8s NAT space), 192.0.0.0/24, the TEST-NETs,
    // multicast, broadcast and 240.0.0.0/4.
    return parsed.range() !== 'unicast';
  } catch {
    // Only reached for a string neither `net.isIP` nor the resolver
    // produced; an SSRF guard fails closed on input it cannot classify.
    return true;
  }
}

function isPrivateIPv6(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() !== 'ipv6') return false;
    const ipv6 = parsed as ipaddr.IPv6;
    if (ipv6.isIPv4MappedAddress()) {
      return isPrivateIPv4(ipv6.toIPv4Address().toString());
    }
    // Default-deny: only a normal globally-routable ('unicast') IPv6 address
    // is treated as public. Every other range name ipaddr.js reports —
    // loopback, linkLocal, uniqueLocal, unspecified, multicast, 6to4,
    // teredo, reserved, and any future range this covers — counts as
    // private, since an SSRF guard should fail closed on anything it
    // doesn't specifically recognize as safe.
    return parsed.range() !== 'unicast';
  } catch {
    // Same as the IPv4 branch: only reachable for a string neither
    // `net.isIP` nor the resolver produced, and a guard that cannot
    // classify its input fails closed rather than waving it through.
    return true;
  }
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

  let hostname = url.hostname.toLowerCase();
  // Strip brackets from IPv6 literal addresses (Node's URL parser keeps them)
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    hostname = hostname.slice(1, -1);
  }

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
 * Rewrites a request the way the Fetch standard does when it follows a
 * redirect itself (steps this wrapper takes over by using `redirect:
 * 'manual'`): a 303, or a 301/302 answering a POST, becomes a bodiless GET
 * (RFC 9110 §15.4), and a hop to a different origin loses `Authorization`.
 *
 * The second rule is what keeps a linked server's token or registration
 * endpoint from answering with one 302 and collecting this app's client
 * secret plus the user's refresh token or authorization code at an origin of
 * its choosing — `assertSafeMcpUrl` only checks the target is public https.
 * Platform `fetch` already strips the header on a cross-origin redirect;
 * before this the wrapper regressed that.
 */
function rewriteForRedirect(init: RequestInit | undefined, status: number, from: URL, to: URL): RequestInit {
  const headers = new Headers(init?.headers);
  let { method, body } = init ?? {};

  if (status === 303 || ((status === 301 || status === 302) && (method ?? 'GET').toUpperCase() === 'POST')) {
    method = 'GET';
    body = undefined;
    for (const name of ['content-type', 'content-length', 'content-encoding', 'content-language', 'content-location']) {
      headers.delete(name);
    }
  }
  if (from.origin !== to.origin) {
    headers.delete('authorization');
  }
  return { ...init, method, body, headers };
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
    let current = init;
    for (let i = 0; i <= maxRedirects; i++) {
      await assertSafeMcpUrl(url);
      const res = await fetch(url, { ...current, redirect: 'manual' });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        // Nothing reads a redirect response's body; releasing it hands the
        // connection back instead of holding it until garbage collection.
        void res.body?.cancel().catch(() => {});
        const next = new URL(location, url);
        current = rewriteForRedirect(current, res.status, url, next);
        url = next;
        continue;
      }
      return res;
    }
    throw new Error(`too many redirects fetching ${input}`);
  };
}
