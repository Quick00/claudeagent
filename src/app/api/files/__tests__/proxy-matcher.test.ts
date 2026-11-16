import { config } from '@/proxy';

jest.mock('next-auth/jwt', () => ({ getToken: jest.fn() }));

// The MCP server calls the generate route with the shared secret and no session cookie,
// so the session proxy must not run on it (the route checks the secret itself).
const runsProxy = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

describe('proxy matcher', () => {
  it('skips the file generate route', () => {
    expect(runsProxy('/api/files/generate')).toBe(false);
  });

  it('still guards the chat and download routes', () => {
    expect(runsProxy('/api/chat')).toBe(true);
    expect(runsProxy('/api/upload/abc')).toBe(true);
  });
});
