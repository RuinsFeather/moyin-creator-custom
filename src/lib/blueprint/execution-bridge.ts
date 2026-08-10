// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Blueprint Execution Bridge (§11.2)
//
// Connects the blueprint store's `beginRun` / `finishRun` lifecycle
// to the execution engine's `runBlueprint`. This is the single entry
// point for all blueprint execution — toolbar buttons, retry flows,
// and programmatic runs all go through here.
//
// Responsibilities:
//   1. Acquire the execution lock via `beginRun`
//   2. Read the active blueprint snapshot
//   3. Optionally confirm paid tasks before execution
//   4. Call `runBlueprint` with progress/status callbacks
//   5. Release the lock via `finishRun`
//   6. Handle errors and cancellation gracefully

import {
  useBlueprintStore,
  selectActiveBlueprint,
  type BlueprintRunMode,
} from '@/stores/blueprint-store';
import type { BlueprintNode } from '@/types/blueprint';
import { runBlueprintWithMetrics } from './execution-engine';

// ── Types ────────────────────────────────────────────────────────────────

/** Node types that incur a cost when executed. */
const PAID_NODE_TYPES = new Set(['image-generator', 'video-generator']);

/** Options for `executeBlueprintRun`. */
export interface ExecuteBlueprintRunOptions {
  /**
   * Called when the execution includes paid nodes (image/video generators).
   * Return `true` to proceed, `false` to cancel.
   * If omitted, paid tasks are submitted without confirmation.
   */
  confirmPaidTask?: (nodes: BlueprintNode[]) => Promise<boolean>;
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Execute a blueprint run. This is the primary entry point for all
 * blueprint execution.
 *
 * @param mode - `'all'` | `'node'` | `'downstream'`
 * @param nodeId - Required for `'node'` and `'downstream'` modes
 * @param options - Optional confirmation callback for paid tasks
 */
export async function executeBlueprintRun(
  mode: BlueprintRunMode,
  nodeId?: string,
  options?: ExecuteBlueprintRunOptions,
): Promise<void> {
  const store = useBlueprintStore.getState();

  // ── 1. Acquire lock ──────────────────────────────────────────
  const request = store.beginRun(mode, nodeId);
  if (!request) return;

  // ── 2. Snapshot active blueprint ─────────────────────────────
  // Re-read after beginRun to get the locked state
  const state = useBlueprintStore.getState();
  const blueprint = selectActiveBlueprint(state);
  if (!blueprint) {
    state.finishRun(['没有活跃蓝图']);
    return;
  }

  // ── 3. Compute target nodes for paid-task confirmation ───────
  if (options?.confirmPaidTask) {
    const targetNodes = computeTargetNodes(blueprint, mode, nodeId);
    const paidNodes = targetNodes.filter((n) => PAID_NODE_TYPES.has(n.data.nodeType));

    if (paidNodes.length > 0) {
      const confirmed = await options.confirmPaidTask(paidNodes);
      if (!confirmed) {
        state.finishRun([]);
        return;
      }
    }
  }

  // ── 4. Execute ───────────────────────────────────────────────
  const abortController = state.abortController;

  try {
    const result = await runBlueprintWithMetrics({
      project: blueprint,
      mode: request.mode,
      nodeId: request.nodeId,
      runId: request.runId,
      signal: abortController?.signal,
      onUpdateNode: (nodeId, execution) => {
        useBlueprintStore.getState().updateNodeExecution(nodeId, execution);
      },
      onProgress: (nodeId, progress) => {
        // Merge progress into existing execution without overwriting status
        const current = useBlueprintStore.getState();
        const bp = selectActiveBlueprint(current);
        const node = bp?.nodes.find((n) => n.id === nodeId);
        if (node?.data.execution) {
          current.updateNodeExecution(nodeId, {
            ...node.data.execution,
            progress,
          });
        }
      },
    });

    // ── 5. Finish ────────────────────────────────────────────
    useBlueprintStore.getState().finishRun(result.errorSummary);
  } catch (err) {
    // ── 6. Handle unexpected errors ──────────────────────────
    if (err instanceof DOMException && err.name === 'AbortError') {
      // User cancelled — cancelRun already handled node states
      useBlueprintStore.getState().finishRun([]);
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    useBlueprintStore.getState().finishRun([errMsg]);
  }
}

/**
 * Retry a failed or stale node. Re-executes the node and its downstream
 * subgraph, skipping upstream nodes that are completed and not stale.
 */
export async function retryNodeExecution(
  nodeId: string,
  options?: ExecuteBlueprintRunOptions,
): Promise<void> {
  await executeBlueprintRun('node', nodeId, options);
}

// ── Internal helpers ─────────────────────────────────────────────────────

import {
  getUpstreamSubgraph,
  getDownstreamSubgraph,
} from './dag-traversal';
import type { BlueprintProject } from '@/types/blueprint';

function computeTargetNodes(
  project: BlueprintProject,
  mode: BlueprintRunMode,
  nodeId?: string,
): BlueprintNode[] {
  if (mode === 'all') return project.nodes;
  if (!nodeId) return [];

  if (mode === 'node') {
    const subgraph = getUpstreamSubgraph(nodeId, project.nodes, project.edges);
    if (!subgraph) return [];
    return project.nodes.filter((n) => subgraph.nodeIds.includes(n.id));
  }

  // mode === 'downstream'
  const subgraph = getDownstreamSubgraph(nodeId, project.nodes, project.edges);
  if (!subgraph) return [];
  return project.nodes.filter((n) => subgraph.nodeIds.includes(n.id));
}
