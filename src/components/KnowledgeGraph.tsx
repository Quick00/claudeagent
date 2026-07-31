'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTheme } from '@/components/ThemeProvider';
import { formatDateTime } from '@/lib/format-date';

interface GraphNode {
  id: string;
  label: string;
  category: string;
  type: 'entry' | 'topic';
  x?: number;
  y?: number;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface KnowledgeEntry {
  id: string;
  subject: string;
  category: string;
  content: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  topic: '#3b82f6',
  terminology: '#8b5cf6',
  product_insight: '#10b981',
  process: '#f59e0b',
  developer: '#0ea5e9',
};

const CATEGORY_LABELS: Record<string, string> = {
  terminology: 'Terminology',
  product_insight: 'Product Insights',
  process: 'Processes',
  developer: 'Developer',
};

export default function KnowledgeGraph() {
  const [allGraphData, setAllGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const { theme } = useTheme();
  const graphRef = useRef<ForceGraphMethods<GraphNode> | undefined>(undefined);

  useEffect(() => {
    Promise.all([
      fetch('/api/knowledge/graph').then((r) => r.json()),
      fetch('/api/knowledge').then((r) => r.json()),
    ]).then(([graph, allEntries]) => {
      setAllGraphData(graph);
      setEntries(allEntries);
      const cats = [...new Set(allEntries.map((e: KnowledgeEntry) => e.category))] as string[];
      setAvailableCategories(cats);
    });
  }, []);

  const graphData = useMemo(() => {
    if (hiddenCategories.size === 0) {
      return allGraphData;
    }
    const visibleEntryIds = new Set(
      allGraphData.nodes
        .filter((n) => n.type === 'entry' && !hiddenCategories.has(n.category))
        .map((n) => n.id)
    );
    const filteredLinks = allGraphData.links.filter((l) => {
      const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
      return visibleEntryIds.has(sourceId);
    });
    const usedTopicIds = new Set(
      filteredLinks.map((l) => (typeof l.target === 'string' ? l.target : l.target.id))
    );
    const filteredNodes = allGraphData.nodes.filter(
      (n) => (n.type === 'entry' && visibleEntryIds.has(n.id)) || (n.type === 'topic' && usedTopicIds.has(n.id))
    );
    return { nodes: filteredNodes, links: filteredLinks };
  }, [hiddenCategories, allGraphData]);

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.d3Force('charge')?.strength(-120);
    graphRef.current.d3Force('link')?.distance(80);
    graphRef.current.d3ReheatSimulation();
  }, [graphData]);

  const nodeDegrees = useMemo(() => {
    const degrees = new Map<string, number>();
    for (const link of graphData.links) {
      const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
      const targetId = typeof link.target === 'string' ? link.target : link.target.id;
      degrees.set(sourceId, (degrees.get(sourceId) ?? 0) + 1);
      degrees.set(targetId, (degrees.get(targetId) ?? 0) + 1);
    }
    return degrees;
  }, [graphData]);

  const getRadius = useCallback(
    (node: GraphNode) => {
      const degree = nodeDegrees.get(node.id) ?? 0;
      const base = node.type === 'topic' ? 6 : 4;
      return base + Math.sqrt(degree) * 1.6;
    },
    [nodeDegrees]
  );

  const toggleCategory = (cat: string) => {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleNodeClick = useCallback((node: GraphNode & { x?: number; y?: number }) => {
    setSelectedNode(node);
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 500);
      graphRef.current.zoom(3, 500);
    }
  }, []);

  const nodeCanvasObject = useCallback(
    (node: GraphNode & { x?: number; y?: number }, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node;
      const fontSize = n.type === 'topic' ? 14 / globalScale : 11 / globalScale;
      const radius = getRadius(n);
      const color = CATEGORY_COLORS[n.type === 'topic' ? 'topic' : n.category] || '#6b7280';

      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      if (selectedNode?.id === n.id) {
        ctx.strokeStyle = theme === 'dark' ? '#fff' : '#000';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      ctx.font = `${n.type === 'topic' ? 'bold ' : ''}${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = theme === 'dark' ? '#d1d5db' : '#374151';
      ctx.fillText(n.label, node.x!, node.y! + radius + 2);
    },
    [selectedNode, theme, getRadius]
  );

  const selectedEntry =
    selectedNode?.type === 'entry'
      ? entries.find((e) => e.id === selectedNode.id)
      : null;

  const connectedEntries =
    selectedNode?.type === 'topic'
      ? entries.filter((e) => {
          const tags = (e.tags || '')
            .split(',')
            .map((t: string) => t.trim().toLowerCase());
          return tags.includes(selectedNode.label);
        })
      : [];

  return (
    <div className="relative h-screen">
      <div className="h-full bg-gray-50 dark:bg-gray-900">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-4">
          <Link
            href="/"
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            &larr; Back to Chat
          </Link>
          <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-100">Knowledge Map</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {graphData.nodes.filter((n) => n.type === 'entry').length} pages,{' '}
            {graphData.nodes.filter((n) => n.type === 'topic').length} topics
          </span>
        </div>

        <div className="absolute bottom-4 left-4 z-10 flex gap-2 rounded-lg bg-white p-3 shadow dark:bg-gray-800">
          {availableCategories.map((cat) => {
            const hidden = hiddenCategories.has(cat);
            return (
              <button
                key={cat}
                onClick={() => toggleCategory(cat)}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-opacity ${
                  hidden ? 'opacity-40' : ''
                }`}
              >
                <span
                  className="inline-block h-3 w-3 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] || '#6b7280' }}
                />
                <span className="text-gray-600 dark:text-gray-300">
                  {CATEGORY_LABELS[cat] || cat.replace('_', ' ')}
                </span>
              </button>
            );
          })}
        </div>

        {graphData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            onNodeClick={handleNodeClick}
            linkColor={() => theme === 'dark' ? '#4b5563' : '#d1d5db'}
            linkWidth={1.5}
            nodePointerAreaPaint={(node: GraphNode & { x?: number; y?: number }, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, Math.max(getRadius(node), 10), 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400 dark:text-gray-500">
            <div className="text-center">
              <p className="mb-2 text-lg">No knowledge entries yet</p>
              <p className="text-sm">
                Start asking questions in the chat — Claude will build the
                knowledge map automatically
              </p>
            </div>
          </div>
        )}
      </div>

      {selectedNode && (
        <div className="absolute right-0 top-0 z-20 h-full w-96 overflow-y-auto border-l border-gray-200 bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          <button
            onClick={() => setSelectedNode(null)}
            className="mb-4 text-sm text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            &times; Close
          </button>

          {selectedNode.type === 'topic' ? (
            <>
              <div className="mb-1 text-xs font-medium uppercase text-blue-500">
                Topic
              </div>
              <h2 className="mb-4 text-xl font-bold text-gray-900 dark:text-gray-100">
                {selectedNode.label}
              </h2>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {connectedEntries.length} related entries
              </div>
              <div className="mt-4 space-y-3">
                {connectedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-gray-100 p-3 dark:border-gray-700"
                  >
                    <div
                      className="mb-1 text-xs font-medium uppercase"
                      style={{
                        color: CATEGORY_COLORS[entry.category] || '#6b7280',
                      }}
                    >
                      {entry.category.replace('_', ' ')}
                    </div>
                    {entry.subject && (
                      <div className="mb-1 text-sm font-semibold text-gray-800 dark:text-gray-200">
                        {entry.subject}
                      </div>
                    )}
                    <div className="prose prose-sm max-w-none text-gray-700 prose-headings:mb-1 prose-headings:mt-2 prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0 prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600 dark:prose-invert dark:text-gray-300 dark:prose-pre:bg-gray-900">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : selectedEntry ? (
            <>
              <div
                className="mb-1 text-xs font-medium uppercase"
                style={{
                  color: CATEGORY_COLORS[selectedEntry.category] || '#6b7280',
                }}
              >
                {selectedEntry.category.replace('_', ' ')}
              </div>
              {selectedEntry.subject && (
                <h2 className="mb-2 text-lg font-bold text-gray-900 dark:text-gray-100">
                  {selectedEntry.subject}
                </h2>
              )}
              <div className="prose prose-sm mb-4 max-w-none leading-relaxed text-gray-800 prose-headings:mb-1 prose-headings:mt-2 prose-p:my-1 prose-ol:my-1 prose-ul:my-1 prose-li:my-0 prose-pre:bg-gray-800 prose-pre:text-gray-100 prose-code:text-pink-600 dark:prose-invert dark:text-gray-200 dark:prose-pre:bg-gray-900">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedEntry.content}</ReactMarkdown>
              </div>
              {selectedEntry.tags && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {selectedEntry.tags.split(',').map((tag: string) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-gray-400">
                Updated {formatDateTime(selectedEntry.updatedAt)}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
