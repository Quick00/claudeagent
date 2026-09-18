import { config } from '@/lib/config';
import { formatKnowledgeBlock, formatKnowledgeDelta, type LabelledEntry } from '@/lib/knowledge-context';
import { formatMcpServersBlock, formatMcpServersReminder, type LinkedServerSummary } from '@/lib/mcp-context';

interface PromptInput {
  isResumed: boolean;
  knowledge: LabelledEntry[];
  repoContext: string;
  linkedServers: LinkedServerSummary[];
}

// A resumed run is spawned with `--resume` alone and never receives this, which is what `buildCliMessage` makes up for.
export function buildSystemPrompt({ isResumed, knowledge, repoContext, linkedServers }: PromptInput): string {
  let prompt = config.systemPrompt;
  if (!isResumed) {
    prompt += formatKnowledgeBlock(knowledge);
  }
  prompt += repoContext;
  prompt += formatMcpServersBlock(linkedServers);
  prompt += `\n\n${config.knowledgeToolsPrompt}`;
  return prompt;
}

interface MessageInput {
  isResumed: boolean;
  knowledge: LabelledEntry[];
  linkedServers: LinkedServerSummary[];
  message: string;
}

export function buildCliMessage({ isResumed, knowledge, linkedServers, message }: MessageInput): string {
  if (!isResumed) return message;

  const delta = knowledge.length > 0 ? `${formatKnowledgeDelta(knowledge)}\n\n` : '';
  return config.responseReminder + formatMcpServersReminder(linkedServers) + delta + message;
}
