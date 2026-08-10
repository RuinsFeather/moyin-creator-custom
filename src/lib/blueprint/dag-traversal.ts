// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import type { BlueprintNode, BlueprintEdge } from '@/types/blueprint';

// ── Types ─────────────────────────────────────────────────────────────────

/** A single level of the topological ordering (nodes that can run in parallel). */
export interface TopologicalLevel {
  /** IDs of nodes at this level, sorted lexicographically for determinism. */
  nodeIds: string[];
}

/** Full topological ordering result. */
export interface TopologicalOrder {
  /** Ordered levels; level 0 has no upstream dependencies. */
  levels: TopologicalLevel[];
  /** Flat list of all node IDs in topological order. */
  ordered: string[];
  /** True when the graph contains a cycle. */
  hasCycle: boolean;
  /** IDs of nodes involved in the cycle (empty when `hasCycle` is false). */
  cycleNodes: string[];
}

/** Subgraph extracted for targeted execution. */
export interface Subgraph {
  /** Node IDs included in this subgraph. */
  nodeIds: string[];
  /** Edge IDs included in this subgraph. */
  edgeIds: string[];
  /** Topological levels within the subgraph. */
  levels: TopologicalLevel[];
}

// ── Adjacency builders ────────────────────────────────────────────────────

/** Build forward (source→target) and reverse (target→source) adjacency maps. */
export function buildAdjacency(
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): {
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
  nodeIds: Set<string>;
} {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const id of nodeIds) {
    forward.set(id, []);
    reverse.set(id, []);
  }

  for (const edge of edges) {
    // Skip edges that reference non-existent nodes or self-loops
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (edge.source === edge.target) continue;

    forward.get(edge.source)!.push(edge.target);
    reverse.get(edge.target)!.push(edge.source);
  }

  // Sort neighbor lists for deterministic traversal
  for (const neighbors of forward.values()) neighbors.sort();
  for (const neighbors of reverse.values()) neighbors.sort();

  return { forward, reverse, nodeIds };
}

// ── Cycle detection ───────────────────────────────────────────────────────

/**
 * Detect cycles using Kahn's algorithm. Returns the set of node IDs
 * involved in cycles (empty when the graph is acyclic).
 */
export function detectCycles(
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): string[] {
  const { forward, nodeIds } = buildAdjacency(nodes, edges);

  // Compute in-degree for each node
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) inDegree.set(id, 0);
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  // Seed queue with zero in-degree nodes (sorted for determinism)
  const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0).sort();
  const processed = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    processed.add(current);
    for (const neighbor of forward.get(current) ?? []) {
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) {
        // Insert in sorted position for deterministic order
        const insertIdx = queue.findIndex((q) => q > neighbor);
        if (insertIdx === -1) queue.push(neighbor);
        else queue.splice(insertIdx, 0, neighbor);
      }
    }
  }

  // Nodes not processed are in cycles
  return [...nodeIds].filter((id) => !processed.has(id)).sort();
}

// ── Topological sort ──────────────────────────────────────────────────────

/**
 * Compute a deterministic topological ordering by levels.
 *
 * Nodes within each level have no dependencies on each other and can be
 * executed in parallel. Nodes are sorted lexicographically within each
 * level to guarantee deterministic order.
 */
export function topologicalSort(
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): TopologicalOrder {
  const { forward, nodeIds } = buildAdjacency(nodes, edges);

  // Check for cycles first
  const cycleNodes = detectCycles(nodes, edges);
  if (cycleNodes.length > 0) {
    return {
      levels: [],
      ordered: [],
      hasCycle: true,
      cycleNodes,
    };
  }

  // Kahn's algorithm with level tracking
  const inDegree = new Map<string, number>();
  for (const id of nodeIds) inDegree.set(id, 0);
  for (const edge of edges) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target) && edge.source !== edge.target) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const levels: TopologicalLevel[] = [];
  const ordered: string[] = [];
  const processed = new Set<string>();

  // Start with all zero in-degree nodes (sorted)
  let currentLevel = [...nodeIds].filter((id) => inDegree.get(id) === 0).sort();

  while (currentLevel.length > 0) {
    levels.push({ nodeIds: [...currentLevel] });
    ordered.push(...currentLevel);

    const nextLevel: string[] = [];
    for (const current of currentLevel) {
      processed.add(current);
      for (const neighbor of forward.get(current) ?? []) {
        const deg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, deg);
        if (deg === 0) nextLevel.push(neighbor);
      }
    }
    nextLevel.sort();
    currentLevel = nextLevel;
  }

  return { levels, ordered, hasCycle: false, cycleNodes: [] };
}

// ── Upstream / downstream queries ─────────────────────────────────────────

/**
 * Get all upstream (ancestor) node IDs for a given node.
 * Follows reverse adjacency (target→source) transitively.
 */
export function getUpstreamNodes(
  nodeId: string,
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): string[] {
  const { reverse, nodeIds } = buildAdjacency(nodes, edges);
  if (!nodeIds.has(nodeId)) return [];

  const visited = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const parent of reverse.get(current) ?? []) {
      if (!visited.has(parent)) {
        visited.add(parent);
        stack.push(parent);
      }
    }
  }

  return [...visited].sort();
}

/**
 * Get all downstream (descendant) node IDs for a given node.
 * Follows forward adjacency (source→target) transitively.
 */
export function getDownstreamNodes(
  nodeId: string,
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): string[] {
  const { forward, nodeIds } = buildAdjacency(nodes, edges);
  if (!nodeIds.has(nodeId)) return [];

  const visited = new Set<string>();
  const stack = [nodeId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const child of forward.get(current) ?? []) {
      if (!visited.has(child)) {
        visited.add(child);
        stack.push(child);
      }
    }
  }

  return [...visited].sort();
}

// ── Subgraph extraction ───────────────────────────────────────────────────

/**
 * Extract the subgraph for running a single node.
 * Includes the target node and all its upstream ancestors.
 * Returns the subgraph with topological levels for execution ordering.
 */
export function getUpstreamSubgraph(
  nodeId: string,
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): Subgraph | null {
  const { nodeIds } = buildAdjacency(nodes, edges);
  if (!nodeIds.has(nodeId)) return null;

  const ancestors = getUpstreamNodes(nodeId, nodes, edges);
  const subgraphNodeIds = new Set([nodeId, ...ancestors]);

  // Filter edges to only those within the subgraph
  const subgraphEdges = edges.filter(
    (e) => subgraphNodeIds.has(e.source) && subgraphNodeIds.has(e.target),
  );

  // Extract subgraph nodes in the original order
  const subgraphNodes = nodes.filter((n) => subgraphNodeIds.has(n.id));

  // Compute topological order within the subgraph
  const topo = topologicalSort(subgraphNodes, subgraphEdges);

  return {
    nodeIds: [...subgraphNodeIds],
    edgeIds: subgraphEdges.map((e) => e.id),
    levels: topo.levels,
  };
}

/**
 * Extract the subgraph for running a node and all its downstream nodes.
 * Includes the target node and all its downstream descendants.
 * Returns the subgraph with topological levels for execution ordering.
 */
export function getDownstreamSubgraph(
  nodeId: string,
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
): Subgraph | null {
  const { nodeIds } = buildAdjacency(nodes, edges);
  if (!nodeIds.has(nodeId)) return null;

  const descendants = getDownstreamNodes(nodeId, nodes, edges);
  const subgraphNodeIds = new Set([nodeId, ...descendants]);

  // Filter edges to only those within the subgraph
  const subgraphEdges = edges.filter(
    (e) => subgraphNodeIds.has(e.source) && subgraphNodeIds.has(e.target),
  );

  const subgraphNodes = nodes.filter((n) => subgraphNodeIds.has(n.id));

  const topo = topologicalSort(subgraphNodes, subgraphEdges);

  return {
    nodeIds: [...subgraphNodeIds],
    edgeIds: subgraphEdges.map((e) => e.id),
    levels: topo.levels,
  };
}

// ── Parallel scheduling ───────────────────────────────────────────────────

export interface ScheduleOptions {
  /** Maximum number of nodes to execute concurrently per level. Default: 4. */
  concurrencyLimit?: number;
}

export interface ScheduledLevel {
  /** Batches within this level, each batch respects the concurrency limit. */
  batches: string[][];
}

/**
 * Split topological levels into batches respecting a concurrency limit.
 * Each level is divided into sequential batches; nodes within a batch can
 * run in parallel. Nodes are sorted lexicographically within each batch
 * for determinism.
 */
export function scheduleLevels(
  order: TopologicalOrder,
  options?: ScheduleOptions,
): ScheduledLevel[] {
  if (order.hasCycle) return [];

  const limit = options?.concurrencyLimit ?? 4;

  return order.levels.map((level) => {
    const sorted = [...level.nodeIds].sort();
    const batches: string[][] = [];
    for (let i = 0; i < sorted.length; i += limit) {
      batches.push(sorted.slice(i, i + limit));
    }
    return { batches };
  });
}

/**
 * Full scheduling: build topological order, then split into concurrency-limited
 * batches. Returns null when the graph has a cycle.
 */
export function scheduleGraph(
  nodes: readonly BlueprintNode[],
  edges: readonly BlueprintEdge[],
  options?: ScheduleOptions,
): ScheduledLevel[] | null {
  const order = topologicalSort(nodes, edges);
  if (order.hasCycle) return null;
  return scheduleLevels(order, options);
}
