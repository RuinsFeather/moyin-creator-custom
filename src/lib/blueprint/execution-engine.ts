// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Execution Engine
//
// Orchestrates the execution of a blueprint graph:
// 1. Validates the graph.
// 2. Computes the target subgraph based on run mode.
// 3. Schedules nodes by dependency (topological levels + concurrency batches).
// 4. Executes each node, passing upstream outputs.
// 5. Reports progress, handles cancellation, and collects errors.
//
// The engine is store-aware: it reads from and writes to `useBlueprintStore`.
// It uses `node-executors.ts` for the actual node work.
//
// ── Generation Chain Boundary (§9.3) ─────────────────────────────────────
// This engine delegates all generation to node-executors.ts which uses
// Freedom API exclusively. Director, S-Class, and Storyboard-specific
// capabilities must NOT be added to this engine's scheduling logic.
// ─────────────────────────────────────────────────────────────────────────

import { generateUUID } from '@/lib/utils';
import type {
  BlueprintEdge,
  BlueprintNode,
  BlueprintNodeExecution,
  BlueprintProject,
} from '@/types/blueprint';
import { validateBlueprintGraph } from './graph-validation';
import { sanitizeErrorMessage, categorizeError } from './error-utils';
import {
  getUpstreamSubgraph,
  getDownstreamSubgraph,
  scheduleGraph,
  type ScheduledLevel,
} from './dag-traversal';
import {
  NODE_EXECUTORS,
  type NodeExecutorOutput,
} from './node-executors';

// ── Types ─────────────────────────────────────────────────────────────────

/** Callback to update a node's execution state (called by the engine). */
export type NodeExecutionUpdater = (
  nodeId: string,
  execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution>,
) => void;

/** Callback to update a node's progress (0–100). */
export type NodeProgressUpdater = (
  nodeId: string,
  progress: number,
) => void;

/** The overall result of a blueprint execution run. */
export interface BlueprintRunResult {
  /** Unique run identifier. */
  runId: string;
  /** Number of nodes that completed successfully. */
  completedCount: number;
  /** Number of nodes that failed. */
  failedCount: number;
  /** Number of nodes that were cancelled. */
  cancelledCount: number;
  /** Number of nodes that were blocked (upstream failure). */
  blockedCount: number;
  /** Node-level error messages (nodeLabel: message). */
  errorSummary: string[];
  /** Total elapsed time in milliseconds. */
  elapsed: number;
  /** True if the run was aborted by the user. */
  aborted: boolean;
}

/** Options for running a blueprint. */
export interface RunBlueprintOptions {
  /** The blueprint project to execute. */
  project: BlueprintProject;
  /** The run mode: all nodes, selected node + upstream, or downstream of node. */
  mode: 'all' | 'node' | 'downstream';
  /** Target node ID for 'node' or 'downstream' mode. */
  nodeId?: string;
  /** Caller-owned run ID. The bridge passes the store lock's run ID. */
  runId?: string;
  /** Maximum concurrency per level (default: 4). */
  concurrencyLimit?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Update a node's execution status. */
  onUpdateNode: NodeExecutionUpdater;
  /** Update a node's progress. */
  onProgress?: NodeProgressUpdater;
}

// ── Execution engine ──────────────────────────────────────────────────────

/**
 * Execute a blueprint graph. This is the main entry point.
 *
 * It validates the graph, computes the target subgraph, schedules nodes,
 * and executes them level by level, batch by batch.
 *
 * Each node is marked `queued` → `running` → `completed` / `failed` / `cancelled`.
 * If a node fails, its downstream nodes are marked `blocked`.
 *
 * The engine does NOT manage the store's `executionLock` / `currentRun` /
 * `abortController` — that is the caller's responsibility.
 */
export async function runBlueprint(
  options: RunBlueprintOptions,
): Promise<BlueprintRunResult> {
  const {
    project,
    mode,
    nodeId,
    runId: requestedRunId,
    concurrencyLimit = 4,
    signal,
    onUpdateNode,
    onProgress,
  } = options;

  const runId = requestedRunId ?? generateUUID();
  const startedAt = Date.now();
  const errorSummary: string[] = [];
  let completedCount = 0;
  let failedCount = 0;
  let cancelledCount = 0;
  let blockedCount = 0;

  const nodes = project.nodes;
  const edges = project.edges;

  // ── 1. Validate ────────────────────────────────────────────────

  const diagnostics = validateBlueprintGraph({ project });
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) {
    return {
      runId,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      blockedCount: 0,
      errorSummary: errors.map((e) => e.code + ': ' + e.message),
      elapsed: Date.now() - startedAt,
      aborted: false,
    };
  }

  // ── 2. Compute target subgraph ─────────────────────────────────

  let targetNodes: BlueprintNode[];
  let targetEdges: BlueprintEdge[];
  let scheduledLevels: ScheduledLevel[] | null;

  if (mode === 'all') {
    targetNodes = nodes;
    targetEdges = edges;
  } else if (!nodeId) {
    return {
      runId,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      blockedCount: 0,
      errorSummary: ['mode="node" 或 "downstream" 需要指定 nodeId'],
      elapsed: Date.now() - startedAt,
      aborted: false,
    };
  } else if (mode === 'node') {
    const subgraph = getUpstreamSubgraph(nodeId, nodes, edges);
    if (!subgraph) {
      return {
        runId,
        completedCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        blockedCount: 0,
        errorSummary: ['节点 ' + nodeId + ' 不存在'],
        elapsed: Date.now() - startedAt,
        aborted: false,
      };
    }
    targetNodes = nodes.filter((n) => subgraph.nodeIds.includes(n.id));
    targetEdges = edges.filter((e) => subgraph.edgeIds.includes(e.id));
  } else {
    const subgraph = getDownstreamSubgraph(nodeId, nodes, edges);
    if (!subgraph) {
      return {
        runId,
        completedCount: 0,
        failedCount: 0,
        cancelledCount: 0,
        blockedCount: 0,
        errorSummary: ['节点 ' + nodeId + ' 不存在'],
        elapsed: Date.now() - startedAt,
        aborted: false,
      };
    }
    targetNodes = nodes.filter((n) => subgraph.nodeIds.includes(n.id));
    targetEdges = edges.filter((e) => subgraph.edgeIds.includes(e.id));
  }

  // ── 3. Schedule ────────────────────────────────────────────────

  scheduledLevels = scheduleGraph(targetNodes, targetEdges, { concurrencyLimit });
  if (!scheduledLevels) {
    return {
      runId,
      completedCount: 0,
      failedCount: 0,
      cancelledCount: 0,
      blockedCount: 0,
      errorSummary: ['图中存在环，无法执行'],
      elapsed: Date.now() - startedAt,
      aborted: false,
    };
  }

  // ── 4. Build node map & upstream edge map ──────────────────────

  const nodeMap = new Map<string, BlueprintNode>();
  for (const node of targetNodes) nodeMap.set(node.id, node);

  const upstreamMap = new Map<string, string[]>();
  for (const node of targetNodes) upstreamMap.set(node.id, []);
  for (const edge of targetEdges) {
    if (nodeMap.has(edge.source) && nodeMap.has(edge.target)) {
      upstreamMap.get(edge.target)!.push(edge.source);
    }
  }
  // Sort upstream lists for determinism
  for (const list of upstreamMap.values()) list.sort();

  // ── 5. Execute level by level ──────────────────────────────────

  const outputs = new Map<string, NodeExecutorOutput>();
  const blocked = new Set<string>();
  let aborted = false;

  // Mark all target nodes as queued
  for (const node of targetNodes) {
    onUpdateNode(node.id, {
      status: 'queued',
      runId,
    });
  }

  try {
    for (const level of scheduledLevels) {
      for (const batch of level.batches) {
        if (signal?.aborted) {
          aborted = true;
          break;
        }

        // Filter out blocked nodes from the batch
        const executable = batch.filter((id) => !blocked.has(id));
        const blockedInBatch = batch.filter((id) => blocked.has(id));
        blockedCount += blockedInBatch.length;

        // Execute the batch in parallel
        const results = await Promise.allSettled(
          executable.map((id) =>
            executeNodeInBatch(
              id, runId, signal, nodeMap, upstreamMap,
              outputs, blocked, targetEdges, onUpdateNode, onProgress, project.projectId,
            ),
          ),
        );

        // Collect results
        for (let i = 0; i < executable.length; i++) {
          const id = executable[i];
          const result = results[i];
          const node = nodeMap.get(id)!;

          if (result.status === 'fulfilled') {
            outputs.set(id, result.value);
            completedCount++;
          } else {
            const reason = result.reason;
            const errMsg = reason instanceof Error ? reason.message : String(reason);
            const sanitizedMsg = sanitizeErrorMessage(errMsg);
            failedCount++;
            errorSummary.push(node.data.label + ': ' + sanitizedMsg);

            // Mark downstream as blocked
            markDownstreamBlocked(id, targetNodes, targetEdges, blocked, runId, onUpdateNode);
          }
        }
      }

      if (aborted) break;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    errorSummary.push('引擎错误: ' + sanitizeErrorMessage(errMsg));
  }

  // Handle abort: cancel remaining queued/running nodes
  if (aborted) {
    for (const node of targetNodes) {
      const exec = node.data.execution;
      if (exec?.runId === runId && ['queued', 'running'].includes(exec.status)) {
        onUpdateNode(node.id, {
          ...exec,
          status: 'cancelled',
          completedAt: Date.now(),
        });
        cancelledCount++;
      }
    }
  }

  return {
    runId,
    completedCount,
    failedCount,
    cancelledCount,
    blockedCount,
    errorSummary,
    elapsed: Date.now() - startedAt,
    aborted,
  };
}

// ── Metrics hook (P1-4) ───────────────────────────────────────────────────

/**
 * Wrap `runBlueprint` and record an execution metric on completion.
 * Used by the execution bridge; keeps telemetry out of the pure engine.
 */
export async function runBlueprintWithMetrics(
  options: RunBlueprintOptions,
): Promise<BlueprintRunResult> {
  const result = await runBlueprint(options);
  try {
    const { recordBlueprintRun } = await import('./execution-metrics');
    recordBlueprintRun({
      runId: result.runId,
      mode: options.mode,
      startedAt: Date.now() - result.elapsed,
      elapsedMs: result.elapsed,
      completed: result.completedCount,
      failed: result.failedCount,
      cancelled: result.cancelledCount,
      blocked: result.blockedCount,
      errorSummary: result.errorSummary,
    });
  } catch {
    // metrics must never break execution
  }
  return result;
}

// ── Single node execution ─────────────────────────────────────────────────

async function executeNodeInBatch(
  nodeId: string,
  runId: string,
  signal: AbortSignal | undefined,
  nodeMap: Map<string, BlueprintNode>,
  upstreamMap: Map<string, string[]>,
  outputs: Map<string, NodeExecutorOutput>,
  blocked: Set<string>,
  edges: BlueprintEdge[],
  onUpdateNode: NodeExecutionUpdater,
  onProgress?: NodeProgressUpdater,
  projectId?: string,
): Promise<NodeExecutorOutput> {
  const node = nodeMap.get(nodeId)!;
  const nodeType = node.data.nodeType;
  const executor = NODE_EXECUTORS[nodeType];

  if (!executor) {
    throw new Error('未注册的节点类型: ' + nodeType);
  }

  // Check if any upstream is blocked
  const upstreamIds = upstreamMap.get(nodeId) ?? [];
  for (const upId of upstreamIds) {
    if (blocked.has(upId)) {
      throw new Error('上游节点 ' + upId + ' 已失败或被阻断');
    }
  }

  // ── Skip completed non-stale nodes (§11.2 partial execution) ──
  // If a node already completed in a previous run and hasn't been
  // marked stale, reuse its existing output without re-executing.
  const existingExecution = node.data.execution;
  if (
    existingExecution?.status === 'completed' &&
    existingExecution.output
  ) {
    onUpdateNode(nodeId, {
      status: 'completed',
      runId,
      startedAt: existingExecution.startedAt,
      completedAt: existingExecution.completedAt,
      output: existingExecution.output,
    });
    return {
      data: existingExecution.output,
      summary: `复用已完成的执行结果（runId=${existingExecution.runId ?? '未知'}）`,
    };
  }

  // Collect upstream outputs
  const upstreamOutputs = new Map<string, NodeExecutorOutput>();
  for (const upId of upstreamIds) {
    const output = outputs.get(upId);
    if (output) upstreamOutputs.set(upId, output);
  }

  // Mark running
  const startedAt = Date.now();
  onUpdateNode(nodeId, {
    status: 'running',
    runId,
    startedAt,
  });

  // Create per-node controller
  const nodeController = new AbortController();
  const nodeSignal = nodeController.signal;

  if (signal?.aborted) {
    nodeController.abort();
  }

  const onAbort = () => nodeController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const result = await executor({
      node,
      upstreamOutputs,
      edges,
      config: node.data.config,
      signal: nodeSignal,
      onProgress: (p) => onProgress?.(nodeId, p),
      projectId: projectId ?? '',
      onUpdateNode: (updates) => onUpdateNode(nodeId, { ...updates, runId }),
    });

    onUpdateNode(nodeId, {
      status: 'completed',
      runId,
      startedAt,
      completedAt: Date.now(),
      output: result.data as BlueprintNodeExecution['output'],
    });

    return result;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      onUpdateNode(nodeId, {
        status: 'cancelled',
        runId,
        startedAt,
        completedAt: Date.now(),
      });
      throw err;
    }

    const errMsg = err instanceof Error ? err.message : String(err);
    onUpdateNode(nodeId, {
      status: 'failed',
      runId,
      startedAt,
      completedAt: Date.now(),
      error: sanitizeErrorMessage(errMsg),
    });

    blocked.add(nodeId);
    throw err;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

// ── Downstream blocking ──────────────────────────────────────────────────

function markDownstreamBlocked(
  failedNodeId: string,
  nodes: BlueprintNode[],
  edges: BlueprintEdge[],
  blocked: Set<string>,
  runId: string,
  onUpdateNode: NodeExecutionUpdater,
): void {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue = [failedNodeId];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const downstream of adjacency.get(current) ?? []) {
      if (!visited.has(downstream) && !blocked.has(downstream)) {
        visited.add(downstream);
        blocked.add(downstream);
        onUpdateNode(downstream, {
          status: 'blocked',
          runId,
          error: '上游节点 ' + failedNodeId + ' 失败',
        });
        queue.push(downstream);
      }
    }
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────

/**
 * Collect all input summaries for a node (for logging / debug).
 * Does not record API keys or secrets.
 */
export function collectNodeInputSummary(
  nodeId: string,
  upstreamMap: Map<string, string[]>,
  nodeMap: Map<string, BlueprintNode>,
  outputs: Map<string, NodeExecutorOutput>,
): Record<string, string> {
  const summary: Record<string, string> = {};
  const upstreamIds = upstreamMap.get(nodeId) ?? [];

  for (const upId of upstreamIds) {
    const node = nodeMap.get(upId);
    const output = outputs.get(upId);
    if (node && output) {
      summary[node.data.label] = output.summary;
    }
  }

  return summary;
}
