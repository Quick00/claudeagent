const TOOL_LABELS: Record<string, string> = {
  Glob: 'Searching for files...',
  Grep: 'Searching code...',
  Read: 'Reading files...',
  Bash: 'Running a command...',
  WebSearch: 'Searching the web...',
  WebFetch: 'Fetching a page...',
  mcp__knowledge__save_knowledge: 'Saving to knowledge base...',
  mcp__knowledge__search_knowledge: 'Searching knowledge base...',
  mcp__knowledge__resolve_verification: 'Checking a knowledge page...',
};

/** `get_jira_issue`, `getJiraIssue`, `notion-search` → `get jira issue`, … */
function words(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The status line shown under the answer while a tool runs. Tools from a
 * connected MCP server (`mcp__<server>__<tool>`) name the server and what the
 * tool does, so a Jira lookup doesn't read as more codebase digging.
 */
export function toolStatusLabel(tool: string | undefined): string {
  if (tool && TOOL_LABELS[tool]) return TOOL_LABELS[tool];

  const mcp = tool?.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) {
    const server = capitalize(words(mcp[1]));
    const action = words(mcp[2]);
    return action ? `Using ${server}: ${action}...` : `Using ${server}...`;
  }

  return 'Analyzing the codebase...';
}
