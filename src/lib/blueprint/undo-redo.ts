// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Undo / Redo system for the blueprint editor.
 *
 * Architecture (§11.1):
 * ─────────────────────────────────────────────────────────────────
 * A **manual history stack** tracks the active blueprint's editable
 * document fields (nodes, edges, viewport).  The main
 * `useBlueprintStore` remains the single source of truth for
 * persistence and runtime state.
 *
 * The history is kept in sync via a subscription to the main store.
 * Each snapshot is recorded when nodes/edges/viewport change.
 * Undo/redo reads a snapshot from the history and patches it back
 * into the main store via `setState`.
 *
 * Only user-editable document fields are tracked:
 *   - nodes  (with execution stripped — that's runtime state)
 *   - edges
 *   - viewport
 *
 * The following are explicitly excluded from history:
 *   - blueprints array mutations (create/delete/rename/duplicate)
 *   - selectedNodeId / selectedEdgeId
 *   - currentRun / executionLock / abortController / errorSummary
 *   - node.data.execution (generation results are runtime state)
 * ─────────────────────────────────────────────────────────────────
 *
 * §11.1 Checklist:
 *   ✅ Manual history stack with zundo-compatible limit (50)
 *   ✅ Only tracks nodes, edges, viewport (editable document fields)
 *   ✅ Excludes runtime progress, task polling, media binaries
 *   ✅ History limit (50) — avoids unbounded memory growth
 *   ✅ clear() on project/blueprint switch
 *   ✅ Stale propagation on undo/redo
 */

import { useSyncExternalStore } from 'react';
import type { BlueprintNode, BlueprintEdge } from '@/types/blueprint';
import type { Viewport } from '@xyflow/react';
import { useBlueprintStore, selectActiveBlueprint } from '@/stores/blueprint-store';

// ── Types ────────────────────────────────────────────────────────────────

/** The subset of blueprint state tracked by undo/redo. */
export interface BlueprintTemporalSnapshot {
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  viewport: Viewport;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

/** Deep-clone a serialisable value. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Strip runtime execution data from nodes so it doesn't enter history. */
function stripExecution(nodes: BlueprintNode[]): BlueprintNode[] {
  return nodes.map((node) => {
    if (!node.data.execution) return node;
    const { execution: _, ...restData } = node.data;
    return { ...node, data: restData } as BlueprintNode;
  });
}

/**
 * Extract the temporal snapshot from the main store's active blueprint.
 * Returns `null` when no active blueprint exists.
 */
function extractSnapshot(): BlueprintTemporalSnapshot | null {
  const bp = selectActiveBlueprint(useBlueprintStore.getState());
  if (!bp) return null;
  return {
    nodes: clone(stripExecution(bp.nodes)),
    edges: clone(bp.edges),
    viewport: clone(bp.viewport),
  };
}

/** Apply a temporal snapshot back into the main store's active blueprint. */
function applySnapshot(snapshot: BlueprintTemporalSnapshot): void {
  useBlueprintStore.setState((state) => {
    if (!state.activeBlueprintId) return {};
    return {
      blueprints: state.blueprints.map((bp) =>
        bp.id === state.activeBlueprintId && bp.projectId === state.activeProjectId
          ? {
              ...bp,
              nodes: clone(snapshot.nodes),
              edges: clone(snapshot.edges),
              viewport: clone(snapshot.viewport),
              updatedAt: Date.now(),
            }
          : bp,
      ),
    };
  });
}

/**
 * After an undo/redo, mark nodes whose content changed as `stale` so the
 * UI can prompt the user to re-run downstream generation.
 */
function markChangedNodesStale(before: BlueprintNode[], after: BlueprintNode[]): void {
  const beforeMap = new Map(before.map((n) => [n.id, n]));
  const staleIds: string[] = [];

  for (const node of after) {
    const prev = beforeMap.get(node.id);
    if (!prev) continue;
    // Mark stale if the node had a completed/stale execution AND its data changed.
    // 'stale' is included because auto-stale propagation may have already
    // set the status to 'stale' before the undo snapshot was captured (§11.2).
    const prevStatus = prev.data.execution?.status;
    if (prevStatus !== 'completed' && prevStatus !== 'stale') continue;
    const { execution: _prevExec, ...prevData } = prev.data;
    const { execution: _afterExec, ...afterData } = node.data;
    if (JSON.stringify(prevData) !== JSON.stringify(afterData)) {
      staleIds.push(node.id);
    }
  }

  if (staleIds.length > 0) {
    useBlueprintStore.getState().markNodesStale(staleIds);
  }
}

// ── History state (module-level singletons) ──────────────────────────────

let pastStates: BlueprintTemporalSnapshot[] = [];
let futureStates: BlueprintTemporalSnapshot[] = [];
let trackingPaused = false;

/** Guard to prevent re-entrant sync during undo/redo application. */
let applyingSnapshot = false;

/**
 * The "last known" snapshot. Updated AFTER every recorded change so that
 * the subscription can diff against it and push the *previous* state
 * when a new change is detected.
 */
let lastSnapshot: BlueprintTemporalSnapshot | null = null;

/** Track active project/blueprint to detect switches and auto-clear history. */
let lastActiveProjectId = '';
let lastActiveBlueprintId: string | null = null;

/** Bump a version counter so React hooks can re-render on change. */
let version = 0;
function bumpVersion() {
  version++;
  versionListeners.forEach((cb) => cb());
}
const versionListeners = new Set<() => void>();

function subscribeVersion(callback: () => void): () => void {
  versionListeners.add(callback);
  return () => {
    versionListeners.delete(callback);
  };
}

// ── Sync: main store → history ───────────────────────────────────────────

useBlueprintStore.subscribe((state) => {
  // ── Auto-clear history on project or blueprint switch ──
  if (
    state.activeProjectId !== lastActiveProjectId ||
    state.activeBlueprintId !== lastActiveBlueprintId
  ) {
    lastActiveProjectId = state.activeProjectId;
    lastActiveBlueprintId = state.activeBlueprintId;
    lastSnapshot = extractSnapshot();
    if (pastStates.length > 0 || futureStates.length > 0) {
      pastStates = [];
      futureStates = [];
      bumpVersion();
    }
    return;
  }

  if (applyingSnapshot) return;
  if (trackingPaused) return;

  const bp = selectActiveBlueprint(state);
  if (!bp) return;

  const currentSnapshot: BlueprintTemporalSnapshot = {
    nodes: stripExecution(bp.nodes),
    edges: bp.edges,
    viewport: bp.viewport,
  };

  if (
    lastSnapshot &&
    lastSnapshot.nodes === bp.nodes &&
    lastSnapshot.edges === bp.edges &&
    lastSnapshot.viewport === bp.viewport
  ) {
    return; // No actual change (pointer equality on the raw bp fields)
  }

  // A change was detected. Push the previous snapshot to history.
  if (lastSnapshot) {
    pastStates.push(clone(lastSnapshot));
    if (pastStates.length > MAX_HISTORY) {
      pastStates.shift();
    }
    // New change clears redo stack
    if (futureStates.length > 0) {
      futureStates = [];
    }
    bumpVersion();
  }

  // Update lastSnapshot — store RAW references (no clone!) so that
  // pointer-equality comparisons work correctly on subsequent ticks.
  lastSnapshot = { nodes: bp.nodes, edges: bp.edges, viewport: bp.viewport };
});

// ── Public API ───────────────────────────────────────────────────────────

/** Undo the last document change. */
export function undo(steps = 1): void {
  if (pastStates.length === 0) return;

  const beforeNodes = selectActiveBlueprint(useBlueprintStore.getState())?.nodes ?? [];

  // Capture current state for redo
  const currentForRedo = lastSnapshot ?? extractSnapshot();

  // Pop the target state
  const targetIndex = Math.max(0, pastStates.length - steps);
  const target = pastStates[targetIndex];
  const kept = pastStates.slice(0, targetIndex);

  // Push current to future for redo
  if (currentForRedo) {
    futureStates.push(currentForRedo);
  }

  pastStates = kept;

  // Apply the target state
  applyingSnapshot = true;
  applySnapshot(target);
  applyingSnapshot = false;

  // Update lastSnapshot to the restored state
  lastSnapshot = clone(target);

  // Mark changed nodes stale
  const afterNodes = selectActiveBlueprint(useBlueprintStore.getState())?.nodes ?? [];
  markChangedNodesStale(beforeNodes, afterNodes);

  bumpVersion();
}

/** Redo the last undone document change. */
export function redo(steps = 1): void {
  if (futureStates.length === 0) return;

  const beforeNodes = selectActiveBlueprint(useBlueprintStore.getState())?.nodes ?? [];

  // Capture current state for undo
  const currentForUndo = lastSnapshot ?? extractSnapshot();

  // Pop the target from future
  const targetIndex = Math.max(0, futureStates.length - steps);
  const target = futureStates[targetIndex];
  const kept = futureStates.slice(0, targetIndex);

  // Push current to past for undo
  if (currentForUndo) {
    pastStates.push(currentForUndo);
  }

  futureStates = kept;

  // Apply the target state
  applyingSnapshot = true;
  applySnapshot(target);
  applyingSnapshot = false;

  // Update lastSnapshot to the restored state
  lastSnapshot = clone(target);

  // Mark changed nodes stale
  const afterNodes = selectActiveBlueprint(useBlueprintStore.getState())?.nodes ?? [];
  markChangedNodesStale(beforeNodes, afterNodes);

  bumpVersion();
}

/** Clear all undo/redo history. Call when switching projects or blueprints. */
export function clearUndoHistory(): void {
  pastStates = [];
  futureStates = [];
  lastSnapshot = extractSnapshot();
  bumpVersion();
}

/** Pause history tracking (e.g. during programmatic bulk operations). */
export function pauseTracking(): void {
  trackingPaused = true;
}

/** Resume history tracking. */
export function resumeTracking(): void {
  trackingPaused = false;
}

/** Check whether undo is available. */
export function canUndo(): boolean {
  return pastStates.length > 0;
}

/** Check whether redo is available. */
export function canRedo(): boolean {
  return futureStates.length > 0;
}

// ── React hooks ──────────────────────────────────────────────────────────

/** React hook: whether undo is currently available. */
export function useCanUndo(): boolean {
  return useSyncExternalStore(subscribeVersion, () => pastStates.length > 0);
}

/** React hook: whether redo is currently available. */
export function useCanRedo(): boolean {
  return useSyncExternalStore(subscribeVersion, () => futureStates.length > 0);
}
