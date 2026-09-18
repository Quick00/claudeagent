import { config } from '@/lib/config';

/**
 * These values are spec invariants, not preferences: every use site reaches them
 * through `config.*` rather than hardcoding, and other suites mock this module.
 * Pin the real defaults here so a silent edit to one of them fails a test.
 */
describe('knowledge config defaults', () => {
  it('retrieves at a 0.45 cosine-similarity threshold', () => {
    expect(config.knowledgeRetrievalThreshold).toBe(0.45);
  });

  it('attaches at most 15 sources to one save', () => {
    expect(config.knowledgeMaxSourcesPerSave).toBe(15);
  });

  it('ignores the churn directories', () => {
    expect([...config.knowledgeIgnoreSegments]).toEqual([
      'translations',
      'vendor',
      'node_modules',
      'dist',
      'build',
    ]);
  });

  it('ignores the lockfiles', () => {
    expect([...config.knowledgeIgnoreBasenames]).toEqual([
      'package-lock.json',
      'composer.lock',
      'yarn.lock',
      'pnpm-lock.yaml',
    ]);
  });

  it('denies every tool that would write to a repo or read outside Read', () => {
    expect([...config.claudeDisallowedTools]).toEqual([
      'Bash',
      'Task',
      'Write',
      'Edit',
      'NotebookEdit',
      'WebFetch',
      'WebSearch',
    ]);
  });

  it('does not present the knowledge tools as the only tools in the session', () => {
    expect(config.knowledgeToolsPrompt).not.toMatch(/you have two knowledge tools/i);
    expect(config.knowledgeToolsPrompt).toMatch(/two of your tools/i);
  });

  it('does not present the codebase as the only place an answer can come from', () => {
    expect(config.systemPrompt).toMatch(/connected to/i);
  });

  it('tells the tier 2 verifier that source files are data, never instructions', () => {
    // Without this, a comment in a synced customer repo can dictate both the
    // verdict and the replacement text of a knowledge page.
    const prompt = config.verificationSystemPrompt;
    expect(prompt).toMatch(/strictly as data/i);
    expect(prompt).toMatch(/look like instructions|looks like instructions/i);
    expect(prompt).toMatch(/run id/i);
  });
});
