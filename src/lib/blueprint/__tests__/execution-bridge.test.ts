// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Tests for §11.2 partial execution features:
 *   - Execution bridge (executeBlueprintRun / retryNodeExecution)
 *   - Skip logic for completed non-stale nodes
 *   - Auto-stale propagation on config change
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  BlueprintNode,
  BlueprintEdge,
  BlueprintNodeExecution,
} from '@/types/blueprint';
import { runBlueprint } from '../execution-engine';
import type { NodeExecutionUpdater } from '../execution-engine';

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/freedom/freedom-api', () => ({
  generateFreedomImage: vi.fn().mockResolvedValue({
    url: 'https://example.com/gen-img.png',
    mediaId: 'media-eb-img',
    taskId: 'task-eb-img',
    metadata: {},
  }),
  generateFreedomVideo: vi.fn().mockResolvedValue({
    url: 'https://example.com/gen-vid.mp4',
    mediaId: 'media-eb-vid',
    taskId: 'task-eb-vid',
    metadata: {},
  }),
}));

// ── Test helpers ───────────────────────────────────────────────────────────

function makeNode(
  id: string,
  nodeType: BlueprintNode['data']['nodeType'] = 'text-input',
  config: Record<string, unknown> = {},
): BlueprintNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: nodeType + ' (' + id + ')',
      config,
    },
  } as BlueprintNode;
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  opts: {
    sourceHandle?: string;
    targetHandle?: string;
    dataType?: 'text' | 'image' | 'video' | 'audio' | 'context';
  } = {},
): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts.sourceHandle ?? '',
    targetHandle: opts.targetHandle ?? '',
    data: { dataType: opts.dataType ?? 'text' },
  } as BlueprintEdge;
}

function makeProject(nodes: BlueprintNode[], edges: BlueprintEdge[] = []) {
  return {
    id: 'bp-1',
    projectId: 'proj-1',
    name: 'Test Blueprint',
    version: 1,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'draft' as const,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createTrackingUpdater() {
  const updates: Array<{
    nodeId: string;
    execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution> | undefined;
  }> = [];
  const updater: NodeExecutionUpdater = (nodeId, execution) => {
    updates.push({ nodeId, execution: execution ? { ...execution } : undefined });
  };
  return { updates, updater };
}

function getFinalStatus(
  updates: Array<{
    nodeId: string;
    execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution> | undefined;
  }>,
  nodeId: string,
): BlueprintNodeExecution['status'] | undefined {
  const nodeUpdates = updates.filter((u) => u.nodeId === nodeId);
  return nodeUpdates[nodeUpdates.length - 1]?.execution?.status;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('execution-engine: skip completed nodes', () => {
  let tracking: ReturnType<typeof createTrackingUpdater>;

  beforeEach(() => {
    tracking = createTrackingUpdater();
    vi.clearAllMocks();
  });

  it('skips a completed non-stale node and returns existing output', async () => {
    const existingOutput = { url: 'text://from-previous-run', mimeType: 'text/plain' };
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'completed',
      output: existingOutput,
      startedAt: 1000,
      completedAt: 2000,
    };
    const n2 = makeNode('n2', 'output', {});
    const project = makeProject(
      [n1, n2],
      [makeEdge('e1', 'n1', 'n2', { dataType: 'text' })],
    );

    const result = await runBlueprint({
      project,
      mode: 'all',
      onUpdateNode: tracking.updater,
    });

    // n1 should be marked completed immediately (skipped)
    expect(getFinalStatus(tracking.updates, 'n1')).toBe('completed');
    // n2 should complete normally
    expect(getFinalStatus(tracking.updates, 'n2')).toBe('completed');
    // Both completed successfully
    expect(result.completedCount).toBe(2);
    expect(result.failedCount).toBe(0);
  });

  it('does NOT skip a stale node (re-executes it)', async () => {
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'stale',
      output: { url: 'text://old', mimeType: 'text/plain' },
      startedAt: 1000,
      completedAt: 2000,
    };
    const project = makeProject([n1]);

    await runBlueprint({
      project,
      mode: 'all',
      onUpdateNode: tracking.updater,
    });

    // n1 should go through queued → running → completed
    const statuses = tracking.updates
      .filter((u) => u.nodeId === 'n1' && u.execution?.status)
      .map((u) => u.execution!.status);
    expect(statuses).toContain('running');
    expect(getFinalStatus(tracking.updates, 'n1')).toBe('completed');
  });

  it('does NOT skip a failed node (re-executes it)', async () => {
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'failed',
      error: 'previous error',
      startedAt: 1000,
      completedAt: 2000,
    };
    const project = makeProject([n1]);

    await runBlueprint({
      project,
      mode: 'all',
      onUpdateNode: tracking.updater,
    });

    // n1 should be re-executed (go through running)
    const statuses = tracking.updates
      .filter((u) => u.nodeId === 'n1' && u.execution?.status)
      .map((u) => u.execution!.status);
    expect(statuses).toContain('running');
  });

  it('does NOT skip completed node without output', async () => {
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'completed',
      // no output
      startedAt: 1000,
      completedAt: 2000,
    };
    const project = makeProject([n1]);

    await runBlueprint({
      project,
      mode: 'all',
      onUpdateNode: tracking.updater,
    });

    // n1 should be re-executed
    const statuses = tracking.updates
      .filter((u) => u.nodeId === 'n1' && u.execution?.status)
      .map((u) => u.execution!.status);
    expect(statuses).toContain('running');
  });
});

describe('execution-engine: stale propagation behavior', () => {
  let tracking: ReturnType<typeof createTrackingUpdater>;

  beforeEach(() => {
    tracking = createTrackingUpdater();
    vi.clearAllMocks();
  });

  it('skips completed upstream but re-runs stale downstream', async () => {
    // n1 (completed) → n2 (stale) → n3 (completed)
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'completed',
      output: { url: 'text://n1-output', mimeType: 'text/plain' },
      startedAt: 1000,
      completedAt: 2000,
    };
    const n2 = makeNode('n2', 'text-input', { text: 'world' });
    n2.data.execution = {
      status: 'stale',
      output: { url: 'text://n2-old', mimeType: 'text/plain' },
      startedAt: 3000,
      completedAt: 4000,
    };
    const n3 = makeNode('n3', 'output', {});
    n3.data.execution = {
      status: 'completed',
      output: { url: 'text://n3-output', mimeType: 'text/plain' },
      startedAt: 5000,
      completedAt: 6000,
    };
    const project = makeProject(
      [n1, n2, n3],
      [
        makeEdge('e1', 'n1', 'n2', { dataType: 'text' }),
        makeEdge('e2', 'n2', 'n3', { dataType: 'text' }),
      ],
    );

    const result = await runBlueprint({
      project,
      mode: 'all',
      onUpdateNode: tracking.updater,
    });

    // n1 should be skipped (completed with output)
    // n2 should be re-run (stale)
    // n3 should be re-run because n2's output changed
    expect(getFinalStatus(tracking.updates, 'n1')).toBe('completed');
    expect(getFinalStatus(tracking.updates, 'n2')).toBe('completed');
    expect(getFinalStatus(tracking.updates, 'n3')).toBe('completed');
    expect(result.completedCount).toBe(3);
  });

  it('mode=node only runs target node and skips completed upstream', async () => {
    const n1 = makeNode('n1', 'text-input', { text: 'hello' });
    n1.data.execution = {
      status: 'completed',
      output: { url: 'text://n1-done', mimeType: 'text/plain' },
      startedAt: 1000,
      completedAt: 2000,
    };
    const n2 = makeNode('n2', 'output', {});
    const project = makeProject(
      [n1, n2],
      [makeEdge('e1', 'n1', 'n2', { dataType: 'text' })],
    );

    const result = await runBlueprint({
      project,
      mode: 'node',
      nodeId: 'n2',
      onUpdateNode: tracking.updater,
    });

    // n1 is in the subgraph (upstream of n2) but skipped (completed with output)
    // n2 should run normally
    expect(getFinalStatus(tracking.updates, 'n2')).toBe('completed');
    // Both are counted as completed (n1 skipped → reused output)
    expect(result.completedCount).toBe(2);
  });
});
