#!/usr/bin/env node

/**
 * Minimal MCP server that exposes a save_knowledge tool.
 * Communicates over stdio using the MCP JSON-RPC protocol.
 * Saves knowledge entries by POSTing to the Next.js API.
 */

import { createInterface } from 'readline';

const API_URL = process.env.KNOWLEDGE_API_URL || 'http://localhost:3000/api/knowledge';
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
              'Save a knowledge entry about the EventInsight platform. Use this when you discover something important while answering a question — a correction, product insight, terminology definition, or business process. This builds a shared knowledge base that improves future answers for everyone.',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  enum: ['correction', 'terminology', 'product_insight', 'process'],
                  description:
                    'correction = wrong assumptions corrected, terminology = what product terms mean, product_insight = how features work, process = business workflows',
                },
                content: {
                  type: 'string',
                  description:
                    'The knowledge to save. Keep it concise (1-2 sentences). Write it as a fact, not as a conversation reference.',
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
        ],
      },
    });
    return;
  }

  if (method === 'tools/call') {
    const { name, arguments: args } = params;

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
