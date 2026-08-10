// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type { BlueprintNode, BlueprintEdge } from '@/types/blueprint';
import {
  buildAdjacency,
  detectCycles,
  topologicalSort,
  getUpstreamNodes,
  getDownstreamNodes,
  getUpstreamSubgraph,
  getDownstreamSubgraph,
  scheduleLevels,
  scheduleGraph,
} from '../dag-traversal';

// ── Test helpers ──────────────────────────────────────────────────────────

function makeNode(id: string, nodeType: BlueprintNode['data']['nodeType'] = 'text-input'): BlueprintNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: `${nodeType} (${id})`,
      config: {},
    },
  } as BlueprintNode;
}

function makeEdge(id: string, source: string, target: string): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'out',
    targetHandle: 'in',
    data: { dataType: 'text' },
  } as BlueprintEdge;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('dag-traversal', () => {
  // ── buildAdjacency ─────────────────────────────────────────────

  describe('buildAdjacency', () => {
    it('builds forward and reverse maps for a linear chain', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

      const { forward, reverse } = buildAdjacency(nodes, edges);

      expect(forward.get('a')).toEqual(['b']);
      expect(forward.get('b')).toEqual(['c']);
      expect(forward.get('c')).toEqual([]);

      expect(reverse.get('a')).toEqual([]);
      expect(reverse.get('b')).toEqual(['a']);
      expect(reverse.get('c')).toEqual(['b']);
    });

    it('skips self-loops and edges with missing nodes', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [
        makeEdge('e1', 'a', 'a'), // self-loop
        makeEdge('e2', 'a', 'x'), // missing target
        makeEdge('e3', 'a', 'b'), // valid
      ];

      const { forward } = buildAdjacency(nodes, edges);
      expect(forward.get('a')).toEqual(['b']);
      expect(forward.get('b')).toEqual([]);
    });

    it('handles empty graph', () => {
      const { forward, reverse, nodeIds } = buildAdjacency([], []);
      expect(nodeIds.size).toBe(0);
      expect(forward.size).toBe(0);
      expect(reverse.size).toBe(0);
    });
  });

  // ── detectCycles ───────────────────────────────────────────────

  describe('detectCycles', () => {
    it('returns empty array for an acyclic graph', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

      expect(detectCycles(nodes, edges)).toEqual([]);
    });

    it('returns empty array for empty graph', () => {
      expect(detectCycles([], [])).toEqual([]);
    });

    it('detects a two-node cycle', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')];

      const cycle = detectCycles(nodes, edges);
      expect(cycle).toEqual(expect.arrayContaining(['a', 'b']));
      expect(cycle).toHaveLength(2);
    });

    it('detects a three-node cycle', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'a'),
      ];

      const cycle = detectCycles(nodes, edges);
      expect(cycle).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(cycle).toHaveLength(3);
    });

    it('detects cycle within a larger DAG (downstream of cycle is also unreachable)', () => {
      // a→b→c→d, c→b (cycle b↔c)
      // d is downstream of the cycle so it's also unreachable in Kahn's
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
        makeEdge('e4', 'c', 'b'), // creates cycle
      ];

      const cycle = detectCycles(nodes, edges);
      expect(cycle).toEqual(expect.arrayContaining(['b', 'c', 'd']));
      expect(cycle).not.toContain('a');
    });

    it('ignores self-loops in cycle detection', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [
        makeEdge('e1', 'a', 'a'), // self-loop (excluded)
        makeEdge('e2', 'a', 'b'),
      ];

      expect(detectCycles(nodes, edges)).toEqual([]);
    });
  });

  // ── topologicalSort ────────────────────────────────────────────

  describe('topologicalSort', () => {
    it('returns empty order for empty graph', () => {
      const result = topologicalSort([], []);
      expect(result.hasCycle).toBe(false);
      expect(result.levels).toEqual([]);
      expect(result.ordered).toEqual([]);
    });

    it('orders independent nodes as level 0', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const result = topologicalSort(nodes, []);

      expect(result.hasCycle).toBe(false);
      expect(result.levels).toHaveLength(1);
      expect(result.levels[0].nodeIds).toEqual(['a', 'b', 'c']);
      expect(result.ordered).toEqual(['a', 'b', 'c']);
    });

    it('produces correct levels for a linear chain a→b→c', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

      const result = topologicalSort(nodes, edges);

      expect(result.hasCycle).toBe(false);
      expect(result.levels).toHaveLength(3);
      expect(result.levels[0].nodeIds).toEqual(['a']);
      expect(result.levels[1].nodeIds).toEqual(['b']);
      expect(result.levels[2].nodeIds).toEqual(['c']);
      expect(result.ordered).toEqual(['a', 'b', 'c']);
    });

    it('groups parallel nodes into the same level', () => {
      // a→c, b→c (both a and b are independent roots)
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'c'), makeEdge('e2', 'b', 'c')];

      const result = topologicalSort(nodes, edges);

      expect(result.hasCycle).toBe(false);
      expect(result.levels).toHaveLength(2);
      expect(result.levels[0].nodeIds).toEqual(['a', 'b']);
      expect(result.levels[1].nodeIds).toEqual(['c']);
    });

    it('produces correct levels for a diamond graph', () => {
      // a→b, a→c, b→d, c→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'd'),
        makeEdge('e4', 'c', 'd'),
      ];

      const result = topologicalSort(nodes, edges);

      expect(result.hasCycle).toBe(false);
      expect(result.levels).toHaveLength(3);
      expect(result.levels[0].nodeIds).toEqual(['a']);
      expect(result.levels[1].nodeIds).toEqual(['b', 'c']);
      expect(result.levels[2].nodeIds).toEqual(['d']);
    });

    it('returns cycle info when a cycle exists', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')];

      const result = topologicalSort(nodes, edges);

      expect(result.hasCycle).toBe(true);
      expect(result.cycleNodes).toEqual(expect.arrayContaining(['a', 'b']));
      expect(result.levels).toEqual([]);
      expect(result.ordered).toEqual([]);
    });

    it('ensures deterministic order (lexicographic within levels)', () => {
      // Run 10 times and verify same result
      const nodes = [makeNode('z'), makeNode('a'), makeNode('m')];
      const edges = [makeEdge('e1', 'a', 'm'), makeEdge('e2', 'z', 'm')];

      const results = Array.from({ length: 10 }, () => topologicalSort(nodes, edges));
      const first = JSON.stringify(results[0]);
      for (const result of results) {
        expect(JSON.stringify(result)).toBe(first);
      }
    });
  });

  // ── getUpstreamNodes ───────────────────────────────────────────

  describe('getUpstreamNodes', () => {
    it('returns empty for a root node', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];

      expect(getUpstreamNodes('a', nodes, edges)).toEqual([]);
    });

    it('returns all ancestors transitively', () => {
      // a→b→c→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
      ];

      const upstream = getUpstreamNodes('d', nodes, edges);
      expect(upstream).toEqual(['a', 'b', 'c']);
    });

    it('returns empty for nonexistent node', () => {
      const nodes = [makeNode('a')];
      expect(getUpstreamNodes('nonexistent', nodes, [])).toEqual([]);
    });

    it('collects upstream from multiple parents', () => {
      // a→c, b→c, a→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'c'),
        makeEdge('e2', 'b', 'c'),
      ];

      const upstream = getUpstreamNodes('c', nodes, edges);
      expect(upstream).toEqual(['a', 'b']);
    });
  });

  // ── getDownstreamNodes ─────────────────────────────────────────

  describe('getDownstreamNodes', () => {
    it('returns empty for a leaf node', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];

      expect(getDownstreamNodes('b', nodes, edges)).toEqual([]);
    });

    it('returns all descendants transitively', () => {
      // a→b→c→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
      ];

      const downstream = getDownstreamNodes('a', nodes, edges);
      expect(downstream).toEqual(['b', 'c', 'd']);
    });

    it('returns empty for nonexistent node', () => {
      const nodes = [makeNode('a')];
      expect(getDownstreamNodes('nonexistent', nodes, [])).toEqual([]);
    });

    it('collects downstream to multiple children', () => {
      // a→b, a→c
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'a', 'c')];

      const downstream = getDownstreamNodes('a', nodes, edges);
      expect(downstream).toEqual(['b', 'c']);
    });
  });

  // ── getUpstreamSubgraph ────────────────────────────────────────

  describe('getUpstreamSubgraph', () => {
    it('returns null for nonexistent node', () => {
      const nodes = [makeNode('a')];
      expect(getUpstreamSubgraph('x', nodes, [])).toBeNull();
    });

    it('returns subgraph with only the target node for a root', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];

      const sub = getUpstreamSubgraph('a', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.nodeIds).toEqual(['a']);
      expect(sub!.edgeIds).toEqual([]);
      expect(sub!.levels).toHaveLength(1);
      expect(sub!.levels[0].nodeIds).toEqual(['a']);
    });

    it('includes all ancestors and only connecting edges', () => {
      // a→b→c→d, and extra edge x→y (not connected)
      const nodes = [
        makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d'),
        makeNode('x'), makeNode('y'),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
        makeEdge('e4', 'x', 'y'),
      ];

      const sub = getUpstreamSubgraph('c', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.nodeIds).toEqual(expect.arrayContaining(['a', 'b', 'c']));
      expect(sub!.nodeIds).not.toContain('d');
      expect(sub!.nodeIds).not.toContain('x');
      expect(sub!.edgeIds).toEqual(expect.arrayContaining(['e1', 'e2']));
      expect(sub!.edgeIds).not.toContain('e3');
      expect(sub!.edgeIds).not.toContain('e4');
    });

    it('preserves topological levels within the subgraph', () => {
      // a→c, b→c (diamond-like)
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'c'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
      ];

      const sub = getUpstreamSubgraph('c', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.levels).toHaveLength(2);
      expect(sub!.levels[0].nodeIds).toEqual(['a', 'b']);
      expect(sub!.levels[1].nodeIds).toEqual(['c']);
    });
  });

  // ── getDownstreamSubgraph ──────────────────────────────────────

  describe('getDownstreamSubgraph', () => {
    it('returns null for nonexistent node', () => {
      const nodes = [makeNode('a')];
      expect(getDownstreamSubgraph('x', nodes, [])).toBeNull();
    });

    it('returns subgraph with only the target node for a leaf', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b')];

      const sub = getDownstreamSubgraph('b', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.nodeIds).toEqual(['b']);
      expect(sub!.edgeIds).toEqual([]);
    });

    it('includes all descendants and only connecting edges', () => {
      const nodes = [
        makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d'),
        makeNode('x'), makeNode('y'),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
        makeEdge('e3', 'c', 'd'),
        makeEdge('e4', 'x', 'y'),
      ];

      const sub = getDownstreamSubgraph('a', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.nodeIds).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd']));
      expect(sub!.nodeIds).not.toContain('x');
      expect(sub!.edgeIds).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']));
      expect(sub!.edgeIds).not.toContain('e4');
    });

    it('preserves topological levels within the subgraph', () => {
      // a→b, a→c, b→d, c→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d'), makeNode('x')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'd'),
        makeEdge('e4', 'c', 'd'),
      ];

      const sub = getDownstreamSubgraph('a', nodes, edges);
      expect(sub).not.toBeNull();
      expect(sub!.levels).toHaveLength(3);
      expect(sub!.levels[0].nodeIds).toEqual(['a']);
      expect(sub!.levels[1].nodeIds).toEqual(['b', 'c']);
      expect(sub!.levels[2].nodeIds).toEqual(['d']);
    });
  });

  // ── scheduleLevels ─────────────────────────────────────────────

  describe('scheduleLevels', () => {
    it('returns empty for a cyclic order', () => {
      const order = { levels: [], ordered: [], hasCycle: true, cycleNodes: ['a'] };
      expect(scheduleLevels(order)).toEqual([]);
    });

    it('splits a large level into batches by concurrency limit', () => {
      const order = {
        levels: [{ nodeIds: ['a', 'b', 'c', 'd', 'e'] }],
        ordered: ['a', 'b', 'c', 'd', 'e'],
        hasCycle: false,
        cycleNodes: [],
      };

      const result = scheduleLevels(order, { concurrencyLimit: 2 });
      expect(result).toHaveLength(1);
      expect(result[0].batches).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
    });

    it('uses default concurrency limit of 4', () => {
      const order = {
        levels: [{ nodeIds: ['a', 'b', 'c', 'd', 'e'] }],
        ordered: ['a', 'b', 'c', 'd', 'e'],
        hasCycle: false,
        cycleNodes: [],
      };

      const result = scheduleLevels(order);
      expect(result).toHaveLength(1);
      expect(result[0].batches).toEqual([['a', 'b', 'c', 'd'], ['e']]);
    });

    it('produces one batch when level size ≤ limit', () => {
      const order = {
        levels: [{ nodeIds: ['a', 'b'] }],
        ordered: ['a', 'b'],
        hasCycle: false,
        cycleNodes: [],
      };

      const result = scheduleLevels(order, { concurrencyLimit: 4 });
      expect(result).toHaveLength(1);
      expect(result[0].batches).toEqual([['a', 'b']]);
    });

    it('handles multiple levels', () => {
      const order = {
        levels: [
          { nodeIds: ['a', 'b'] },
          { nodeIds: ['c', 'd', 'e', 'f', 'g'] },
          { nodeIds: ['h'] },
        ],
        ordered: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        hasCycle: false,
        cycleNodes: [],
      };

      const result = scheduleLevels(order, { concurrencyLimit: 3 });
      expect(result).toHaveLength(3);
      expect(result[0].batches).toEqual([['a', 'b']]);
      expect(result[1].batches).toEqual([['c', 'd', 'e'], ['f', 'g']]);
      expect(result[2].batches).toEqual([['h']]);
    });
  });

  // ── scheduleGraph ──────────────────────────────────────────────

  describe('scheduleGraph', () => {
    it('returns null for a cyclic graph', () => {
      const nodes = [makeNode('a'), makeNode('b')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'a')];

      expect(scheduleGraph(nodes, edges)).toBeNull();
    });

    it('schedules a linear chain into sequential levels', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
      const edges = [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')];

      const result = scheduleGraph(nodes, edges);
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(3);
      expect(result![0].batches).toEqual([['a']]);
      expect(result![1].batches).toEqual([['b']]);
      expect(result![2].batches).toEqual([['c']]);
    });

    it('schedules a diamond graph correctly', () => {
      // a→b, a→c, b→d, c→d
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'd'),
        makeEdge('e4', 'c', 'd'),
      ];

      const result = scheduleGraph(nodes, edges, { concurrencyLimit: 2 });
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(3);
      expect(result![0].batches).toEqual([['a']]);
      expect(result![1].batches).toEqual([['b', 'c']]);
      expect(result![2].batches).toEqual([['d']]);
    });

    it('returns single level for independent nodes', () => {
      const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];

      const result = scheduleGraph(nodes, []);
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(1);
      expect(result![0].batches).toEqual([['a', 'b', 'c']]);
    });

    it('returns empty array for empty graph', () => {
      const result = scheduleGraph([], []);
      expect(result).not.toBeNull();
      expect(result!).toHaveLength(0);
    });
  });
});
