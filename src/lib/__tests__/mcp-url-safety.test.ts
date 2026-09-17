import { lookup } from 'dns/promises';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
const mockLookup = lookup as jest.Mock;

import { assertSafeMcpUrl, createSafeFetch, createPinnedLookup, type CheckedAddress } from '@/lib/mcp-url-safety';

describe('mcp-url-safety', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.ALLOW_LOCAL_MCP_SERVERS;
    delete process.env.NODE_ENV;
    mockLookup.mockReset();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('assertSafeMcpUrl (default, no local flag)', () => {
    it('rejects http', async () => {
      await expect(assertSafeMcpUrl('http://example.com/mcp')).rejects.toThrow('https');
    });

    it('rejects localhost and .local hostnames without a DNS lookup', async () => {
      await expect(assertSafeMcpUrl('https://localhost/mcp')).rejects.toThrow('local address');
      await expect(assertSafeMcpUrl('https://myserver.local/mcp')).rejects.toThrow('local address');
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('rejects a literal private IPv4 address', async () => {
      await expect(assertSafeMcpUrl('https://10.0.5.2/mcp')).rejects.toThrow('private address');
      await expect(assertSafeMcpUrl('https://192.168.1.1/mcp')).rejects.toThrow('private address');
      await expect(assertSafeMcpUrl('https://127.0.0.1/mcp')).rejects.toThrow('private address');
    });

    it('rejects a hostname that resolves to a private address', async () => {
      mockLookup.mockResolvedValue([{ address: '172.16.0.5', family: 4 }]);
      await expect(assertSafeMcpUrl('https://internal.example.com/mcp')).rejects.toThrow('private address');
    });

    it('allows a public https URL', async () => {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      await expect(assertSafeMcpUrl('https://mcp.example.com/mcp')).resolves.not.toBeNull();
    });

    it('rejects an IPv4-mapped IPv6 address embedding a private address', async () => {
      await expect(assertSafeMcpUrl('https://[::ffff:10.0.0.1]/mcp')).rejects.toThrow('private address');
      await expect(assertSafeMcpUrl('https://[::ffff:192.168.1.1]/mcp')).rejects.toThrow('private address');
    });

    it('rejects every non-unicast IPv4 range, not just RFC 1918 — CGNAT, TEST-NETs, benchmark, multicast, broadcast, reserved', async () => {
      // Each of these had been let through by the hand-written allow-list.
      const blocked = [
        '100.64.0.1', // RFC 6598 carrier-grade NAT — common internal cloud/k8s space
        '192.0.0.1', // IETF protocol assignments
        '192.0.2.1', // TEST-NET-1
        '198.51.100.1', // TEST-NET-2
        '203.0.113.1', // TEST-NET-3
        '198.18.0.1', // RFC 2544 benchmarking (not in ipaddr.js's own table)
        '198.19.255.254', // upper end of the same /15
        '224.0.0.1', // multicast
        '255.255.255.255', // broadcast
        '240.0.0.1', // reserved
      ];
      for (const address of blocked) {
        await expect(assertSafeMcpUrl(`https://${address}/mcp`)).rejects.toThrow('private address');
        await expect(assertSafeMcpUrl(`https://[::ffff:${address}]/mcp`)).rejects.toThrow('private address');
      }
    });

    it('still allows ordinary public IPv4 addresses, literal or resolved', async () => {
      await expect(assertSafeMcpUrl('https://8.8.8.8/mcp')).resolves.not.toBeNull();
      await expect(assertSafeMcpUrl('https://198.17.255.255/mcp')).resolves.not.toBeNull(); // just below the benchmark range
      await expect(assertSafeMcpUrl('https://198.20.0.1/mcp')).resolves.not.toBeNull(); // just above it
      mockLookup.mockResolvedValue([{ address: '1.1.1.1', family: 4 }]);
      await expect(assertSafeMcpUrl('https://mcp.example.com/mcp')).resolves.not.toBeNull();
    });

    it('rejects the unspecified IPv6 address ::', async () => {
      await expect(assertSafeMcpUrl('https://[::]/mcp')).rejects.toThrow('private address');
    });

    it('allows a literal public IPv6 address', async () => {
      await expect(assertSafeMcpUrl('https://[2606:4700:4700::1111]/mcp')).resolves.not.toBeNull();
    });
  });

  describe('ALLOW_LOCAL_MCP_SERVERS', () => {
    it('allows http and localhost when set outside production', async () => {
      process.env.ALLOW_LOCAL_MCP_SERVERS = 'true';
      await expect(assertSafeMcpUrl('http://localhost:8787/mcp')).resolves.toBeNull();
      expect(mockLookup).not.toHaveBeenCalled();
    });

    it('refuses to allow local servers when NODE_ENV=production', async () => {
      process.env.ALLOW_LOCAL_MCP_SERVERS = 'true';
      process.env.NODE_ENV = 'production';
      await expect(assertSafeMcpUrl('http://localhost:8787/mcp')).rejects.toThrow('production');
    });
  });

  describe('createSafeFetch', () => {
    it('validates the URL, then calls fetch with redirect: manual', async () => {
      mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      const fetchMock = jest.fn().mockResolvedValue({ status: 200, headers: new Headers() });
      global.fetch = fetchMock as unknown as typeof fetch;

      const safeFetch = createSafeFetch();
      await safeFetch('https://mcp.example.com/mcp');

      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ redirect: 'manual' }),
      );
    });

    it('follows a redirect only after validating its target, and rejects a redirect into a private address', async () => {
      mockLookup.mockImplementation(async (host: string) =>
        host === 'public.example.com'
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '10.0.0.9', family: 4 }],
      );
      const fetchMock = jest.fn().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: 'https://internal.example.com/mcp' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const safeFetch = createSafeFetch();
      await expect(safeFetch('https://public.example.com/mcp')).rejects.toThrow('private address');
    });

    describe('what is forwarded on a redirect', () => {
      const TOKEN_REQUEST: RequestInit = {
        method: 'POST',
        headers: { Authorization: 'Basic Y2xpZW50OnNlY3JldA==', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=refresh_token&refresh_token=rt-1',
      };

      function redirectThenOk(status: number, location: string) {
        const fetchMock = jest
          .fn()
          .mockResolvedValueOnce({ status, headers: new Headers({ location }) })
          .mockResolvedValueOnce({ status: 200, headers: new Headers() });
        global.fetch = fetchMock as unknown as typeof fetch;
        return fetchMock;
      }

      function secondRequest(fetchMock: jest.Mock) {
        const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit & { headers: Headers }];
        return { url, init };
      }

      beforeEach(() => {
        mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
      });

      it('refuses to carry a request body across origins on a 307 or 308', async () => {
        // A token endpoint must not be able to collect the credentials in
        // this app's POST body at an origin of its choosing: under
        // client_secret_post the body holds the client secret, and every
        // token request holds a refresh token or a code plus PKCE verifier.
        for (const status of [307, 308]) {
          redirectThenOk(status, 'https://collector.example.net/collect');

          await expect(
            createSafeFetch()('https://auth.example.com/token', TOKEN_REQUEST),
          ).rejects.toThrow('redirected a request body to https://collector.example.net');
        }
      });

      it('follows a bodyless cross-origin redirect, dropping Authorization', async () => {
        const fetchMock = redirectThenOk(307, 'https://metadata.example.net/.well-known/oauth');

        await createSafeFetch()('https://auth.example.com/.well-known/oauth', {
          headers: { Authorization: 'Basic Y2xpZW50OnNlY3JldA==' },
        });

        const { url, init } = secondRequest(fetchMock);
        expect(url.toString()).toBe('https://metadata.example.net/.well-known/oauth');
        expect(init.headers.get('authorization')).toBeNull();
      });

      it('drops Authorization when a POST is redirected across origins as a bodiless GET', async () => {
        const fetchMock = redirectThenOk(303, 'https://collector.example.net/collect');

        await createSafeFetch()('https://auth.example.com/token', TOKEN_REQUEST);

        const { url, init } = secondRequest(fetchMock);
        expect(url.toString()).toBe('https://collector.example.net/collect');
        expect(init.headers.get('authorization')).toBeNull();
        expect(init.method).toBe('GET');
        expect(init.body).toBeUndefined();
      });

      it('keeps Authorization on a same-origin redirect', async () => {
        const fetchMock = redirectThenOk(307, 'https://auth.example.com/v2/token');

        await createSafeFetch()('https://auth.example.com/token', TOKEN_REQUEST);

        const { init } = secondRequest(fetchMock);
        expect(init.headers.get('authorization')).toBe('Basic Y2xpZW50OnNlY3JldA==');
        expect(init.body).toBe(TOKEN_REQUEST.body);
      });

      it('turns a 303, or a POST answered with 302, into a bodiless GET — as platform fetch does', async () => {
        for (const status of [303, 302]) {
          const fetchMock = redirectThenOk(status, 'https://auth.example.com/done');

          await createSafeFetch()('https://auth.example.com/token', TOKEN_REQUEST);

          const { init } = secondRequest(fetchMock);
          expect(init.method).toBe('GET');
          expect(init.body).toBeUndefined();
          expect(init.headers.get('content-type')).toBeNull();
        }
      });

      it('preserves method and body across a same-origin 307/308, which is what those statuses mean', async () => {
        const fetchMock = redirectThenOk(308, 'https://auth.example.com/token2');

        await createSafeFetch()('https://auth.example.com/token', TOKEN_REQUEST);

        const { init } = secondRequest(fetchMock);
        expect(init.method).toBe('POST');
        expect(init.body).toBe(TOKEN_REQUEST.body);
      });

      it('releases the body of each redirect response it steps past', async () => {
        const cancel = jest.fn().mockResolvedValue(undefined);
        const fetchMock = jest
          .fn()
          .mockResolvedValueOnce({ status: 302, headers: new Headers({ location: 'https://auth.example.com/b' }), body: { cancel } })
          .mockResolvedValueOnce({ status: 200, headers: new Headers() });
        global.fetch = fetchMock as unknown as typeof fetch;

        await createSafeFetch()('https://auth.example.com/a');

        expect(cancel).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('DNS pinning', () => {
    it('returns the addresses it accepted so the connection can be pinned', async () => {
      mockLookup.mockResolvedValue([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ]);
      await expect(assertSafeMcpUrl('https://example.com/mcp')).resolves.toEqual([
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ]);
    });

    it('returns null when the local escape hatch is on, so nothing is pinned', async () => {
      process.env.ALLOW_LOCAL_MCP_SERVERS = 'true';
      await expect(assertSafeMcpUrl('http://localhost:3000/mcp')).resolves.toBeNull();
      delete process.env.ALLOW_LOCAL_MCP_SERVERS;
    });

    describe('the pinned lookup hook', () => {
      const allowed = new Map<string, CheckedAddress[]>([
        ['example.com', [{ address: '93.184.216.34', family: 4 }]],
      ]);

      it('answers only with the checked address, whatever real DNS would say', () => {
        const cb = jest.fn();
        createPinnedLookup(allowed)('example.com', {}, cb);
        expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      });

      it('answers the all-form Node uses under autoSelectFamily', () => {
        const cb = jest.fn();
        createPinnedLookup(allowed)('example.com', { all: true }, cb);
        expect(cb).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
      });

      it('matches the hostname case-insensitively', () => {
        const cb = jest.fn();
        createPinnedLookup(allowed)('EXAMPLE.COM', {}, cb);
        expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4);
      });

      it('fails a hostname that was never checked instead of resolving it', () => {
        const cb = jest.fn();
        createPinnedLookup(allowed)('rebound.example.net', {}, cb);
        expect(cb).toHaveBeenCalledWith(expect.any(Error), '');
        expect((cb.mock.calls[0][0] as Error).message).toMatch(/was not validated/);
      });

      it('cannot be steered to a private address the check never saw', () => {
        // A rebinding record answers the check with a public address and the
        // connection with 127.0.0.1. The hook never learned 127.0.0.1, so the
        // socket cannot go there: it only ever offers what passed the check.
        const cb = jest.fn();
        createPinnedLookup(allowed)('example.com', { all: true }, cb);
        const offered = cb.mock.calls[0][1] as CheckedAddress[];
        expect(offered.map((a) => a.address)).toEqual(['93.184.216.34']);
        expect(offered.map((a) => a.address)).not.toContain('127.0.0.1');
      });
    });
  });
});
