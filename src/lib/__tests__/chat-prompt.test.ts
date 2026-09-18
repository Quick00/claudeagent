import { buildSystemPrompt, buildCliMessage } from '@/lib/chat-prompt';
import { config } from '@/lib/config';
import type { LabelledEntry } from '@/lib/knowledge-context';

jest.mock('@/lib/prisma', () => ({ prisma: {} }));
jest.mock('@/lib/embeddings', () => ({ findRelevantEntries: jest.fn() }));
jest.mock('@/lib/knowledge-repos', () => ({ loadActiveHeadTrees: jest.fn() }));

const entry: LabelledEntry = {
  id: 'k1',
  subject: 'Wristband Scanning',
  category: 'product_insight',
  content: 'Wristbands are scanned at the entrance.',
  tags: '',
  freshness: { state: 'fresh' },
} as unknown as LabelledEntry;

const JIRA = { name: 'jira', description: 'Customer tickets and their status.' };

describe('buildSystemPrompt', () => {
  it('describes the connected sources when the user has linked one', () => {
    const prompt = buildSystemPrompt({ isResumed: false, knowledge: [], repoContext: '', linkedServers: [JIRA] });

    expect(prompt).toContain('jira');
    expect(prompt).toContain('Customer tickets and their status.');
  });

  it('says nothing about sources when the user has linked none', () => {
    const prompt = buildSystemPrompt({ isResumed: false, knowledge: [], repoContext: '', linkedServers: [] });

    expect(prompt).not.toMatch(/CONNECTED SOURCES/);
  });

  it('keeps the codebase and knowledge-tool instructions alongside the sources', () => {
    const prompt = buildSystemPrompt({
      isResumed: false,
      knowledge: [],
      repoContext: '\n\nYou have access to the following codebases:\n- "app": the product',
      linkedServers: [JIRA],
    });

    expect(prompt).toContain(config.systemPrompt);
    expect(prompt).toContain('You have access to the following codebases:');
    expect(prompt).toContain('search_knowledge');
  });

  it('includes retrieved knowledge on a fresh session and not on a resumed one', () => {
    const fresh = buildSystemPrompt({ isResumed: false, knowledge: [entry], repoContext: '', linkedServers: [] });
    const resumed = buildSystemPrompt({ isResumed: true, knowledge: [entry], repoContext: '', linkedServers: [] });

    expect(fresh).toContain('Wristband Scanning');
    expect(resumed).not.toContain('Wristband Scanning');
  });
});

describe('buildCliMessage', () => {
  it('sends a first message through untouched', () => {
    const built = buildCliMessage({ isResumed: false, knowledge: [], linkedServers: [JIRA], message: 'How does wristband scanning work?' });

    expect(built).toBe('How does wristband scanning work?');
  });

  it('reminds a resumed turn which sources are connected', () => {
    const built = buildCliMessage({ isResumed: true, knowledge: [], linkedServers: [JIRA], message: 'And the badges?' });

    expect(built).toContain('jira');
    expect(built).toContain('And the badges?');
  });

  it('leaves the reminder out of a resumed turn when no source is connected', () => {
    const built = buildCliMessage({ isResumed: true, knowledge: [], linkedServers: [], message: 'And the badges?' });

    expect(built).not.toMatch(/CONNECTED SOURCES/);
    expect(built).toContain(config.responseReminder);
  });

  it('keeps the tone reminder and the knowledge delta on a resumed turn', () => {
    const built = buildCliMessage({ isResumed: true, knowledge: [entry], linkedServers: [JIRA], message: 'And the badges?' });

    expect(built).toContain(config.responseReminder);
    expect(built).toContain('Wristband Scanning');
  });
});
