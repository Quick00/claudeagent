export const config = {
  eventinsightRepoPath: process.env.EVENTINSIGHT_REPO_PATH || '',
  maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS || '5', 10),
  sessionIdleTimeoutMs: parseInt(process.env.SESSION_IDLE_TIMEOUT_MS || '300000', 10),
  claudeMaxTurns: parseInt(process.env.CLAUDE_MAX_TURNS || '25', 10),
  systemPrompt: `You are an internal support tool for the EventInsight platform by Let's Get Digital.
Answer questions about how the product works by reading the actual codebase.
Explain in terms non-developers can understand.
When referencing code, mention the file path but focus on explaining behavior, not implementation details.
If you're unsure, say so rather than guessing.`,
} as const;
