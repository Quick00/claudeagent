import { describe, expect, test } from '@jest/globals';
import {
  computeDegrees,
  foldSingleUseTopics,
  neighbourhoodOf,
  shouldLabelNode,
  topicDegreeCutoff,
  type GraphData,
  type GraphNode,
} from '../graph-view';

const entry = (id: string): GraphNode => ({ id, label: id, category: 'process', type: 'entry' });
const topic = (tag: string): GraphNode => ({ id: `topic:${tag}`, label: tag, category: 'topic', type: 'topic' });

const sample: GraphData = {
  nodes: [entry('e1'), entry('e2'), entry('e3'), topic('shared'), topic('lonely'), topic('other')],
  links: [
    { source: 'e1', target: 'topic:shared' },
    { source: 'e2', target: 'topic:shared' },
    { source: 'e3', target: 'topic:other' },
    { source: 'e1', target: 'topic:other' },
    { source: 'e2', target: 'topic:lonely' },
  ],
};

describe('computeDegrees', () => {
  test('counts links touching each node', () => {
    const degrees = computeDegrees(sample.links);
    expect(degrees.get('topic:shared')).toBe(2);
    expect(degrees.get('topic:lonely')).toBe(1);
    expect(degrees.get('e1')).toBe(2);
  });

  test('accepts links whose endpoints have been resolved to node objects', () => {
    const degrees = computeDegrees([{ source: entry('e1'), target: topic('t') }]);
    expect(degrees.get('e1')).toBe(1);
    expect(degrees.get('topic:t')).toBe(1);
  });
});

describe('foldSingleUseTopics', () => {
  test('removes topics linked to only one page, and their links', () => {
    const { data, hiddenCount } = foldSingleUseTopics(sample);
    expect(data.nodes.map((n) => n.id)).toEqual(['e1', 'e2', 'e3', 'topic:shared', 'topic:other']);
    expect(data.links).toHaveLength(4);
    expect(data.links.some((l) => l.target === 'topic:lonely')).toBe(false);
    expect(hiddenCount).toBe(1);
  });

  test('keeps every page even when its only topic was folded', () => {
    const only: GraphData = {
      nodes: [entry('e1'), topic('solo')],
      links: [{ source: 'e1', target: 'topic:solo' }],
    };
    const { data } = foldSingleUseTopics(only);
    expect(data.nodes.map((n) => n.id)).toEqual(['e1']);
    expect(data.links).toEqual([]);
  });

  test('returns the input untouched when nothing is single-use', () => {
    const dense: GraphData = {
      nodes: [entry('e1'), entry('e2'), topic('t')],
      links: [
        { source: 'e1', target: 'topic:t' },
        { source: 'e2', target: 'topic:t' },
      ],
    };
    const { data, hiddenCount } = foldSingleUseTopics(dense);
    expect(data).toBe(dense);
    expect(hiddenCount).toBe(0);
  });
});

describe('topicDegreeCutoff', () => {
  test('returns the degree of the Nth most connected topic', () => {
    const nodes = ['a', 'b', 'c', 'd'].map(topic);
    const degrees = new Map([
      ['topic:a', 10],
      ['topic:b', 7],
      ['topic:c', 4],
      ['topic:d', 1],
    ]);
    expect(topicDegreeCutoff(nodes, degrees, 2)).toBe(7);
  });

  test('is zero when there are fewer topics than the limit, so all are labelled', () => {
    const nodes = [topic('a')];
    expect(topicDegreeCutoff(nodes, new Map([['topic:a', 3]]), 40)).toBe(0);
  });

  test('ignores page nodes', () => {
    const nodes = [entry('e1'), topic('a')];
    const degrees = new Map([
      ['e1', 99],
      ['topic:a', 2],
    ]);
    expect(topicDegreeCutoff(nodes, degrees, 1)).toBe(2);
  });
});

describe('shouldLabelNode', () => {
  const t = topic('x');
  const e = entry('e1');

  test('zoomed out, labels only topics at or above the top-N cutoff', () => {
    expect(shouldLabelNode(t, { degree: 12, scale: 1, cutoff: 12, highlighted: false })).toBe(true);
    expect(shouldLabelNode(t, { degree: 11, scale: 1, cutoff: 12, highlighted: false })).toBe(false);
  });

  test('zoomed out, never labels pages', () => {
    expect(shouldLabelNode(e, { degree: 50, scale: 1, cutoff: 0, highlighted: false })).toBe(false);
  });

  test('at mid zoom, labels topics with three or more pages', () => {
    expect(shouldLabelNode(t, { degree: 3, scale: 2, cutoff: 40, highlighted: false })).toBe(true);
    expect(shouldLabelNode(t, { degree: 2, scale: 2, cutoff: 40, highlighted: false })).toBe(false);
    expect(shouldLabelNode(e, { degree: 2, scale: 2, cutoff: 40, highlighted: false })).toBe(false);
  });

  test('zoomed in, labels everything including pages', () => {
    expect(shouldLabelNode(t, { degree: 1, scale: 3.5, cutoff: 40, highlighted: false })).toBe(true);
    expect(shouldLabelNode(e, { degree: 1, scale: 3.5, cutoff: 40, highlighted: false })).toBe(true);
  });

  test('always labels highlighted nodes regardless of zoom', () => {
    expect(shouldLabelNode(e, { degree: 1, scale: 0.5, cutoff: 40, highlighted: true })).toBe(true);
  });
});

describe('neighbourhoodOf', () => {
  test('returns the node and everything directly linked to it', () => {
    const ids = neighbourhoodOf('topic:shared', sample.links);
    expect([...ids].sort()).toEqual(['e1', 'e2', 'topic:shared']);
  });

  test('is empty when nothing is selected', () => {
    expect(neighbourhoodOf(null, sample.links).size).toBe(0);
  });
});
