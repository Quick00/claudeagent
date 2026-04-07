import { generatePKCE, buildAuthorizeUrl, exchangeCodeForTokens, refreshAccessToken } from '@/lib/claude-oauth';

describe('claude-oauth', () => {
  describe('generatePKCE', () => {
    it('returns a verifier and challenge', async () => {
      const { verifier, challenge } = await generatePKCE();
      expect(verifier).toBeTruthy();
      expect(challenge).toBeTruthy();
      expect(verifier.length).toBeGreaterThan(40);
      expect(challenge).not.toBe(verifier);
    });

    it('produces URL-safe base64 (no +, /, =)', async () => {
      const { verifier, challenge } = await generatePKCE();
      const unsafeChars = /[+/=]/;
      expect(unsafeChars.test(verifier)).toBe(false);
      expect(unsafeChars.test(challenge)).toBe(false);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds correct URL with all params', () => {
      const url = buildAuthorizeUrl({
        codeChallenge: 'test-challenge',
        state: 'test-state',
        redirectUri: 'http://localhost:3000/api/auth/claude/callback',
      });
      const parsed = new URL(url);
      expect(parsed.origin).toBe('https://claude.ai');
      expect(parsed.pathname).toBe('/oauth/authorize');
      expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge');
      expect(parsed.searchParams.get('state')).toBe('test-state');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/claude/callback');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('scope')).toBe('user:inference');
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('sends correct request and parses response', async () => {
      const mockResponse = {
        access_token: 'access-123',
        refresh_token: 'refresh-456',
        expires_in: 28800,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await exchangeCodeForTokens({
        code: 'auth-code',
        codeVerifier: 'verifier-abc',
        redirectUri: 'http://localhost:3000/api/auth/claude/callback',
      });

      expect(result.accessToken).toBe('access-123');
      expect(result.refreshToken).toBe('refresh-456');
      expect(result.expiresIn).toBe(28800);

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://console.anthropic.com/v1/oauth/token');
      expect(options.method).toBe('POST');
      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('code_verifier')).toBe('verifier-abc');
    });

    it('throws on non-ok response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(
        exchangeCodeForTokens({
          code: 'bad-code',
          codeVerifier: 'verifier',
          redirectUri: 'http://localhost:3000/api/auth/claude/callback',
        })
      ).rejects.toThrow('Token exchange failed');
    });
  });

  describe('refreshAccessToken', () => {
    it('sends refresh request and returns new tokens', async () => {
      const mockResponse = {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 28800,
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await refreshAccessToken('old-refresh-token');

      expect(result.accessToken).toBe('new-access');
      expect(result.refreshToken).toBe('new-refresh');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://console.anthropic.com/v1/oauth/token');
      const body = new URLSearchParams(options.body);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('old-refresh-token');
    });
  });
});
