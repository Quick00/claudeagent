import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns default values when env vars are not set', async () => {
    delete process.env.MAX_CONCURRENT_SESSIONS;
    delete process.env.SESSION_IDLE_TIMEOUT_MS;
    delete process.env.CLAUDE_MAX_TURNS;
    process.env.EVENTINSIGHT_REPO_PATH = '/some/path';

    const { config } = await import('@/lib/config');
    expect(config.maxConcurrentSessions).toBe(5);
    expect(config.sessionIdleTimeoutMs).toBe(300000);
    expect(config.claudeMaxTurns).toBe(25);
  });

  it('reads values from env vars', async () => {
    process.env.MAX_CONCURRENT_SESSIONS = '10';
    process.env.SESSION_IDLE_TIMEOUT_MS = '60000';
    process.env.CLAUDE_MAX_TURNS = '50';
    process.env.EVENTINSIGHT_REPO_PATH = '/custom/path';

    const { config } = await import('@/lib/config');
    expect(config.maxConcurrentSessions).toBe(10);
    expect(config.sessionIdleTimeoutMs).toBe(60000);
    expect(config.claudeMaxTurns).toBe(50);
    expect(config.eventinsightRepoPath).toBe('/custom/path');
  });
});
