'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
});

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

const CATEGORY_COLORS: Record<string, string> = {
  topic: '#3b82f6',
  correction: '#ef4444',
  terminology: '#8b5cf6',
  product_insight: '#10b981',
  process: '#f59e0b',
};

export default function KnowledgePage() {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const graphRef = useRef<any>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/knowledge/graph').then((r) => r.json()),
      fetch('/api/knowledge').then((r) => r.json()),
    ]).then(([graph, allEntries]) => {
      setGraphData(graph);
      setEntries(allEntries);
    });
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    setSelectedNode(node as GraphNode);
    if (graphRef.current) {
      graphRef.current.centerAt(node.x, node.y, 500);
      graphRef.current.zoom(3, 500);
    }
  }, []);

  const nodeCanvasObject = useCallback(
    (node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const fontSize = n.type === 'topic' ? 14 / globalScale : 11 / globalScale;
      const radius = n.type === 'topic' ? 8 : 5;
      const color = CATEGORY_COLORS[n.type === 'topic' ? 'topic' : n.category] || '#6b7280';

      // Draw circle
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      if (selectedNode?.id === n.id) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2 / globalScale;
        ctx.stroke();
      }

      // Draw label
      ctx.font = `${n.type === 'topic' ? 'bold ' : ''}${fontSize}px Sans-Serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#374151';
      ctx.fillText(n.label, node.x!, node.y! + radius + 2);
    },
    [selectedNode]
  );

  // Find full entry for selected node
  const selectedEntry =
    selectedNode?.type === 'entry'
      ? entries.find((e) => e.id === selectedNode.id)
      : null;

  // Find connected entries for selected topic
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
    <div className="flex h-screen">
      {/* Graph */}
      <div className="flex-1 bg-gray-50">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-4">
          <a
            href="/"
            className="rounded-lg bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow hover:bg-gray-100"
          >
            &larr; Back to Chat
          </a>
          <h1 className="text-lg font-semibold text-gray-800">Knowledge Map</h1>
          <span className="text-sm text-gray-500">
            {graphData.nodes.filter((n) => n.type === 'entry').length} entries,{' '}
            {graphData.nodes.filter((n) => n.type === 'topic').length} topics
          </span>
        </div>

        {/* Legend */}
        <div className="absolute bottom-4 left-4 z-10 flex gap-4 rounded-lg bg-white p-3 shadow">
          {Object.entries(CATEGORY_COLORS).map(([key, color]) => (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-xs text-gray-600">
                {key.replace('_', ' ')}
              </span>
            </div>
          ))}
        </div>

        {graphData.nodes.length > 0 ? (
          <ForceGraph2D
            ref={graphRef}
            graphData={graphData}
            nodeCanvasObject={nodeCanvasObject}
            onNodeClick={handleNodeClick}
            linkColor={() => '#d1d5db'}
            linkWidth={1.5}
            nodePointerAreaPaint={(node: any, color: string, ctx: CanvasRenderingContext2D) => {
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, 10, 0, 2 * Math.PI);
              ctx.fillStyle = color;
              ctx.fill();
            }}
            cooldownTicks={100}
            d3AlphaDecay={0.02}
            d3VelocityDecay={0.3}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-gray-400">
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

      {/* Detail panel */}
      {selectedNode && (
        <div className="w-80 border-l border-gray-200 bg-white p-6">
          <button
            onClick={() => setSelectedNode(null)}
            className="mb-4 text-sm text-gray-400 hover:text-gray-600"
          >
            &times; Close
          </button>

          {selectedNode.type === 'topic' ? (
            <>
              <div className="mb-1 text-xs font-medium uppercase text-blue-500">
                Topic
              </div>
              <h2 className="mb-4 text-xl font-bold text-gray-900">
                {selectedNode.label}
              </h2>
              <div className="text-sm text-gray-500">
                {connectedEntries.length} related entries
              </div>
              <div className="mt-4 space-y-3">
                {connectedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-gray-100 p-3"
                  >
                    <div
                      className="mb-1 text-xs font-medium uppercase"
                      style={{
                        color: CATEGORY_COLORS[entry.category] || '#6b7280',
                      }}
                    >
                      {entry.category.replace('_', ' ')}
                    </div>
                    <p className="text-sm text-gray-700">{entry.content}</p>
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
              <p className="mb-4 text-sm leading-relaxed text-gray-800">
                {selectedEntry.content}
              </p>
              {selectedEntry.tags && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {selectedEntry.tags.split(',').map((tag: string) => (
                    <span
                      key={tag}
                      className="rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-medium text-blue-600"
                    >
                      {tag.trim()}
                    </span>
                  ))}
                </div>
              )}
              <div className="text-xs text-gray-400">
                Added {new Date(selectedEntry.createdAt).toLocaleDateString()}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
