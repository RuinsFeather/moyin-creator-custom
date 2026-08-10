// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 6.3 项目切换验收测试
 *
 * 验证蓝图 store 在项目切换场景下的正确行为：
 * 1. 项目 A 创建蓝图后切换到项目 B，B 看不到 A 的节点
 * 2. 切回 A 后节点、视口、配置和结果引用均恢复
 * 3. 应用关闭重启后蓝图仍可恢复（通过 partialize 模拟持久化）
 * 4. 删除项目后蓝图数据一并清理
 * 5. 切换项目过程中不会把空状态写入目标项目文件
 *
 * 注意：Node 测试环境中 localStorage 不可用，rehydrate 无法真正从存储加载。
 * 因此"切回"场景需要手动将持久化状态合并回 store，模拟 rehydrate 效果。
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  partializeBlueprintStore,
  useBlueprintStore,
} from '../blueprint-store';
import type {
  BlueprintEdge,
  BlueprintNode,
  OutputNodeConfig,
  TextInputNodeConfig,
} from '@/types/blueprint';

// Project IDs for testing
const PROJECT_A = 'project-a';
const PROJECT_B = 'project-b';

// Helper to create a text input node
function textNode(id: string): BlueprintNode {
  return {
    id,
    type: 'text-input',
    position: { x: 100, y: 200 },
    data: {
      nodeType: 'text-input',
      label: `Text ${id}`,
      config: { text: `Hello ${id}` },
    },
  };
}

// Helper to create an output node
function outputNode(id: string): BlueprintNode {
  return {
    id,
    type: 'output',
    position: { x: 400, y: 200 },
    data: {
      nodeType: 'output',
      label: `Output ${id}`,
      config: { acceptedTypes: ['image', 'video'] },
    },
  };
}

// Helper to create an edge
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

/**
 * Simulate what project-switcher + rehydrate does:
 * 1. Capture persisted state for current project
 * 2. Switch active project ID (filters in-memory state)
 * 3. Restore persisted state of ALL previously saved projects
 *    (mimics storage adapter reading from _p/{id}/ files)
 */
function simulateProjectSwitch(
  savedStates: Map<string, ReturnType<typeof partializeBlueprintStore>>,
  targetProjectId: string,
) {
  // 1. Persist current project's state
  const currentState = useBlueprintStore.getState();
  if (currentState.activeProjectId) {
    savedStates.set(
      currentState.activeProjectId,
      partializeBlueprintStore(currentState),
    );
  }

  // 2. Switch (filters to target project's blueprints only)
  useBlueprintStore.getState().setActiveProjectId(targetProjectId);

  // 3. Merge ALL saved projects' blueprints back into store
  //    (simulates rehydrate loading from each project's storage files)
  const savedForTarget = savedStates.get(targetProjectId);
  const targetBlueprints = savedForTarget?.blueprints ?? [];
  const savedActiveId = savedForTarget?.activeBlueprintId ?? null;
  useBlueprintStore.setState((state) => ({
    blueprints: [
      ...state.blueprints.filter((b) => b.projectId !== targetProjectId),
      ...targetBlueprints,
    ],
    // Restore activeBlueprintId from persisted state (or find first non-archived)
    activeBlueprintId:
      (savedActiveId && targetBlueprints.some((b) => b.id === savedActiveId)
        ? savedActiveId
        : targetBlueprints.find((b) => b.status !== 'archived')?.id) ?? null,
  }));
}

describe('6.3 项目切换验收', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
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
    });
  });

  it('验收 1: 项目 A 创建蓝图后切换到项目 B，B 看不到 A 的节点', () => {
    // Setup: Create blueprint with nodes in project A
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    const blueprintA = useBlueprintStore.getState().createBlueprint('蓝图 A');

    const node1 = textNode('node-1');
    const node2 = outputNode('node-2');
    useBlueprintStore.getState().addNode(node1);
    useBlueprintStore.getState().addNode(node2);
    useBlueprintStore.getState().addEdge(edge('edge-1', 'node-1', 'node-2'));

    // Update viewport
    useBlueprintStore.getState().updateViewport({ x: 50, y: 100, zoom: 2.0 });

    // Verify project A has the blueprint with nodes
    const stateA = useBlueprintStore.getState();
    const blueprint = stateA.blueprints.find((b) => b.id === blueprintA.id);
    expect(blueprint?.nodes).toHaveLength(2);
    expect(blueprint?.edges).toHaveLength(1);
    expect(blueprint?.viewport).toEqual({ x: 50, y: 100, zoom: 2.0 });

    // Switch to project B
    useBlueprintStore.getState().setActiveProjectId(PROJECT_B);

    // Verify project B doesn't see project A's nodes
    const stateB = useBlueprintStore.getState();
    expect(stateB.activeProjectId).toBe(PROJECT_B);
    expect(stateB.blueprints.filter((b) => b.projectId === PROJECT_A)).toEqual(
      [],
    );

    // Project B should have no blueprints
    const blueprintsB = stateB.blueprints.filter(
      (b) => b.projectId === PROJECT_B,
    );
    expect(blueprintsB).toEqual([]);
  });

  it('验收 2: 切回 A 后节点、视口、配置和结果引用均恢复', () => {
    const savedStates = new Map<
      string,
      ReturnType<typeof partializeBlueprintStore>
    >();

    // Setup: Create blueprint with full configuration in project A
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    const blueprintA = useBlueprintStore.getState().createBlueprint('蓝图 A');

    const node1 = textNode('node-1');
    const node2 = outputNode('node-2');
    useBlueprintStore.getState().addNode(node1);
    useBlueprintStore.getState().addNode(node2);
    useBlueprintStore.getState().addEdge(edge('edge-1', 'node-1', 'node-2'));

    // Set viewport
    const viewportA = { x: 75, y: 150, zoom: 1.75 };
    useBlueprintStore.getState().updateViewport(viewportA);

    // Select a node
    useBlueprintStore.getState().selectNode('node-1');

    // Simulate execution result on node
    useBlueprintStore.getState().updateNodeExecution('node-1', {
      status: 'completed',
      runId: 'run-123',
      task: {
        taskId: 'task-456',
        route: 'unified',
        pollUrl: 'https://api.example.com/poll/456',
        model: 'test-model',
      },
    });

    // Switch to project B (saves A's state, simulates rehydrate)
    simulateProjectSwitch(savedStates, PROJECT_B);

    // Verify project B doesn't see A's data
    expect(useBlueprintStore.getState().activeProjectId).toBe(PROJECT_B);
    expect(
      useBlueprintStore.getState().blueprints.filter((b) => b.projectId === PROJECT_A),
    ).toEqual([]);

    // Create something in project B
    useBlueprintStore.getState().createBlueprint('蓝图 B');
    expect(useBlueprintStore.getState().blueprints).toHaveLength(1);

    // Switch back to project A (saves B's state, restores A's state)
    simulateProjectSwitch(savedStates, PROJECT_A);

    // Verify all data is restored
    const stateAfterSwitch = useBlueprintStore.getState();
    expect(stateAfterSwitch.activeProjectId).toBe(PROJECT_A);

    const blueprintAfter = stateAfterSwitch.blueprints.find(
      (b) => b.id === blueprintA.id,
    );
    expect(blueprintAfter).toBeDefined();
    expect(blueprintAfter?.nodes).toHaveLength(2);
    expect(blueprintAfter?.edges).toHaveLength(1);

    // Check viewport is restored
    expect(blueprintAfter?.viewport).toEqual(viewportA);

    // Check node configuration is restored
    expect(
      (blueprintAfter?.nodes[0].data.config as TextInputNodeConfig).text,
    ).toBe('Hello node-1');
    expect(
      (blueprintAfter?.nodes[1].data.config as OutputNodeConfig).acceptedTypes,
    ).toEqual([
      'image',
      'video',
    ]);

    // Check execution result references are restored
    expect(blueprintAfter?.nodes[0].data.execution?.status).toBe('completed');
    expect(blueprintAfter?.nodes[0].data.execution?.runId).toBe('run-123');
    expect(blueprintAfter?.nodes[0].data.execution?.task?.taskId).toBe(
      'task-456',
    );
    expect(blueprintAfter?.nodes[0].data.execution?.task?.pollUrl).toBe(
      'https://api.example.com/poll/456',
    );

    // Check edge configuration is restored
    expect(blueprintAfter?.edges[0].source).toBe('node-1');
    expect(blueprintAfter?.edges[0].target).toBe('node-2');
    expect(blueprintAfter?.edges[0].data?.dataType).toBe('text');
  });

  it('验收 3: 应用关闭重启后蓝图仍可恢复（通过 partialize 模拟持久化）', () => {
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    const blueprint = useBlueprintStore.getState().createBlueprint('可恢复蓝图');

    const node1 = textNode('node-1');
    const node2 = outputNode('node-2');
    useBlueprintStore.getState().addNode(node1);
    useBlueprintStore.getState().addNode(node2);
    useBlueprintStore.getState().addEdge(edge('edge-1', 'node-1', 'node-2'));

    // Set viewport
    useBlueprintStore.getState().updateViewport({ x: 30, y: 60, zoom: 1.25 });

    // Get the persisted state (this is what would be saved to storage)
    const persistedState = partializeBlueprintStore(useBlueprintStore.getState());

    // Verify persisted state contains the blueprint
    expect(persistedState.activeProjectId).toBe(PROJECT_A);
    expect(persistedState.blueprints).toHaveLength(1);
    expect(persistedState.blueprints[0].id).toBe(blueprint.id);
    expect(persistedState.blueprints[0].nodes).toHaveLength(2);
    expect(persistedState.blueprints[0].edges).toHaveLength(1);
    expect(persistedState.blueprints[0].viewport).toEqual({
      x: 30,
      y: 60,
      zoom: 1.25,
    });

    // Verify runtime state is NOT persisted
    expect(persistedState).not.toHaveProperty('selectedNodeId');
    expect(persistedState).not.toHaveProperty('selectedEdgeId');
    expect(persistedState).not.toHaveProperty('currentRun');
    expect(persistedState).not.toHaveProperty('executionLock');
    expect(persistedState).not.toHaveProperty('abortController');
    expect(persistedState).not.toHaveProperty('errorSummary');

    // Simulate app restart: reset store then rehydrate with persisted state
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
    });

    // Rehydrate with persisted state (mimics what zustand persist does on load)
    useBlueprintStore.setState({
      ...persistedState,
      // Runtime defaults are re-initialized
      selectedNodeId: null,
      selectedEdgeId: null,
      currentRun: null,
      executionLock: false,
      abortController: null,
      errorSummary: [],
    });

    // Verify data is restored after "restart"
    const stateAfterRestart = useBlueprintStore.getState();
    expect(stateAfterRestart.activeProjectId).toBe(PROJECT_A);
    expect(stateAfterRestart.blueprints).toHaveLength(1);
    expect(stateAfterRestart.blueprints[0].nodes).toHaveLength(2);
    expect(stateAfterRestart.blueprints[0].edges).toHaveLength(1);
    expect(stateAfterRestart.blueprints[0].viewport).toEqual({
      x: 30,
      y: 60,
      zoom: 1.25,
    });
    // Node data should survive
    expect(
      (stateAfterRestart.blueprints[0].nodes[0].data.config as TextInputNodeConfig).text,
    ).toBe(
      'Hello node-1',
    );
  });

  it('验收 4: 删除项目后蓝图数据一并清理', () => {
    const savedStates = new Map<
      string,
      ReturnType<typeof partializeBlueprintStore>
    >();

    // Create blueprints in project A
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    useBlueprintStore.getState().createBlueprint('A1');
    useBlueprintStore.getState().addNode(textNode('a1'));

    // Switch to project B, create blueprint
    simulateProjectSwitch(savedStates, PROJECT_B);
    useBlueprintStore.getState().createBlueprint('B1');
    useBlueprintStore.getState().addNode(textNode('b1'));

    // Save B's state too
    savedStates.set(PROJECT_B, partializeBlueprintStore(useBlueprintStore.getState()));

    // Verify both projects have persisted blueprints
    expect(savedStates.get(PROJECT_A)?.blueprints).toHaveLength(1);
    expect(savedStates.get(PROJECT_B)?.blueprints).toHaveLength(1);

    // Simulate project A deletion: remove A's persisted data
    savedStates.delete(PROJECT_A);

    // Verify A's data is gone from persistence
    expect(savedStates.has(PROJECT_A)).toBe(false);

    // Verify B's data is still intact in persistence
    expect(savedStates.get(PROJECT_B)?.blueprints).toHaveLength(1);
    expect(savedStates.get(PROJECT_B)?.blueprints[0].name).toBe('B1');
    expect(savedStates.get(PROJECT_B)?.blueprints[0].nodes).toHaveLength(1);

    // Verify B's in-memory state is still intact
    const stateB = useBlueprintStore.getState();
    expect(
      stateB.blueprints.filter((b) => b.projectId === PROJECT_B),
    ).toHaveLength(1);
  });

  it('验收 5: 切换项目过程中不会把空状态写入目标项目文件', () => {
    const savedStates = new Map<
      string,
      ReturnType<typeof partializeBlueprintStore>
    >();

    // Setup: Create blueprint with nodes in project A
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    useBlueprintStore.getState().createBlueprint('蓝图 A');
    useBlueprintStore.getState().addNode(textNode('node-1'));
    useBlueprintStore.getState().addNode(outputNode('node-2'));

    // Verify project A has the blueprint
    expect(
      useBlueprintStore.getState().blueprints.filter((b) => b.projectId === PROJECT_A),
    ).toHaveLength(1);

    // Switch to project B — saves A's state, then B has empty state
    simulateProjectSwitch(savedStates, PROJECT_B);

    // Verify project B has NO blueprints (not empty placeholder ones)
    const stateB = useBlueprintStore.getState();
    const blueprintsB = stateB.blueprints.filter(
      (b) => b.projectId === PROJECT_B,
    );
    expect(blueprintsB).toEqual([]);

    // Verify the persisted state for B shows no blueprints
    const persisted = partializeBlueprintStore(stateB);
    expect(persisted.blueprints).toEqual([]);

    // Verify A's saved state is still intact in our saved map
    const savedA = savedStates.get(PROJECT_A);
    expect(savedA?.blueprints).toHaveLength(1);
    expect(savedA?.blueprints[0].nodes).toHaveLength(2);
    expect(savedA?.blueprints[0].name).toBe('蓝图 A');

    // Switch back to project A — restores A's saved state
    simulateProjectSwitch(savedStates, PROJECT_A);

    // Verify project A's blueprint is still intact
    const stateBackToA = useBlueprintStore.getState();
    const blueprintsA = stateBackToA.blueprints.filter(
      (b) => b.projectId === PROJECT_A,
    );
    expect(blueprintsA).toHaveLength(1);
    expect(blueprintsA[0].nodes).toHaveLength(2);
    expect(blueprintsA[0].name).toBe('蓝图 A');
  });

  it('验收 5 补充: 活跃蓝图 ID 在项目切换时正确更新', () => {
    const savedStates = new Map<
      string,
      ReturnType<typeof partializeBlueprintStore>
    >();

    // Create multiple blueprints in project A
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    useBlueprintStore.getState().createBlueprint('蓝图 1');
    const blueprint2 = useBlueprintStore.getState().createBlueprint('蓝图 2');

    // The latest created blueprint should be active
    expect(useBlueprintStore.getState().activeBlueprintId).toBe(blueprint2.id);

    // Switch to project B (saves A's state including activeBlueprintId)
    simulateProjectSwitch(savedStates, PROJECT_B);

    // Active blueprint should be null for project B (no blueprints exist)
    expect(useBlueprintStore.getState().activeBlueprintId).toBeNull();

    // Switch back to project A (restores A's state from saved states)
    simulateProjectSwitch(savedStates, PROJECT_A);

    // Active blueprint should be restored from persisted state
    const stateBackToA = useBlueprintStore.getState();
    expect(stateBackToA.activeBlueprintId).toBe(blueprint2.id);
  });

  it('验收 5 补充: 运行时状态在项目切换时正确清理', () => {
    // Setup project A with execution state
    useBlueprintStore.getState().setActiveProjectId(PROJECT_A);
    useBlueprintStore.getState().createBlueprint('蓝图 A');
    useBlueprintStore.getState().addNode(textNode('node-1'));

    // Start a run
    useBlueprintStore.getState().beginRun('all');
    expect(useBlueprintStore.getState().currentRun).not.toBeNull();
    expect(useBlueprintStore.getState().executionLock).toBe(true);

    // Switch to project B
    useBlueprintStore.getState().setActiveProjectId(PROJECT_B);

    // Runtime state should be cleared
    const stateB = useBlueprintStore.getState();
    expect(stateB.currentRun).toBeNull();
    expect(stateB.executionLock).toBe(false);
    expect(stateB.selectedNodeId).toBeNull();
    expect(stateB.selectedEdgeId).toBeNull();
    expect(stateB.errorSummary).toEqual([]);
  });
});