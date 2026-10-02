import { toolStatusLabel } from './tool-status';

describe('toolStatusLabel', () => {
  it('uses the fixed label for known tools', () => {
    expect(toolStatusLabel('Grep')).toBe('Searching code...');
    expect(toolStatusLabel('mcp__knowledge__search_knowledge')).toBe('Searching knowledge base...');
  });

  it('names the server and the action for other MCP tools', () => {
    expect(toolStatusLabel('mcp__atlassian__getJiraIssue')).toBe('Using Atlassian: get jira issue...');
    expect(toolStatusLabel('mcp__sentry__search_issues')).toBe('Using Sentry: search issues...');
    expect(toolStatusLabel('mcp__my-notion__notion-search')).toBe('Using My notion: notion search...');
  });

  it('falls back to the codebase label for other built-in tools', () => {
    expect(toolStatusLabel('TodoWrite')).toBe('Analyzing the codebase...');
    expect(toolStatusLabel(undefined)).toBe('Analyzing the codebase...');
  });
});
