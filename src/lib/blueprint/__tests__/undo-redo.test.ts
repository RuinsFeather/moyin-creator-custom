// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  undo,
  redo,
  canUndo,
  canRedo,
  clearUndoHistory,
  pauseTracking,
  resumeTracking,
} from '@/lib/blueprint/undo-redo';
import type { BlueprintEdge, BlueprintNode, BlueprintNodeExecution } from '@/types/blueprint';

vi.mock('@/lib/freedom/freedom-api', () => ({
  resumeFreedomVideoTask: vi.fn().mockResolvedValue({
    url: 'https://example.com/recovered.mp4',
    mediaId: 'media-1',
    taskId: 'task-1',
  }),
}));

const PROJECT = 'proj-1';

function textNode(id: string, text = 'hello'): BlueprintNode {
  return {
    id,
    type: 'text-input',
    position: { x: 0, y: 0 },
    data: { nodeType: 'text-input', label: id, config: { text } },
  };
}

function outputNode(id: string): BlueprintNode {
  return {
    id,
    type: 'output',
    position: { x: 200, y: 0 },
    data: { nodeType: 'output', label: id, config: { acceptedTypes: ['image', 'video'] } },
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

function setupStore() {
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
  clearUndoHistory();
  useBlueprintStore.getState().setActiveProjectId(PROJECT);
  useBlueprintStore.getState().createBlueprint('测试蓝图');
}

describe('undo-redo (§11.1)', () => {
  beforeEach(() => {
    setupStore();
  });

  // ── Basic undo/redo ──────────────────────────────────────────────────

  describe('node operations', () => {
    it('undoes addNode', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      expect(selectNodes()).toHaveLength(1);

      undo();
      expect(selectNodes()).toHaveLength(0);
    });

    it('redoes addNode after undo', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      undo();
      expect(selectNodes()).toHaveLength(0);

      redo();
      expect(selectNodes()).toHaveLength(1);
      expect(selectNodes()[0].id).toBe('n1');
    });

    it('undoes updateNode', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1', 'original'));
      store.updateNode('n1', { config: { text: 'changed' } });
      expect((selectNodes()[0].data.config as { text: string }).text).toBe('changed');

      undo();
      expect((selectNodes()[0].data.config as { text: string }).text).toBe('original');
    });

    it('undoes removeNode', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      store.addNode(outputNode('n2'));
      store.removeNode('n1');
      expect(selectNodes()).toHaveLength(1);

      undo();
      expect(selectNodes()).toHaveLength(2);
    });
  });

  describe('edge operations', () => {
    it('undoes addEdge', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      store.addNode(outputNode('n2'));
      store.addEdge(edge('e1', 'n1', 'n2'));
      expect(selectEdges()).toHaveLength(1);

      undo();
      expect(selectEdges()).toHaveLength(0);
    });

    it('undoes removeEdge', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      store.addNode(outputNode('n2'));
      store.addEdge(edge('e1', 'n1', 'n2'));
      store.removeEdge('e1');
      expect(selectEdges()).toHaveLength(0);

      undo();
      expect(selectEdges()).toHaveLength(1);
    });
  });

  describe('viewport', () => {
    it('undoes viewport change', () => {
      const store = useBlueprintStore.getState();
      store.updateViewport({ x: 100, y: 200, zoom: 2 });

      undo();
      const bp = selectActiveBlueprint();
      expect(bp?.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  // ── History management ───────────────────────────────────────────────

  describe('canUndo / canRedo', () => {
    it('returns false when no history', () => {
      expect(canUndo()).toBe(false);
      expect(canRedo()).toBe(false);
    });

    it('canUndo returns true after a change', () => {
      useBlueprintStore.getState().addNode(textNode('n1'));
      expect(canUndo()).toBe(true);
    });

    it('canRedo returns true after undo', () => {
      useBlueprintStore.getState().addNode(textNode('n1'));
      undo();
      expect(canRedo()).toBe(true);
    });

    it('canRedo returns false after a new change clears future', () => {
      useBlueprintStore.getState().addNode(textNode('n1'));
      undo();
      useBlueprintStore.getState().addNode(textNode('n2'));
      expect(canRedo()).toBe(false);
    });
  });

  describe('clearUndoHistory', () => {
    it('clears all history', () => {
      useBlueprintStore.getState().addNode(textNode('n1'));
      useBlueprintStore.getState().addNode(textNode('n2'));
      expect(canUndo()).toBe(true);

      clearUndoHistory();
      expect(canUndo()).toBe(false);
      expect(canRedo()).toBe(false);
    });
  });

  describe('project/blueprint switch clears history', () => {
    it('setActiveProjectId clears history', () => {
      useBlueprintStore.getState().addNode(textNode('n1'));
      expect(canUndo()).toBe(true);

      useBlueprintStore.getState().setActiveProjectId('other-project');
      expect(canUndo()).toBe(false);
    });

    it('setActiveBlueprint clears history', () => {
      const bp1Id = useBlueprintStore.getState().activeBlueprintId!;
      useBlueprintStore.getState().addNode(textNode('n1'));
      expect(canUndo()).toBe(true);

      // createBlueprint auto-switches to the new blueprint (clears history)
      const bp2 = useBlueprintStore.getState().createBlueprint('第二个');
      expect(canUndo()).toBe(false);

      // Add something to bp2's history, then switch back to bp1
      useBlueprintStore.getState().addNode(textNode('n2'));
      expect(canUndo()).toBe(true);

      useBlueprintStore.getState().setActiveBlueprint(bp1Id);
      expect(canUndo()).toBe(false);
    });
  });

  // ── Execution data exclusion ─────────────────────────────────────────

  describe('execution data stripped from history', () => {
    it('undo does not restore execution state', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));

      // Simulate execution completing
      const execution: BlueprintNodeExecution = {
        runId: 'run-1',
        status: 'completed',
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
        output: {
          url: 'https://example.com/img.png',
          mediaId: 'media-1',
          mimeType: 'image/png',
          dedupeKey: 'dedup-1',
        },
      };
      store.updateNodeExecution('n1', execution);
      expect(selectNodes()[0].data.execution?.status).toBe('completed');

      // Undo the execution update — should revert to state without execution
      undo();
      // The node should still exist (execution update doesn't change nodes pointer
      // in the temporal sense since it goes through updateNodeExecution which
      // uses updateActiveBlueprint). Verify the execution is gone.
      expect(selectNodes()[0].data.execution).toBeUndefined();
    });
  });

  // ── Stale propagation ────────────────────────────────────────────────

  describe('stale propagation on undo', () => {
    it('marks completed nodes stale when config changes via undo', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1', 'prompt-v1'));

      // Simulate completion
      store.updateNodeExecution('n1', {
        runId: 'run-1',
        status: 'completed',
        startedAt: Date.now() - 1000,
        completedAt: Date.now(),
      });

      // Change prompt (this is the action we'll undo)
      store.updateNode('n1', { config: { text: 'prompt-v2' } });

      // Undo the prompt change — config reverts but execution was with v2,
      // so node should be marked stale
      undo();

      const node = selectNodes().find((n) => n.id === 'n1');
      expect(node?.data.execution?.status).toBe('stale');
    });
  });

  // ── Pause / Resume ───────────────────────────────────────────────────

  describe('pause/resume tracking', () => {
    it('paused changes are not recorded', () => {
      pauseTracking();
      useBlueprintStore.getState().addNode(textNode('n1'));
      expect(canUndo()).toBe(false);

      resumeTracking();
      useBlueprintStore.getState().addNode(textNode('n2'));
      expect(canUndo()).toBe(true);
    });
  });

  // ── Multi-step undo/redo ─────────────────────────────────────────────

  describe('multi-step undo/redo', () => {
    it('undoes multiple steps', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));
      store.addNode(textNode('n2'));
      store.addNode(textNode('n3'));
      expect(selectNodes()).toHaveLength(3);

      undo(2);
      expect(selectNodes()).toHaveLength(1);
    });
  });

  // ── Non-editable actions don't pollute history ───────────────────────

  describe('selection changes do not create history entries', () => {
    it('selectNode does not create undo entry', () => {
      const store = useBlueprintStore.getState();
      store.addNode(textNode('n1'));

      // Select/deselect should not create history entries since
      // selectedNodeId is not tracked by temporal
      store.selectNode('n1');
      store.selectNode(null);
      store.selectEdge('some-edge');

      // Only the addNode should be in history
      undo();
      expect(selectNodes()).toHaveLength(0);
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────

function selectActiveBlueprint() {
  const state = useBlueprintStore.getState();
  return state.blueprints.find(
    (bp) => bp.id === state.activeBlueprintId && bp.projectId === state.activeProjectId,
  ) ?? null;
}

function selectNodes() {
  return selectActiveBlueprint()?.nodes ?? [];
}

function selectEdges() {
  return selectActiveBlueprint()?.edges ?? [];
}
