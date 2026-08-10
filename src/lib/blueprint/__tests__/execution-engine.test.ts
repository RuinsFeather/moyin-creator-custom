// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  BlueprintNode,
  BlueprintEdge,
  BlueprintNodeExecution,
  BlueprintProject,
} from '@/types/blueprint';
import {
  runBlueprint,
  collectNodeInputSummary,
  type NodeExecutionUpdater,
  type BlueprintRunResult,
} from '../execution-engine';
import type { NodeExecutorOutput } from '../node-executors';

// Mock Freedom API — only needed for image/video generator integration tests
vi.mock('@/lib/freedom/freedom-api', () => ({
  generateFreedomImage: vi.fn().mockResolvedValue({
    url: 'https://example.com/gen-img.png',
    mediaId: 'media-ee-img',
    taskId: 'task-ee-img',
    metadata: {},
  }),
  generateFreedomVideo: vi.fn().mockResolvedValue({
    url: 'https://example.com/gen-vid.mp4',
    mediaId: 'media-ee-vid',
    taskId: 'task-ee-vid',
    metadata: {},
  }),
}));

// ── Test helpers ──────────────────────────────────────────────────────────

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

function makeProject(
  nodes: BlueprintNode[],
  edges: BlueprintEdge[] = [],
): BlueprintProject {
  return {
    id: 'bp-1',
    projectId: 'proj-1',
    name: 'Test Blueprint',
    version: 1,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Track all node execution updates. */
function createTrackingUpdater() {
  const updates: Array<{ nodeId: string; execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution> | undefined }> = [];
  const updater: NodeExecutionUpdater = (nodeId, execution) => {
    updates.push({ nodeId, execution: execution ? { ...execution } : undefined });
  };
  return { updates, updater };
}

/** Get the final execution status for a node from the update log. */
function getFinalStatus(
  updates: Array<{ nodeId: string; execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution> | undefined }>,
  nodeId: string,
): BlueprintNodeExecution['status'] | undefined {
  const nodeUpdates = updates.filter((u) => u.nodeId === nodeId);
  return nodeUpdates[nodeUpdates.length - 1]?.execution?.status;
}

/** Get all statuses a node went through in order. */
function getAllStatuses(
  updates: Array<{ nodeId: string; execution: BlueprintNodeExecution | Partial<BlueprintNodeExecution> | undefined }>,
  nodeId: string,
): BlueprintNodeExecution['status'][] {
  return updates
    .filter((u) => u.nodeId === nodeId && u.execution?.status)
    .map((u) => u.execution!.status as BlueprintNodeExecution['status']);
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('execution-engine', () => {
  let tracking: ReturnType<typeof createTrackingUpdater>;

  beforeEach(() => {
    tracking = createTrackingUpdater();
    vi.clearAllMocks();
  });

  // ── Validation ────────────────────────────────────────────────

  describe('graph validation before execution', () => {
    it('returns errors immediately for an invalid graph', async () => {
      // Duplicate node IDs
      const a1 = makeNode('a', 'text-input');
      const a2 = makeNode('a', 'image-generator');
      const project = makeProject([a1, a2]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(0);
      expect(result.errorSummary.length).toBeGreaterThan(0);
      expect(result.errorSummary[0]).toContain('duplicate-node-id');
    });

    it('returns errors for a graph with a cycle', async () => {
      const a = makeNode('a', 'text-input');
      const b = makeNode('b', 'text-input');
      const project = makeProject([a, b], [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'a'),
      ]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(0);
      expect(result.errorSummary.length).toBeGreaterThan(0);
    });
  });

  // ── Empty graph ───────────────────────────────────────────────

  describe('empty graph', () => {
    it('completes with zero counts for an empty graph', async () => {
      const project = makeProject([]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.errorSummary).toEqual([]);
      expect(result.aborted).toBe(false);
    });
  });

  // ── Single node execution ─────────────────────────────────────

  describe('single node execution', () => {
    it('executes a single text-input node successfully', async () => {
      const node = makeNode('a', 'text-input', { text: 'hello' });
      const project = makeProject([node]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.errorSummary).toEqual([]);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');

      // Should have gone through queued → running → completed
      const statuses = getAllStatuses(tracking.updates, 'a');
      expect(statuses).toEqual(['queued', 'running', 'completed']);
    });

    it('executes an image-reference node', async () => {
      const node = makeNode('a', 'image-reference', { media: [] });
      const project = makeProject([node]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(1);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
    });

    it('executes a script-import node', async () => {
      const node = makeNode('a', 'script-import', {
        selectedShotIds: ['s1', 's2'],
        mode: 'snapshot',
      });
      const project = makeProject([node]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(1);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
    });
  });

  // ── Linear chain ─────────────────────────────────────────────

  describe('linear chain execution', () => {
    it('executes a→b→c in correct order', async () => {
      const a = makeNode('a', 'text-input', { text: 'hello' });
      const b = makeNode('b', 'text-input', { text: 'world' });
      const c = makeNode('c', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [a, b, c],
        [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(3);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'b')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'c')).toBe('completed');
    });
  });

  // ── Parallel execution ────────────────────────────────────────

  describe('parallel execution', () => {
    it('executes independent nodes in the same level', async () => {
      const a = makeNode('a', 'text-input', { text: 'a' });
      const b = makeNode('b', 'text-input', { text: 'b' });
      const c = makeNode('c', 'text-input', { text: 'c' });
      // a, b, c are all independent
      const project = makeProject([a, b, c]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(3);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'b')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'c')).toBe('completed');
    });

    it('respects concurrency limit', async () => {
      const nodes = Array.from({ length: 10 }, (_, i) =>
        makeNode('n' + i, 'text-input', { text: 'node ' + i }),
      );
      const project = makeProject(nodes);

      const result = await runBlueprint({
        project,
        mode: 'all',
        concurrencyLimit: 2,
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(10);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    it('fails a node and blocks its downstream nodes', async () => {
      // Image generator without a prompt will fail
      const a = makeNode('a', 'text-input', { text: 'hello' });
      const gen = makeNode('gen', 'image-generator', {
        /* no prompt */
      });
      const out = makeNode('out', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [a, gen, out],
        [makeEdge('e1', 'a', 'gen'), makeEdge('e2', 'gen', 'out')],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'gen')).toBe('failed');
      expect(getFinalStatus(tracking.updates, 'out')).toBe('blocked');
      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.blockedCount).toBe(1);
      expect(result.errorSummary.length).toBe(1);
      expect(result.errorSummary[0]).toContain('缺少 prompt');
    });

    it('blocks transitive downstream of a failed node', async () => {
      const gen = makeNode('gen', 'image-generator', {});
      const b = makeNode('b', 'text-input', { text: 'x' });
      const c = makeNode('c', 'output', { acceptedTypes: ['image'] });
      // gen→b→c (gen fails, b and c should be blocked)
      const project = makeProject(
        [gen, b, c],
        [makeEdge('e1', 'gen', 'b'), makeEdge('e2', 'b', 'c')],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(getFinalStatus(tracking.updates, 'gen')).toBe('failed');
      expect(getFinalStatus(tracking.updates, 'b')).toBe('blocked');
      expect(getFinalStatus(tracking.updates, 'c')).toBe('blocked');
      expect(result.blockedCount).toBe(2);
    });

    it('allows unrelated branches to continue when one fails', async () => {
      // a (ok) → out1, gen (fail) → out2
      const a = makeNode('a', 'text-input', { text: 'ok' });
      const gen = makeNode('gen', 'image-generator', {});
      const out1 = makeNode('out1', 'output', { acceptedTypes: ['image'] });
      const out2 = makeNode('out2', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [a, gen, out1, out2],
        [makeEdge('e1', 'a', 'out1'), makeEdge('e2', 'gen', 'out2')],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'out1')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'gen')).toBe('failed');
      expect(getFinalStatus(tracking.updates, 'out2')).toBe('blocked');
      expect(result.completedCount).toBe(2);
      expect(result.failedCount).toBe(1);
    });
  });

  // ── Cancellation ──────────────────────────────────────────────

  describe('cancellation', () => {
    it('aborts when signal is already aborted', async () => {
      const nodes = Array.from({ length: 5 }, (_, i) =>
        makeNode('n' + i, 'text-input', { text: 'x' }),
      );
      const project = makeProject(nodes);
      const controller = new AbortController();
      controller.abort(); // pre-abort

      const result = await runBlueprint({
        project,
        mode: 'all',
        signal: controller.signal,
        onUpdateNode: tracking.updater,
      });

      // All nodes should be queued, then cancelled
      expect(result.aborted).toBe(true);
    });
  });

  // ── Run modes ─────────────────────────────────────────────────

  describe('run modes', () => {
    const a = makeNode('a', 'text-input', { text: 'a' });
    const b = makeNode('b', 'text-input', { text: 'b' });
    const c = makeNode('c', 'text-input', { text: 'c' });
    // a→b→c
    const chainProject = makeProject(
      [a, b, c],
      [makeEdge('e1', 'a', 'b'), makeEdge('e2', 'b', 'c')],
    );

    it('mode="node" runs target node and its upstream', async () => {
      tracking = createTrackingUpdater();
      const result = await runBlueprint({
        project: chainProject,
        mode: 'node',
        nodeId: 'b',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(2); // a + b
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'b')).toBe('completed');
      // c should not be touched (not in subgraph)
      expect(getFinalStatus(tracking.updates, 'c')).toBeUndefined();
    });

    it('mode="downstream" runs target node and its downstream', async () => {
      tracking = createTrackingUpdater();
      const result = await runBlueprint({
        project: chainProject,
        mode: 'downstream',
        nodeId: 'b',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(2); // b + c
      expect(getFinalStatus(tracking.updates, 'b')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'c')).toBe('completed');
      // a should not be touched
      expect(getFinalStatus(tracking.updates, 'a')).toBeUndefined();
    });

    it('mode="all" runs all nodes', async () => {
      tracking = createTrackingUpdater();
      const result = await runBlueprint({
        project: chainProject,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(3);
    });

    it('returns error when mode="node" without nodeId', async () => {
      tracking = createTrackingUpdater();
      const result = await runBlueprint({
        project: chainProject,
        mode: 'node',
        onUpdateNode: tracking.updater,
      });

      expect(result.errorSummary.length).toBe(1);
      expect(result.errorSummary[0]).toContain('nodeId');
    });

    it('returns error when nodeId does not exist', async () => {
      tracking = createTrackingUpdater();
      const result = await runBlueprint({
        project: chainProject,
        mode: 'node',
        nodeId: 'nonexistent',
        onUpdateNode: tracking.updater,
      });

      expect(result.errorSummary.length).toBe(1);
      expect(result.errorSummary[0]).toContain('不存在');
    });
  });

  // ── runId generation ──────────────────────────────────────────

  describe('runId', () => {
    it('generates a unique runId for each run', async () => {
      const project = makeProject([makeNode('a', 'text-input', { text: 'x' })]);

      const r1 = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      tracking = createTrackingUpdater();
      const r2 = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(r1.runId).not.toBe(r2.runId);
    });
  });

  // ── elapsed time ─────────────────────────────────────────────

  describe('elapsed time', () => {
    it('records a non-negative elapsed time', async () => {
      const project = makeProject([makeNode('a', 'text-input', { text: 'x' })]);

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.elapsed).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Progress callback ────────────────────────────────────────

  describe('progress callback', () => {
    it('calls onProgress for each node', async () => {
      const a = makeNode('a', 'text-input', { text: 'x' });
      const b = makeNode('b', 'text-input', { text: 'y' });
      const project = makeProject([a, b]);

      const progressCalls: Array<{ nodeId: string; progress: number }> = [];
      const onProgress = (nodeId: string, progress: number) => {
        progressCalls.push({ nodeId, progress });
      };

      await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
        onProgress,
      });

      expect(progressCalls.length).toBeGreaterThanOrEqual(2);
      expect(progressCalls.some((c) => c.nodeId === 'a' && c.progress === 100)).toBe(true);
      expect(progressCalls.some((c) => c.nodeId === 'b' && c.progress === 100)).toBe(true);
    });
  });

  // ── Diamond graph ────────────────────────────────────────────

  describe('diamond graph', () => {
    it('executes a diamond correctly (a→b,a→c,b→d,c→d)', async () => {
      const a = makeNode('a', 'text-input', { text: 'root' });
      const b = makeNode('b', 'text-input', { text: 'left' });
      const c = makeNode('c', 'text-input', { text: 'right' });
      const d = makeNode('d', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [a, b, c, d],
        [
          makeEdge('e1', 'a', 'b'),
          makeEdge('e2', 'a', 'c'),
          makeEdge('e3', 'b', 'd'),
          makeEdge('e4', 'c', 'd'),
        ],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(4);
      expect(getFinalStatus(tracking.updates, 'a')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'b')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'c')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'd')).toBe('completed');
    });
  });

  // ── No duplicate execution ────────────────────────────────────

  describe('no duplicate execution', () => {
    it('each node is executed exactly once', async () => {
      const a = makeNode('a', 'text-input', { text: 'x' });
      const b = makeNode('b', 'text-input', { text: 'y' });
      const c = makeNode('c', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [a, b, c],
        [makeEdge('e1', 'a', 'c'), makeEdge('e2', 'b', 'c')],
      );

      await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      // Each node should have exactly one "running" status
      const aRunning = tracking.updates.filter(
        (u) => u.nodeId === 'a' && u.execution?.status === 'running',
      );
      const bRunning = tracking.updates.filter(
        (u) => u.nodeId === 'b' && u.execution?.status === 'running',
      );
      const cRunning = tracking.updates.filter(
        (u) => u.nodeId === 'c' && u.execution?.status === 'running',
      );
      expect(aRunning).toHaveLength(1);
      expect(bRunning).toHaveLength(1);
      expect(cRunning).toHaveLength(1);
    });
  });

  // ── collectNodeInputSummary ───────────────────────────────────

  describe('collectNodeInputSummary', () => {
    it('returns summaries of upstream outputs', () => {
      const nodeMap = new Map<string, BlueprintNode>();
      nodeMap.set('a', makeNode('a', 'text-input', { text: 'x' }));
      nodeMap.set('b', makeNode('b', 'image-generator'));

      const upstreamMap = new Map<string, string[]>();
      upstreamMap.set('a', []);
      upstreamMap.set('b', ['a']);

      const outputs = new Map<string, NodeExecutorOutput>();
      outputs.set('a', { data: 'hello', summary: 'text (5 chars)' });

      const summary = collectNodeInputSummary('b', upstreamMap, nodeMap, outputs);

      expect(summary).toEqual({
        'text-input (a)': 'text (5 chars)',
      });
    });

    it('returns empty for a root node', () => {
      const nodeMap = new Map<string, BlueprintNode>();
      nodeMap.set('a', makeNode('a', 'text-input'));

      const upstreamMap = new Map<string, string[]>();
      upstreamMap.set('a', []);

      const outputs = new Map<string, NodeExecutorOutput>();

      const summary = collectNodeInputSummary('a', upstreamMap, nodeMap, outputs);
      expect(summary).toEqual({});
    });
  });

  // ── 9.1 Integration: image-generator pipeline ────────────────

  describe('9.1 image-generator integration', () => {
    it('executes text-input → image-generator → output pipeline', async () => {
      const textNode = makeNode('txt', 'text-input', { text: 'A cat' });
      const genNode = makeNode('gen', 'image-generator', {
        prompt: 'Generate a cat',
        model: 'flux-v1',
      });
      const outNode = makeNode('out', 'output', { acceptedTypes: ['image'] });
      const project = makeProject(
        [textNode, genNode, outNode],
        [makeEdge('e1', 'txt', 'gen'), makeEdge('e2', 'gen', 'out')],
      );

      const result = await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(result.completedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.errorSummary).toEqual([]);

      // Verify all nodes completed
      expect(getFinalStatus(tracking.updates, 'txt')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'gen')).toBe('completed');
      expect(getFinalStatus(tracking.updates, 'out')).toBe('completed');
    });

    it('writes image-generator output to node execution state', async () => {
      const genNode = makeNode('gen', 'image-generator', {
        prompt: 'A landscape',
        model: 'test-model',
      });
      const project = makeProject([genNode]);

      await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      // Find the final 'completed' update for the gen node
      const completedUpdates = tracking.updates.filter(
        (u) => u.nodeId === 'gen' && u.execution?.status === 'completed',
      );
      expect(completedUpdates).toHaveLength(1);

      const exec = completedUpdates[0].execution!;
      expect(exec.output).toBeDefined();

      // Verify the output has the expected media ref fields
      const output = exec.output as { url?: string; mediaId?: string; mimeType?: string; dedupeKey?: string; taskId?: string };
      expect(output.url).toBe('https://example.com/gen-img.png');
      expect(output.mediaId).toBe('media-ee-img');
      expect(output.taskId).toBe('task-ee-img');
      expect(output.mimeType).toBe('image/png');
      expect(output.dedupeKey).toContain('gen');
    });

    it('passes blueprint projectId through to node executor', async () => {
      const genNode = makeNode('gen', 'image-generator', {
        prompt: 'Test project',
        model: 'test-model',
      });
      const project = makeProject([genNode]);
      project.projectId = 'specific-proj-id';

      await runBlueprint({
        project,
        mode: 'all',
        onUpdateNode: tracking.updater,
      });

      expect(getFinalStatus(tracking.updates, 'gen')).toBe('completed');

      // Verify generateFreedomImage was called with the correct projectId
      const { generateFreedomImage } = await import('@/lib/freedom/freedom-api');
      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.projectId).toBe('specific-proj-id');
    });
  });
});
