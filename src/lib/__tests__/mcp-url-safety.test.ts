import { lookup } from 'dns/promises';

jest.mock('dns/promises', () => ({ lookup: jest.fn() }));
const mockLookup = lookup as jest.Mock;

import { assertSafeMcpUrl, createSafeFetch } from '@/lib/mcp-url-safety';

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
      await expect(assertSafeMcpUrl('https://mcp.example.com/mcp')).resolves.toBeUndefined();
    });

    it('rejects an IPv4-mapped IPv6 address embedding a private address', async () => {
      await expect(assertSafeMcpUrl('https://[::ffff:10.0.0.1]/mcp')).rejects.toThrow('private address');
      await expect(assertSafeMcpUrl('https://[::ffff:192.168.1.1]/mcp')).rejects.toThrow('private address');
    });

    it('rejects the unspecified IPv6 address ::', async () => {
      await expect(assertSafeMcpUrl('https://[::]/mcp')).rejects.toThrow('private address');
    });

    it('allows a literal public IPv6 address', async () => {
      await expect(assertSafeMcpUrl('https://[2606:4700:4700::1111]/mcp')).resolves.toBeUndefined();
    });
  });

  describe('ALLOW_LOCAL_MCP_SERVERS', () => {
    it('allows http and localhost when set outside production', async () => {
      process.env.ALLOW_LOCAL_MCP_SERVERS = 'true';
      await expect(assertSafeMcpUrl('http://localhost:8787/mcp')).resolves.toBeUndefined();
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
  });
});
