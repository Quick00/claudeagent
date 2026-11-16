#!/usr/bin/env node

/**
 * Minimal MCP server that exposes a save_knowledge tool.
 * Communicates over stdio using the MCP JSON-RPC protocol.
 * Saves knowledge entries by POSTing to the Next.js API.
 */

import { createInterface } from 'readline';

const API_URL = process.env.KNOWLEDGE_API_URL || 'http://localhost:3000/api/knowledge';
const SEARCH_URL = process.env.KNOWLEDGE_SEARCH_URL || 'http://localhost:3000/api/knowledge/search';
const VERIFY_URL = process.env.KNOWLEDGE_VERIFY_URL || 'http://localhost:3000/api/knowledge/verify-result';
const FILES_URL = process.env.KNOWLEDGE_FILES_URL || 'http://localhost:3000/api/files/generate';
const API_SECRET = process.env.KNOWLEDGE_API_SECRET || '';
const PROVENANCE_KEY = process.env.PROVENANCE_KEY || '';
/**
 * Set only by startTier2() for a tier 2 verification run. When it is empty
 * this server is serving an ordinary chat session: resolve_verification is not
 * offered and not callable, so no chat session can resolve a pending run. When
 * it is set, the run is a verification and save_knowledge is withheld instead
 * — a verifier reports through resolve_verification, it does not write pages.
 */
const VERIFICATION_RUN_ID = process.env.VERIFICATION_RUN_ID || '';

const rl = createInterface({ input: process.stdin });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * Repo paths come from git output in a synced repository - untrusted content.
 * Flatten control characters so a crafted filename cannot forge a heading
 * inside the tool result Claude reads.
 */
function renderPaths(paths) {
  return (paths || []).map((p) => String(p).replace(/[\x00-\x1f\x7f]/g, ' ')).join(', ');
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
    const tools = [
      {
        name: 'save_knowledge',
        description:
          'Save or update a knowledge page. The system automatically finds the right page and integrates your knowledge, or creates a new one if the subject is genuinely new. You do not need to worry about duplicates — the system handles deduplication and merging. Prefer describing where a feature lives and its key concepts over long behavioural descriptions; keep behavioural claims short and tied to files you actually read.',
        inputSchema: {
          type: 'object',
          properties: {
            category: {
              type: 'string',
              enum: ['terminology', 'product_insight', 'process', 'developer'],
              description:
                'terminology = what product terms mean, product_insight = how features work, process = business workflows, developer = technical architecture, code patterns, and implementation details',
            },
            content: {
              type: 'string',
              description:
                'The knowledge to save. Write it as a general principle or rule, not a specific one-time observation. ALWAYS write in English, even if the conversation is in another language.',
            },
            subject: {
              type: 'string',
              description:
                'Suggested page title for this knowledge (e.g. "Badge Printing", "HubSpot Contact Sync"). The system may adjust this.',
            },
            tags: {
              type: 'string',
              description:
                'Comma-separated topic tags (lowercase, 1-2 words each). E.g. "badges,printing" or "registration,hubspot".',
            },
            based_on: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Optional. Repository file paths this knowledge is based on, if you know them (relative or absolute). Used to narrow provenance to the files that matter; you cannot add files you did not read.',
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
      {
        name: 'create_file',
        description:
          'Create an Excel (.xlsx) or PDF file the user can download. Only use this when the user asks for a file, export, spreadsheet, Excel or PDF. The file appears as a download under your reply automatically — do not paste links or ids. For xlsx pass sheets; for pdf pass content as Markdown. Never put file names, paths or code in the file.',
        inputSchema: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['xlsx', 'pdf'], description: 'xlsx = Excel workbook, pdf = document.' },
            filename: { type: 'string', description: 'File name without extension, in plain words (e.g. "Event settings overview").' },
            title: { type: 'string', description: 'pdf only: the document title shown at the top.' },
            sheets: {
              type: 'array',
              description: 'xlsx only: one entry per sheet (max 10; max 5000 rows and 50 columns per sheet).',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Sheet name.' },
                  columns: { type: 'array', items: { type: 'string' }, description: 'Header row.' },
                  rows: {
                    type: 'array',
                    description: 'Data rows; each row is an array of values in column order (text, number, true/false or null).',
                    items: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] } },
                  },
                },
                required: ['name', 'columns', 'rows'],
              },
            },
            content: { type: 'string', description: 'pdf only: the document as Markdown (headings, paragraphs, lists, bold/italic, tables).' },
          },
          required: ['format', 'filename'],
        },
      },
      {
        name: 'resolve_verification',
        description:
          'Report the result of a knowledge verification run. Only call this when your message asked you to verify a specific page and gave you a run id. A "changed" result is queued for an admin to accept, not applied to the page.',
        inputSchema: {
          type: 'object',
          properties: {
            run_id: { type: 'string', description: 'The verification run id from your instructions.' },
            entry_id: { type: 'string', description: 'The knowledge entry id from your instructions.' },
            outcome: {
              type: 'string',
              enum: ['confirmed', 'changed', 'retired'],
              description:
                'confirmed = still accurate; changed = needs the corrected text in content; retired = the feature/rule no longer exists.',
            },
            content: { type: 'string', description: 'Full corrected page text. Required when outcome is "changed"; an admin reviews it before it replaces the page.' },
          },
          required: ['run_id', 'entry_id', 'outcome'],
        },
      },
    ];
    send({
      jsonrpc: '2.0',
      id,
      result: {
        // resolve_verification exists only for a verification run; save_knowledge
        // and create_file exist only outside one.
        tools: tools.filter((t) =>
          t.name === 'resolve_verification'
            ? Boolean(VERIFICATION_RUN_ID)
            : !(VERIFICATION_RUN_ID && (t.name === 'save_knowledge' || t.name === 'create_file')),
        ),
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
            entries.map((e, i) => {
              const label = e.freshness === 'stale'
                ? `possibly outdated — files changed since it was saved: ${renderPaths(e.changedPaths)}`
                : e.freshness === 'unverified'
                  ? 'unverified — saved without reading code; treat as a hint'
                  : e.kind === 'pinned' ? 'verified, pinned business rule' : 'verified against current code';
              return `${i + 1}. ${e.subject || e.category} [${label}]\n   ${e.content}`;
            }).join('\n\n');
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
      if (VERIFICATION_RUN_ID) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'save_knowledge is not available during a verification run; report the result with resolve_verification.' }],
            isError: true,
          },
        });
        return;
      }
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
            subject: args.subject || '',
            provenanceKey: PROVENANCE_KEY || undefined,
            basedOn: Array.isArray(args.based_on) ? args.based_on : undefined,
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
                text: data.message || (data.status === 'saved'
                  ? `Knowledge saved: [${args.category}] ${args.content}`
                  : data.status === 'conflict'
                    ? `Not saved: conflicts with pinned rule '${data.subject}'. An admin will review.`
                    : `Skipped: ${data.reason || 'unknown'}`),
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

    if (name === 'create_file') {
      if (VERIFICATION_RUN_ID) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'create_file is not available during a verification run.' }],
            isError: true,
          },
        });
        return;
      }
      try {
        const res = await fetch(FILES_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_SECRET}`,
          },
          body: JSON.stringify({ ...args, provenanceKey: PROVENANCE_KEY }),
        });
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const data = await res.json();
        send({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Created ${data.filename}. It will appear as a download under your reply.` }] },
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `The file was not created: ${err.message}` }],
            isError: true,
          },
        });
      }
      return;
    }

    if (name === 'resolve_verification') {
      // The run id comes from the environment this process was spawned with,
      // never from the model: a tool call naming any other run is refused.
      if (!VERIFICATION_RUN_ID || args.run_id !== VERIFICATION_RUN_ID) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'resolve_verification is only available to the verification run it was started for.' }],
            isError: true,
          },
        });
        return;
      }
      try {
        const res = await fetch(VERIFY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${API_SECRET}`,
          },
          body: JSON.stringify({
            runId: VERIFICATION_RUN_ID,
            entryId: args.entry_id,
            outcome: args.outcome,
            content: args.content,
          }),
        });

        const data = await res.json().catch(() => ({}));

        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: res.ok
                  ? `Verification recorded: ${args.outcome}.`
                  : `Could not record verification: ${data.error || res.status}`,
              },
            ],
            ...(res.ok ? {} : { isError: true }),
          },
        });
      } catch (err) {
        send({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Error recording verification: ${err.message}` }],
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
