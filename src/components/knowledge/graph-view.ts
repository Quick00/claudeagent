/**
 * Pure helpers behind the knowledge map's rendering rules. Kept free of
 * React and canvas so the fold, label and highlight decisions can be unit
 * tested without a graph library.
 */

export interface GraphNode {
  id: string;
  label: string;
  category: string;
  type: 'entry' | 'topic';
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

/** Zoom scale from which mid-density labels appear. */
export const MID_ZOOM = 1.5;
/** Zoom scale from which every node, pages included, gets a label. */
export const CLOSE_ZOOM = 3;
/** Topics with at least this many pages are labelled at mid zoom. */
export const MID_ZOOM_MIN_DEGREE = 3;
/** How many topics keep their label when zoomed all the way out. */
export const OVERVIEW_LABEL_COUNT = 40;

/** react-force-graph mutates link endpoints from ids into node objects once the simulation runs. */
export function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

/** Number of links touching each node id. */
export function computeDegrees(links: GraphLink[]): Map<string, number> {
  const degrees = new Map<string, number>();
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    degrees.set(source, (degrees.get(source) ?? 0) + 1);
    degrees.set(target, (degrees.get(target) ?? 0) + 1);
  }
  return degrees;
}

/**
 * Drops topics that only one page uses, together with their links. Pages
 * always stay. Returns the same object when nothing needed folding so
 * memoised consumers keep referential equality.
 */
export function foldSingleUseTopics(data: GraphData): { data: GraphData; hiddenCount: number } {
  const degrees = computeDegrees(data.links);
  const folded = new Set<string>();
  for (const node of data.nodes) {
    if (node.type === 'topic' && (degrees.get(node.id) ?? 0) <= 1) folded.add(node.id);
  }
  if (folded.size === 0) return { data, hiddenCount: 0 };

  return {
    data: {
      nodes: data.nodes.filter((n) => !folded.has(n.id)),
      links: data.links.filter((l) => !folded.has(endpointId(l.source)) && !folded.has(endpointId(l.target))),
    },
    hiddenCount: folded.size,
  };
}

/**
 * The degree of the `limit`-th most connected topic, so that labelling
 * topics at or above it shows roughly `limit` labels. Zero when there are
 * fewer topics than the limit.
 */
export function topicDegreeCutoff(nodes: GraphNode[], degrees: Map<string, number>, limit: number): number {
  const topicDegrees = nodes
    .filter((n) => n.type === 'topic')
    .map((n) => degrees.get(n.id) ?? 0)
    .sort((a, b) => b - a);
  if (topicDegrees.length < limit) return 0;
  return topicDegrees[limit - 1];
}

export interface LabelContext {
  degree: number;
  /** Current canvas zoom scale as reported by the graph renderer. */
  scale: number;
  /** Result of `topicDegreeCutoff` for the visible graph. */
  cutoff: number;
  /** Selected node or one of its neighbours. */
  highlighted: boolean;
}

/** Whether a node's label is drawn at the current zoom level. */
export function shouldLabelNode(node: GraphNode, ctx: LabelContext): boolean {
  if (ctx.highlighted) return true;
  if (ctx.scale >= CLOSE_ZOOM) return true;
  if (node.type !== 'topic') return false;
  if (ctx.scale >= MID_ZOOM) return ctx.degree >= MID_ZOOM_MIN_DEGREE;
  return ctx.degree >= ctx.cutoff;
}

/** The selected node plus every node it links to. Empty when nothing is selected. */
export function neighbourhoodOf(selectedId: string | null, links: GraphLink[]): Set<string> {
  const ids = new Set<string>();
  if (!selectedId) return ids;
  ids.add(selectedId);
  for (const link of links) {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    if (source === selectedId) ids.add(target);
    else if (target === selectedId) ids.add(source);
  }
  return ids;
}
