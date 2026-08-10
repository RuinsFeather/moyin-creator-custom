// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  duplicateBlueprintDocument,
  partializeBlueprintStore,
  useBlueprintStore,
} from '../blueprint-store';
import { createEmptyBlueprintProject } from '@/lib/blueprint/blueprint-schema';
import type { BlueprintEdge, BlueprintNode } from '@/types/blueprint';

vi.mock('@/lib/freedom/freedom-api', () => ({
  resumeFreedomVideoTask: vi.fn().mockResolvedValue({
    url: 'https://example.com/recovered-video.mp4',
    mediaId: 'media-recovered',
    taskId: 'task-recovered',
  }),
}));

import { resumeFreedomVideoTask } from '@/lib/freedom/freedom-api';

const projectA = 'project-a';

function textNode(id: string): BlueprintNode {
  return {
    id,
    type: 'text-input',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'text-input',
      label: id,
      config: { text: id },
    },
  };
}

function outputNode(id: string): BlueprintNode {
  return {
    id,
    type: 'output',
    position: { x: 200, y: 0 },
    data: {
      nodeType: 'output',
      label: id,
      config: { acceptedTypes: ['image', 'video'] },
    },
  };
}

function edge(id: string, source: string, target: string): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'text',
    targetHandle: 'media',
    type: 'blueprint',
    data: { dataType: 'text' },
  };
}

describe('blueprint store', () => {
  beforeEach(() => {
    useBlueprintStore.setState({
      schemaVersion: 1,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      currentRun: null,
      executionLock: false,
      abortController: null,
      errorSummary: [],
      recoveryAbortController: null,
    });
  });

  it('creates and edits a project-scoped blueprint graph', () => {
    useBlueprintStore.getState().setActiveProjectId(projectA);
    const blueprint = useBlueprintStore.getState().createBlueprint('蓝图 A');
    const source = textNode('source');
    const target = outputNode('target');

    useBlueprintStore.getState().addNode(source);
    useBlueprintStore.getState().addNode(target);
    useBlueprintStore.getState().addEdge(edge('edge-a', source.id, target.id));
    useBlueprintStore.getState().updateViewport({ x: 10, y: 20, zoom: 1.5 });
    useBlueprintStore.getState().selectNode(source.id);

    const state = useBlueprintStore.getState();
    const current = state.blueprints.find((item) => item.id === blueprint.id);
    expect(current?.nodes).toHaveLength(2);
    expect(current?.edges).toHaveLength(1);
    expect(current?.viewport).toEqual({ x: 10, y: 20, zoom: 1.5 });
    expect(state.selectedNodeId).toBe(source.id);
  });

  it('removes connected edges when removing a node', () => {
    useBlueprintStore.getState().setActiveProjectId(projectA);
    useBlueprintStore.getState().createBlueprint();
    useBlueprintStore.getState().addNode(textNode('source'));
    useBlueprintStore.getState().addNode(outputNode('target'));
    useBlueprintStore.getState().addEdge(edge('edge-a', 'source', 'target'));

    useBlueprintStore.getState().removeNode('source');

    const current = useBlueprintStore.getState().blueprints[0];
    expect(current.nodes.map((node) => node.id)).toEqual(['target']);
    expect(current.edges).toEqual([]);
  });

  it('duplicates nodes and edges without sharing execution identity', () => {
    const source = createEmptyBlueprintProject(projectA, 'blueprint-a', '源蓝图', 100);
    source.nodes = [
      {
        ...textNode('source'),
        data: {
          ...textNode('source').data,
          output: [{ mediaId: 'media-a' }],
          execution: {
            status: 'completed',
            runId: 'run-a',
            task: {
              taskId: 'task-a',
              route: 'unified',
              pollUrl: 'https://example.test/poll',
              model: 'model-a',
            },
          },
        },
      },
      outputNode('target'),
    ];
    source.edges = [edge('edge-a', 'source', 'target')];

    const copy = duplicateBlueprintDocument(source, (() => {
      let id = 0;
      return () => `copy-${++id}`;
    })(), 200);

    expect(copy.id).toBe('copy-4');
    expect(copy.nodes.map((node) => node.id)).toEqual(['copy-1', 'copy-2']);
    expect(copy.edges[0]).toMatchObject({
      id: 'copy-3',
      source: 'copy-1',
      target: 'copy-2',
    });
    expect(copy.nodes[0].data.output).toEqual([{ mediaId: 'media-a' }]);
    expect(copy.nodes[0].data.execution).toBeUndefined();
  });

  it('does not persist runtime execution objects', () => {
    useBlueprintStore.getState().setActiveProjectId(projectA);
    useBlueprintStore.getState().createBlueprint();
    useBlueprintStore.getState().beginRun('all');

    const persisted = partializeBlueprintStore(useBlueprintStore.getState());
    expect(persisted).not.toHaveProperty('executionLock');
    expect(persisted).not.toHaveProperty('abortController');
    expect(persisted).not.toHaveProperty('currentRun');
    expect(persisted.activeProjectId).toBe(projectA);
  });

  it('keeps project data isolated when changing active project', () => {
    useBlueprintStore.getState().setActiveProjectId(projectA);
    useBlueprintStore.getState().createBlueprint('A');
    useBlueprintStore.getState().setActiveProjectId('project-b');

    expect(
      useBlueprintStore
        .getState()
        .blueprints.filter((blueprint) => blueprint.projectId === 'project-b'),
    ).toEqual([]);
    expect(useBlueprintStore.getState().activeBlueprintId).toBeNull();
  });

  // ── Task recovery ─────────────────────────────────────────────

  describe('recoverVideoTasks', () => {
    const mockTask = {
      taskId: 'task-123',
      route: 'unified' as const,
      pollUrl: 'https://example.test/poll/task-123',
      model: 'test-model',
      serverTaskId: 'task-123',
    };

    function videoNode(
      id: string,
      execution?: {
        status: string;
        runId?: string;
        task?: typeof mockTask;
        startedAt?: number;
      },
    ): BlueprintNode {
      return {
        id,
        type: 'video-generator',
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'video-generator',
          label: `video (${id})`,
          config: { prompt: 'test prompt' },
          ...(execution ? { execution } : {}),
        },
      } as BlueprintNode;
    }

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns false when no active blueprint exists', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(false);
    });

    it('returns false when no video nodes have pending tasks', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(textNode('a'));
      useBlueprintStore.getState().addNode(
        videoNode('v', { status: 'completed', runId: 'r1' }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(false);
    });

    it('recovers running video nodes with task refs', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'old-run',
          task: mockTask,
          startedAt: Date.now() - 60_000,
        }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(true);

      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(1);
      expect(resumeFreedomVideoTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          route: 'unified',
          pollUrl: 'https://example.test/poll/task-123',
          prompt: 'test prompt',
        }),
      );

      // Node should be marked completed
      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      expect(node.data.execution?.status).toBe('completed');
      expect(node.data.execution?.output).toBeDefined();
    });

    it('marks nodes as failed when resume throws', async () => {
      (resumeFreedomVideoTask as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('poll expired'),
      );

      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'old-run',
          task: mockTask,
        }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(true);

      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      expect(node.data.execution?.status).toBe('failed');
      expect(node.data.execution?.error).toBe('poll expired');
    });

    it('skips nodes without task refs', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', { status: 'running', runId: 'r1' }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(false);
      expect(resumeFreedomVideoTask).not.toHaveBeenCalled();
    });

    it('skips recovery when execution lock is held', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          task: mockTask,
        }),
      );

      // Simulate an active run
      useBlueprintStore.getState().beginRun('all');

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(false);
      expect(resumeFreedomVideoTask).not.toHaveBeenCalled();
    });

    it('recovers multiple video nodes in parallel', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');

      const task2 = { ...mockTask, taskId: 'task-456', serverTaskId: 'task-456' };
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          task: mockTask,
        }),
      );
      useBlueprintStore.getState().addNode(
        videoNode('v2', {
          status: 'running',
          runId: 'r1',
          task: task2,
        }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(true);
      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(2);

      // Both nodes should be completed
      const nodes = useBlueprintStore.getState().blueprints[0].nodes;
      expect(nodes[0].data.execution?.status).toBe('completed');
      expect(nodes[1].data.execution?.status).toBe('completed');
    });

    it('releases execution lock after recovery completes', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          task: mockTask,
        }),
      );

      expect(useBlueprintStore.getState().executionLock).toBe(false);
      await useBlueprintStore.getState().recoverVideoTasks();
      expect(useBlueprintStore.getState().executionLock).toBe(false);
    });

    it('cancelRecovery aborts the recovery process', async () => {
      // Use a promise that respects the signal so cancellation actually works
      (resumeFreedomVideoTask as ReturnType<typeof vi.fn>).mockImplementationOnce(
        (params: any) =>
          new Promise((resolve, reject) => {
            const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
            if (params.signal?.aborted) return onAbort();
            params.signal?.addEventListener('abort', onAbort, { once: true });
          }),
      );

      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          task: mockTask,
        }),
      );

      // Start recovery but cancel immediately
      const recoverPromise = useBlueprintStore.getState().recoverVideoTasks();
      // Let microtask queue flush so the mock starts listening
      await new Promise((r) => setTimeout(r, 0));
      useBlueprintStore.getState().cancelRecovery();

      const result = await recoverPromise;
      expect(result).toBe(true);

      // The cancelled node should end up as cancelled
      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      expect(node.data.execution?.status).toBe('cancelled');
    });
  });
});
