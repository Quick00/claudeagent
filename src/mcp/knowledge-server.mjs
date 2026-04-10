#!/usr/bin/env node

/**
 * Minimal MCP server that exposes a save_knowledge tool.
 * Communicates over stdio using the MCP JSON-RPC protocol.
 * Saves knowledge entries by POSTing to the Next.js API.
 */

import { createInterface } from 'readline';

const API_URL = process.env.KNOWLEDGE_API_URL || 'http://localhost:3000/api/knowledge';
const SEARCH_URL = process.env.KNOWLEDGE_SEARCH_URL || 'http://localhost:3000/api/knowledge/search';
const API_SECRET = process.env.KNOWLEDGE_API_SECRET || '';

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

rl.on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = request;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'knowledge-server', version: '1.0.0' },
      },
    });
    return;
  }

  if (method === 'notifications/initialized') {
    // No response needed for notifications
    return;
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'save_knowledge',
            description:
              'Save a knowledge entry about the platform. Use this when you discover something important while answering a question — a correction, product insight, terminology definition, or business process. This builds a shared knowledge base that improves future answers for everyone.',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['correction', 'terminology', 'product_insight', 'process', 'developer'],
                  description:
                    'correction = wrong assumptions corrected, terminology = what product terms mean, product_insight = how features work, process = business workflows, developer = technical architecture, code patterns, and implementation details',
                },
                content: {
                  type: 'string',
                  description:
                    'The knowledge to save. Keep it concise (1-2 sentences). Write it as a fact, not as a conversation reference. ALWAYS write in English, even if the conversation is in another language.',
                },
                tags: {
                  type: 'string',
                  description:
                    'Comma-separated topic tags (lowercase, 1-2 words each). E.g. "badges,printing" or "registration,hubspot". Reuse existing tags when possible.',
                },
              },
              required: ['category', 'content', 'tags'],
            },
          },
          {
            name: 'search_knowledge',
            description:
              'Search the knowledge base for entries relevant to a question or topic. Use this when the user asks what you know, or when you want to check if knowledge exists about a specific topic before answering.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search query — a question or topic to find relevant knowledge about.',
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10).',
                },
              },
              required: ['query'],
            },
          },
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;

    if (name === 'search_knowledge') {
      try {
        const res = await fetch(SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_SECRET}`,
          },
          body: JSON.stringify({
            query: args.query,
            limit: args.limit || 10,
          }),
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        const entries = data.entries || [];
        let text;
        if (entries.length === 0) {
          text = 'No knowledge entries found for this query.';
        } else {
          text = `Found ${entries.length} relevant knowledge entries:\n\n` +
            entries.map((e, i) => `${i + 1}. [${e.category}] ${e.content}`).join('\n');
        }

        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text }] },
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error searching knowledge: ${err.message}` }],
            isError: true,
          },
        });
      }
      return;
    }

    if (name === 'save_knowledge') {
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_SECRET}`,
          },
          body: JSON.stringify({
            category: args.category,
            content: args.content,
            tags: args.tags || '',
          }),
        });

        const data = await res.json();

        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text:
                  data.status === 'saved'
                    ? `Knowledge saved: [${args.category}] ${args.content}`
                    : `Skipped: ${data.reason || 'unknown'}`,
              },
            ],
          },
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error saving knowledge: ${err.message}` }],
            isError: true,
          },
        });
      }
      return;
    }

    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown tool: ${name}` },
    });
    return;
  }

  // Unknown method
  send({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  });
});
