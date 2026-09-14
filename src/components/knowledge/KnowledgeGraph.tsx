'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { useTheme } from 'next-themes';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownContent } from '@/components/shared/MarkdownContent';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDateTime } from '@/lib/format-date';
import { cn } from '@/lib/utils';

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

// Category swatches are data-driven colour coding for the canvas and the
// legend dots, not decorative chrome — they stay as literal colour values
// rather than Tailwind palette classes.
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

/** Pluralizes a count + noun pair, e.g. `pluralize(1, 'page')` → "1 page". */
function pluralize(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * A category label rendered as a Badge tinted with that category's
 * data-driven colour, instead of raw uppercase coloured text.
 */
function CategoryBadge({ category, className }: { category: string; className?: string }) {
  const color = CATEGORY_COLORS[category] || '#6b7280';
  return (
    <Badge
      className={className}
      style={{ backgroundColor: `${color}1a`, color }}
    >
      {CATEGORY_LABELS[category] || category.replace('_', ' ')}
    </Badge>
  );
}

/** Measures `ref`'s content box with a ResizeObserver, guarding a zero-size first paint. */
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();

    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

export default function KnowledgeGraph() {
  const [allGraphData, setAllGraphData] = useState<GraphData>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());
  const [availableCategories, setAvailableCategories] = useState<string[]>([]);
  const { resolvedTheme: theme } = useTheme();
  const graphRef = useRef<ForceGraphMethods<GraphNode> | undefined>(undefined);
  const { ref: containerRef, size } = useElementSize<HTMLDivElement>();

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

  const entryCount = graphData.nodes.filter((n) => n.type === 'entry').length;
  const topicCount = graphData.nodes.filter((n) => n.type === 'topic').length;
  const canMeasure = size.width > 0 && size.height > 0;

  return (
    <div className="relative h-full min-h-0">
      <div ref={containerRef} className="relative h-full min-h-0 bg-background">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg bg-card px-3 py-2 text-sm text-muted-foreground shadow-xs ring-1 ring-border">
          {pluralize(entryCount, 'page')}, {pluralize(topicCount, 'topic')}
        </div>

        {availableCategories.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 flex flex-wrap gap-1 rounded-lg bg-card p-2 shadow-xs ring-1 ring-border">
            {availableCategories.map((cat) => {
              const hidden = hiddenCategories.has(cat);
              return (
                <Button
                  key={cat}
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-pressed={!hidden}
                  onClick={() => toggleCategory(cat)}
                  className={cn('gap-1.5', hidden && 'opacity-40')}
                >
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: CATEGORY_COLORS[cat] || '#6b7280' }}
                  />
                  {CATEGORY_LABELS[cat] || cat.replace('_', ' ')}
                </Button>
              );
            })}
          </div>
        )}

        {graphData.nodes.length > 0 ? (
          canMeasure ? (
            <ForceGraph2D
              ref={graphRef}
              width={size.width}
              height={size.height}
              graphData={graphData}
              nodeCanvasObject={nodeCanvasObject}
              onNodeClick={handleNodeClick}
              linkColor={() => (theme === 'dark' ? '#4b5563' : '#d1d5db')}
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
            <Skeleton className="size-full rounded-none" aria-hidden />
          )
        ) : (
          <EmptyState
            className="h-full"
            title="No knowledge entries yet"
            description="Start asking questions in the chat — Claude will build the knowledge map automatically"
          />
        )}
      </div>

      {selectedNode && (
        <div className="absolute inset-0 z-20 flex w-full flex-col border-border bg-card shadow-lg sm:inset-y-0 sm:right-0 sm:left-auto sm:w-96 sm:border-l">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
            {selectedNode.type === 'topic' ? (
              <Badge variant="outline">Topic</Badge>
            ) : selectedEntry ? (
              <CategoryBadge category={selectedEntry.category} />
            ) : (
              <span />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setSelectedNode(null)}
              aria-label="Close panel"
            >
              <X />
            </Button>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-4 p-4">
              {selectedNode.type === 'topic' ? (
                <>
                  <div>
                    <h2 className="text-xl font-bold text-foreground">{selectedNode.label}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {connectedEntries.length} related {connectedEntries.length === 1 ? 'entry' : 'entries'}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {connectedEntries.map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-border p-3">
                        <CategoryBadge category={entry.category} className="mb-2" />
                        {entry.subject && (
                          <div className="mb-1 text-sm font-semibold text-foreground">{entry.subject}</div>
                        )}
                        <MarkdownContent content={entry.content} density="compact" />
                      </div>
                    ))}
                  </div>
                </>
              ) : selectedEntry ? (
                <>
                  {selectedEntry.subject && (
                    <h2 className="text-lg font-bold text-foreground">{selectedEntry.subject}</h2>
                  )}
                  <MarkdownContent content={selectedEntry.content} density="compact" />
                  {selectedEntry.tags && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEntry.tags.split(',').map((tag: string) => (
                        <Badge key={tag} variant="secondary">
                          {tag.trim()}
                        </Badge>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          </ScrollArea>

          {selectedNode.type === 'entry' && selectedEntry && (
            <div className="shrink-0 border-t border-border px-4 py-3 text-xs text-muted-foreground">
              Updated {formatDateTime(selectedEntry.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
