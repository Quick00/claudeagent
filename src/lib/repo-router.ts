const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const ROUTING_MODEL = 'openai/gpt-4o-mini';

interface RepoOption {
  id: string;
  name: string;
  description: string;
}

export async function routeQuestion(
  question: string,
  repos: RepoOption[],
): Promise<string> {
  if (repos.length === 1) {
    return repos[0].id;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const repoList = repos
    .map((r) => `- id: ${r.id} | name: "${r.name}" | description: "${r.description}"`)
    .join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  let response: Response;
  try {
    response = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: ROUTING_MODEL,
        messages: [
          {
            role: 'system',
            content:
              'You are a routing assistant. Given a user question and a list of code repositories with descriptions, pick the single best matching repository. Return ONLY the repository ID, nothing else. No explanation, no quotes, just the ID.',
          },
          {
            role: 'user',
            content: `Repositories:\n${repoList}\n\nQuestion: "${question}"`,
          },
        ],
        max_tokens: 100,
        temperature: 0,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error('Routing request timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Routing API failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const chosenId = data.choices?.[0]?.message?.content?.trim();

  const match = repos.find((r) => r.id === chosenId);
  if (!match) {
    console.error(`[router] Model returned invalid repo ID: "${chosenId}". Valid IDs: ${repos.map((r) => r.id).join(', ')}`);
    throw new Error('Could not determine which repository to use for this question.');
  }

  return match.id;
}
