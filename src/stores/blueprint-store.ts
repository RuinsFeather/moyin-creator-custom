// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Blueprint store — project-scoped state management for blueprint graphs.
 *
 * ── Generation Chain Boundary (§9.3) ─────────────────────────────
 * This store manages blueprint documents and runtime state only.
 * Director, S-Class, and Storyboard-specific state (SplitScene,
 * ShotGroup, grid images, joint images) must NOT be stored here.
 * Those belong in their respective stores (director-store, sclass-store).
 * ─────────────────────────────────────────────────────────────────
 */

import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createProjectScopedStorage } from '@/lib/project-storage';
import { createEmptyBlueprintProject } from '@/lib/blueprint/blueprint-schema';
import {
  migrateBlueprintState,
  type PersistedBlueprintState,
} from '@/lib/blueprint/blueprint-migrations';
import { generateUUID } from '@/lib/utils';
import { useProjectStore } from '@/stores/project-store';
import {
  BLUEPRINT_SCHEMA_VERSION,
  type BlueprintEdge,
  type BlueprintNode,
  type BlueprintNodeData,
  type BlueprintNodeExecution,
  type BlueprintProject,
} from '@/types/blueprint';
import { resumeFreedomVideoTask } from '@/lib/freedom/freedom-api';
import {
  convertScriptToBlueprint,
  previewScriptToBlueprint,
  type ConvertScriptToBlueprintOptions,
  type ScriptToBlueprintResult,
} from '@/lib/blueprint/script-to-blueprint';
import { getStaleDownstreamNodes } from '@/lib/blueprint/input-merge';
import type { Shot } from '@/types/script';

export type BlueprintRunMode = 'node' | 'downstream' | 'all';

export interface BlueprintRunRequest {
  runId: string;
  blueprintId: string;
  mode: BlueprintRunMode;
  nodeId?: string;
  requestedAt: number;
}

export interface BlueprintStoreState extends PersistedBlueprintState {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  currentRun: BlueprintRunRequest | null;
  executionLock: boolean;
  abortController: AbortController | null;
  errorSummary: string[];
  recoveryAbortController: AbortController | null;
  /** 新手模式：隐藏视频生成器等高级节点和复杂端口 */
  beginnerMode: boolean;
}

export interface BlueprintStoreActions {
  setActiveProjectId: (projectId: string) => void;
  createBlueprint: (name?: string) => BlueprintProject;
  duplicateBlueprint: (blueprintId: string, name?: string) => BlueprintProject | null;
  renameBlueprint: (blueprintId: string, name: string) => void;
  archiveBlueprint: (blueprintId: string, archived?: boolean) => void;
  deleteBlueprint: (blueprintId: string) => void;
  setActiveBlueprint: (blueprintId: string | null) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  addNode: (node: BlueprintNode) => void;
  /**
   * 在蓝图中心附近（已存在节点下方）添加一个节点并选中。
   * 用于「分镜 → 蓝图」等从外部一次性放置节点的场景。
   */
  addNodeInCenter: (node: BlueprintNode) => void;
  updateNode: (nodeId: string, updates: Partial<BlueprintNodeData>) => void;
  removeNode: (nodeId: string) => void;
  applyNodesChange: (changes: NodeChange<BlueprintNode>[]) => void;
  addEdge: (edge: BlueprintEdge) => void;
  updateEdge: (edgeId: string, updates: Partial<BlueprintEdge>) => void;
  removeEdge: (edgeId: string) => void;
  applyEdgesChange: (changes: EdgeChange<BlueprintEdge>[]) => void;
  updateViewport: (viewport: Viewport) => void;
  markNodesStale: (nodeIds: string[]) => void;
  updateNodeExecution: (
    nodeId: string,
    execution: Partial<BlueprintNodeExecution> | undefined,
  ) => void;
  clearExecutionState: (blueprintId?: string) => void;
  beginRun: (
    mode: BlueprintRunMode,
    nodeId?: string,
    abortController?: AbortController,
  ) => BlueprintRunRequest | null;
  finishRun: (errorSummary?: string[]) => void;
  cancelRun: () => void;
  resetRuntimeState: () => void;
  /**
   * Scan active blueprint for video-generator nodes with pending tasks
   * (status=running + task ref present) and resume polling.
   * Returns true if recovery was started, false if skipped.
   */
  recoverVideoTasks: () => Promise<boolean>;
  /** Abort an in-flight recovery. */
  cancelRecovery: () => void;
  /** 切换新手模式 */
  toggleBeginnerMode: () => void;
  /**
   * Import script shots into a blueprint. Creates a new blueprint or
   * replaces an existing one's content with converted shot nodes.
   *
   * The import is a snapshot — it does NOT modify the original script.
   *
   * @param options - Conversion options (shots, rawScript, scriptProjectData, etc.)
   * @param target - 'new' creates a fresh blueprint; string ID replaces that blueprint's content.
   * @returns The conversion result with blueprint, diagnostics, and counts.
   */
  importFromScript: (
    options: Omit<ConvertScriptToBlueprintOptions, 'projectId' | 'existingBlueprintId'>,
    target?: 'new' | string,
  ) => ScriptToBlueprintResult;
  /**
   * Preview an import without creating any blueprint.
   * Returns shot counts, node counts, and diagnostics.
   */
  previewScriptImport: (
    options: Omit<ConvertScriptToBlueprintOptions, 'projectId' | 'mode'>,
  ) => ReturnType<typeof previewScriptToBlueprint>;
}

export type BlueprintStore = BlueprintStoreState & BlueprintStoreActions;

const runtimeInitialState: Omit<
  BlueprintStoreState,
  keyof PersistedBlueprintState
> = {
  selectedNodeId: null,
  selectedEdgeId: null,
  currentRun: null,
  executionLock: false,
  abortController: null,
  errorSummary: [],
  recoveryAbortController: null,
  beginnerMode: true,
};

function cloneSerializable<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function resetNodeExecution(node: BlueprintNode): BlueprintNode {
  const data = cloneSerializable(node.data);
  delete data.execution;
  return { ...cloneSerializable(node), data, selected: false };
}

export function duplicateBlueprintDocument(
  source: BlueprintProject,
  idFactory: () => string = generateUUID,
  now = Date.now(),
  name = `${source.name} 副本`,
): BlueprintProject {
  const nodeIdMap = new Map<string, string>();
  const nodes = source.nodes.map((node) => {
    const id = idFactory();
    nodeIdMap.set(node.id, id);
    return { ...resetNodeExecution(node), id };
  });
  const edges = source.edges.map((edge) => ({
    ...cloneSerializable(edge),
    id: idFactory(),
    source: nodeIdMap.get(edge.source) ?? edge.source,
    target: nodeIdMap.get(edge.target) ?? edge.target,
    selected: false,
  }));

  return {
    ...cloneSerializable(source),
    id: idFactory(),
    name,
    nodes,
    edges,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

function updateActiveBlueprint(
  state: BlueprintStoreState,
  updater: (blueprint: BlueprintProject) => BlueprintProject,
): Partial<BlueprintStoreState> {
  if (!state.activeBlueprintId) return {};
  return {
    blueprints: state.blueprints.map((blueprint) =>
      blueprint.id === state.activeBlueprintId ? updater(blueprint) : blueprint,
    ),
  };
}

function clearExecutionFromBlueprint(blueprint: BlueprintProject): BlueprintProject {
  return {
    ...blueprint,
    status: blueprint.status === 'archived' ? 'archived' : 'draft',
    nodes: blueprint.nodes.map(resetNodeExecution),
    updatedAt: Date.now(),
  };
}

export function partializeBlueprintStore(
  state: BlueprintStore,
): PersistedBlueprintState {
  return {
    schemaVersion: BLUEPRINT_SCHEMA_VERSION,
    activeProjectId: state.activeProjectId,
    activeBlueprintId: state.activeBlueprintId,
    blueprints: cloneSerializable(state.blueprints),
  };
}

export const useBlueprintStore = create<BlueprintStore>()(
  persist(
    (set, get) => ({
      schemaVersion: BLUEPRINT_SCHEMA_VERSION,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
      ...runtimeInitialState,

      setActiveProjectId: (projectId) => {
        set((state) => ({
          activeProjectId: projectId,
          blueprints: state.blueprints.filter(
            (blueprint) => blueprint.projectId === projectId,
          ),
          activeBlueprintId:
            state.blueprints.find(
              (blueprint) =>
                blueprint.id === state.activeBlueprintId &&
                blueprint.projectId === projectId,
            )?.id ??
            state.blueprints.find(
              (blueprint) =>
                blueprint.projectId === projectId && blueprint.status !== 'archived',
            )?.id ??
            null,
          ...runtimeInitialState,
        }));
      },

      createBlueprint: (name) => {
        const projectId = get().activeProjectId;
        if (!projectId) {
          throw new Error('创建蓝图前必须设置 activeProjectId');
        }
        const blueprint = createEmptyBlueprintProject(
          projectId,
          generateUUID(),
          name?.trim() || '未命名蓝图',
        );
        set((state) => ({
          blueprints: [blueprint, ...state.blueprints],
          activeBlueprintId: blueprint.id,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return blueprint;
      },

      duplicateBlueprint: (blueprintId, name) => {
        const state = get();
        const source = state.blueprints.find(
          (blueprint) =>
            blueprint.id === blueprintId &&
            blueprint.projectId === state.activeProjectId,
        );
        if (!source) return null;
        const duplicate = duplicateBlueprintDocument(
          source,
          generateUUID,
          Date.now(),
          name?.trim() || `${source.name} 副本`,
        );
        set((current) => ({
          blueprints: [duplicate, ...current.blueprints],
          activeBlueprintId: duplicate.id,
          selectedNodeId: null,
          selectedEdgeId: null,
        }));
        return duplicate;
      },

      renameBlueprint: (blueprintId, name) => {
        const normalizedName = name.trim();
        if (!normalizedName) return;
        set((state) => ({
          blueprints: state.blueprints.map((blueprint) =>
            blueprint.id === blueprintId &&
            blueprint.projectId === state.activeProjectId
              ? { ...blueprint, name: normalizedName, updatedAt: Date.now() }
              : blueprint,
          ),
        }));
      },

      archiveBlueprint: (blueprintId, archived = true) => {
        set((state) => {
          const blueprints = state.blueprints.map((blueprint) =>
            blueprint.id === blueprintId &&
            blueprint.projectId === state.activeProjectId
              ? {
                  ...blueprint,
                  status: archived ? ('archived' as const) : ('draft' as const),
                  updatedAt: Date.now(),
                }
              : blueprint,
          );
          const activeBlueprintId =
            archived && state.activeBlueprintId === blueprintId
              ? blueprints.find(
                  (blueprint) =>
                    blueprint.projectId === state.activeProjectId &&
                    blueprint.status !== 'archived',
                )?.id ?? null
              : state.activeBlueprintId;
          return { blueprints, activeBlueprintId };
        });
      },

      deleteBlueprint: (blueprintId) => {
        set((state) => {
          const belongsToActiveProject = state.blueprints.some(
            (blueprint) =>
              blueprint.id === blueprintId &&
              blueprint.projectId === state.activeProjectId,
          );
          if (!belongsToActiveProject) return {};
          const blueprints = state.blueprints.filter(
            (blueprint) => blueprint.id !== blueprintId,
          );
          return {
            blueprints,
            activeBlueprintId:
              state.activeBlueprintId === blueprintId
                ? blueprints.find(
                    (blueprint) =>
                      blueprint.projectId === state.activeProjectId &&
                      blueprint.status !== 'archived',
                  )?.id ?? null
                : state.activeBlueprintId,
            selectedNodeId: null,
            selectedEdgeId: null,
          };
        });
      },

      setActiveBlueprint: (blueprintId) => {
        const state = get();
        const validId = blueprintId
          ? state.blueprints.find(
              (blueprint) =>
                blueprint.id === blueprintId &&
                blueprint.projectId === state.activeProjectId,
            )?.id ?? null
          : null;
        set({
          activeBlueprintId: validId,
          selectedNodeId: null,
          selectedEdgeId: null,
        });
      },

      selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
      selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

      addNode: (node) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            nodes: blueprint.nodes.some((item) => item.id === node.id)
              ? blueprint.nodes
              : [...blueprint.nodes, node],
            updatedAt: Date.now(),
          })),
        );
      },

      addNodeInCenter: (node) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => {
            if (blueprint.nodes.some((item) => item.id === node.id)) {
              return { ...blueprint, updatedAt: Date.now() };
            }
            // 视口中心（flow 坐标系）作为放置起点
            const { viewport } = blueprint;
            const zoom = viewport.zoom || 1;
            const centerX = viewport.x + (typeof window !== 'undefined' ? window.innerWidth / 2 : 300) / zoom;
            const centerY = viewport.y + (typeof window !== 'undefined' ? window.innerHeight / 2 : 200) / zoom;
            // 若已有节点，放在已有内容下方，避免重合
            const maxY = blueprint.nodes.reduce((m, n) => Math.max(m, n.position.y), 0);
            const placed = {
              ...node,
              position: {
                x: blueprint.nodes.length ? centerX : node.position.x || centerX,
                y: blueprint.nodes.length ? maxY + 200 : node.position.y || centerY,
              },
            };
            return {
              ...blueprint,
              nodes: [...blueprint.nodes, placed],
              updatedAt: Date.now(),
            };
          }),
        );
        set((state) => ({
          selectedNodeId: node.id,
          selectedEdgeId: null,
        }));
      },

      updateNode: (nodeId, updates) => {
        set((state) => {
          const result = updateActiveBlueprint(state, (blueprint) => {
            const updatedNodes = blueprint.nodes.map((node) =>
              node.id === nodeId
                ? { ...node, data: { ...node.data, ...updates } }
                : node,
            );

            // ── Auto-stale propagation (§11.2) ────────────────────
            // When config changes on a completed node, mark all
            // downstream nodes as stale so the user knows to re-run.
            let nodes = updatedNodes;
            if (updates.config !== undefined) {
              const changedNode = updatedNodes.find((n) => n.id === nodeId);
              if (changedNode?.data.execution?.status === 'completed') {
                const staleIds = getStaleDownstreamNodes(
                  nodeId,
                  updatedNodes,
                  blueprint.edges,
                );
                // Also mark the changed node itself as stale
                staleIds.add(nodeId);
                const staleSet = staleIds;
                nodes = updatedNodes.map((n) =>
                  staleSet.has(n.id) && n.data.execution?.status === 'completed'
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          execution: { ...n.data.execution, status: 'stale' as const },
                        },
                      }
                    : n,
                );
              }
            }

            return {
              ...blueprint,
              nodes,
              updatedAt: Date.now(),
            };
          });
          return result;
        });
      },

      removeNode: (nodeId) => {
        set((state) => ({
          ...updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            nodes: blueprint.nodes.filter((node) => node.id !== nodeId),
            edges: blueprint.edges.filter(
              (edge) => edge.source !== nodeId && edge.target !== nodeId,
            ),
            updatedAt: Date.now(),
          })),
          selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
        }));
      },

      applyNodesChange: (changes) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            nodes: applyNodeChanges(changes, blueprint.nodes),
            updatedAt: Date.now(),
          })),
        );
      },

      addEdge: (edge) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            edges: blueprint.edges.some((item) => item.id === edge.id)
              ? blueprint.edges
              : [...blueprint.edges, edge],
            updatedAt: Date.now(),
          })),
        );
      },

      updateEdge: (edgeId, updates) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            edges: blueprint.edges.map((edge) =>
              edge.id === edgeId ? { ...edge, ...updates } : edge,
            ),
            updatedAt: Date.now(),
          })),
        );
      },

      removeEdge: (edgeId) => {
        set((state) => ({
          ...updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            edges: blueprint.edges.filter((edge) => edge.id !== edgeId),
            updatedAt: Date.now(),
          })),
          selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
        }));
      },

      applyEdgesChange: (changes) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            edges: applyEdgeChanges(changes, blueprint.edges),
            updatedAt: Date.now(),
          })),
        );
      },

      updateViewport: (viewport) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            viewport,
            updatedAt: Date.now(),
          })),
        );
      },

      markNodesStale: (nodeIds) => {
        const ids = new Set(nodeIds);
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            nodes: blueprint.nodes.map((node) =>
              ids.has(node.id)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      execution: {
                        ...node.data.execution,
                        status: 'stale',
                      },
                    },
                  }
                : node,
            ),
            updatedAt: Date.now(),
          })),
        );
      },

      updateNodeExecution: (nodeId, execution) => {
        set((state) =>
          updateActiveBlueprint(state, (blueprint) => ({
            ...blueprint,
            nodes: blueprint.nodes.map((node) => {
              if (node.id !== nodeId) return node;
              const data = { ...node.data };
              if (execution) {
                data.execution = {
                  ...data.execution,
                  ...execution,
                } as BlueprintNodeExecution;
              }
              else delete data.execution;
              return { ...node, data };
            }),
            updatedAt: Date.now(),
          })),
        );
      },

      clearExecutionState: (blueprintId) => {
        set((state) => ({
          blueprints: state.blueprints.map((blueprint) =>
            blueprint.id === (blueprintId ?? state.activeBlueprintId) &&
            blueprint.projectId === state.activeProjectId
              ? clearExecutionFromBlueprint(blueprint)
              : blueprint,
          ),
          ...runtimeInitialState,
        }));
      },

      beginRun: (mode, nodeId, abortController = new AbortController()) => {
        const state = get();
        if (state.executionLock || !state.activeBlueprintId) return null;
        if (mode !== 'all' && !nodeId) return null;
        const activeBlueprint = state.blueprints.find(
          (blueprint) =>
            blueprint.id === state.activeBlueprintId &&
            blueprint.projectId === state.activeProjectId,
        );
        if (!activeBlueprint) return null;
        if (nodeId && !activeBlueprint.nodes.some((node) => node.id === nodeId)) {
          return null;
        }
        const request: BlueprintRunRequest = {
          runId: generateUUID(),
          blueprintId: activeBlueprint.id,
          mode,
          nodeId,
          requestedAt: Date.now(),
        };
        set({
          currentRun: request,
          executionLock: true,
          abortController,
          errorSummary: [],
        });
        return request;
      },

      finishRun: (errorSummary = []) => {
        set({
          currentRun: null,
          executionLock: false,
          abortController: null,
          errorSummary,
        });
      },

      cancelRun: () => {
        const state = get();
        state.abortController?.abort();
        const runId = state.currentRun?.runId;
        set((current) => ({
          ...updateActiveBlueprint(current, (blueprint) => ({
            ...blueprint,
            status: blueprint.status === 'archived' ? 'archived' : 'draft',
            nodes: blueprint.nodes.map((node) =>
              runId &&
              node.data.execution?.runId === runId &&
              ['queued', 'running'].includes(node.data.execution.status)
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      execution: {
                        ...node.data.execution,
                        status: 'cancelled',
                        completedAt: Date.now(),
                      },
                    },
                  }
                : node,
            ),
            updatedAt: Date.now(),
          })),
          currentRun: null,
          executionLock: false,
          abortController: null,
        }));
      },

      recoverVideoTasks: async () => {
        const state = get();
        if (state.executionLock) return false;

        const activeBlueprint = state.blueprints.find(
          (bp) =>
            bp.id === state.activeBlueprintId &&
            bp.projectId === state.activeProjectId,
        );
        if (!activeBlueprint) return false;

        // Find video-generator nodes with pending tasks
        const recoverable = activeBlueprint.nodes.filter((node) => {
          if (node.data.nodeType !== 'video-generator') return false;
          const exec = node.data.execution;
          return exec?.status === 'running' && exec.task;
        });

        if (recoverable.length === 0) return false;

        const controller = new AbortController();
        set({ executionLock: true, recoveryAbortController: controller });
        const projectId = state.activeProjectId;

        const promises = recoverable.map(async (node) => {
          const exec = node.data.execution!;
          const task = exec.task!;
          const cfg = node.data.config as { prompt?: string };

          try {
            const result = await resumeFreedomVideoTask({
              taskId: task.taskId,
              route: task.route,
              pollUrl: task.pollUrl,
              model: task.model,
              prompt: cfg.prompt ?? '',
              projectId,
              signal: controller.signal,
            });

            get().updateNodeExecution(node.id, {
              ...exec,
              status: 'completed',
              runId: exec.runId,
              startedAt: exec.startedAt,
              completedAt: Date.now(),
              output: {
                url: result.url,
                mediaId: result.mediaId,
                mimeType: 'video/mp4',
                dedupeKey: `vid-${node.id}-${result.taskId ?? Date.now()}`,
                taskId: result.taskId,
              },
            });
          } catch (err) {
            if (controller.signal.aborted) {
              get().updateNodeExecution(node.id, {
                ...exec,
                status: 'cancelled',
                completedAt: Date.now(),
              });
            } else {
              const msg = err instanceof Error ? err.message : String(err);
              console.warn('[Blueprint] Task recovery failed for node', node.id, msg);
              get().updateNodeExecution(node.id, {
                ...exec,
                status: 'failed',
                error: msg,
                completedAt: Date.now(),
              });
            }
          }
        });

        try {
          await Promise.allSettled(promises);
        } finally {
          set({ executionLock: false, recoveryAbortController: null });
        }

        // Record recovery outcome (P1-4 异常指标)
        try {
          const { recordTaskRecovery } = await import(
            '@/lib/blueprint/execution-metrics'
          );
          recordTaskRecovery({
            timestamp: Date.now(),
            ok: true,
            nodeCount: recoverable.length,
          });
        } catch {
          // metrics must never break recovery
        }

        return true;
      },

      cancelRecovery: () => {
        const state = get();
        state.recoveryAbortController?.abort();
      },

      toggleBeginnerMode: () => {
        set((s) => ({ beginnerMode: !s.beginnerMode }));
      },

      importFromScript: (options, target = 'new') => {
        const projectId = get().activeProjectId;
        if (!projectId) {
          throw new Error('导入蓝图前必须设置 activeProjectId');
        }

        // Determine existing blueprint ID for replacement
        const existingBlueprintId =
          typeof target === 'string' && target !== 'new' ? target : undefined;

        const result = convertScriptToBlueprint({
          ...options,
          projectId,
          existingBlueprintId,
        });

        if (existingBlueprintId) {
          // Replace existing blueprint content
          set((state) => ({
            blueprints: state.blueprints.map((bp) =>
              bp.id === existingBlueprintId ? result.blueprint : bp,
            ),
            activeBlueprintId: existingBlueprintId,
            selectedNodeId: null,
            selectedEdgeId: null,
          }));
        } else {
          // Create new blueprint
          set((state) => ({
            blueprints: [result.blueprint, ...state.blueprints],
            activeBlueprintId: result.blueprint.id,
            selectedNodeId: null,
            selectedEdgeId: null,
          }));
        }

        return result;
      },

      previewScriptImport: (options) => {
        const projectId = get().activeProjectId;
        if (!projectId) {
          throw new Error('预览导入前必须设置 activeProjectId');
        }
        return previewScriptToBlueprint({
          ...options,
          projectId,
        });
      },

      resetRuntimeState: () => {
        const state = get();
        state.recoveryAbortController?.abort();
        set(runtimeInitialState);
      },
    }),
    {
      name: 'moyin-blueprint-store',
      version: BLUEPRINT_SCHEMA_VERSION,
      storage: createJSONStorage(() => createProjectScopedStorage('blueprint')),
      partialize: partializeBlueprintStore,
      migrate: (persistedState, persistedVersion) =>
        migrateBlueprintState(persistedState, persistedVersion),
      merge: (persistedState, currentState) => {
        const persisted = migrateBlueprintState(
          persistedState,
          BLUEPRINT_SCHEMA_VERSION,
        );
        const activeProjectId =
          useProjectStore.getState().activeProjectId ?? currentState.activeProjectId;
        return {
          ...currentState,
          ...persisted,
          activeProjectId,
          blueprints: persisted.blueprints.filter(
            (blueprint) => blueprint.projectId === activeProjectId,
          ),
          activeBlueprintId:
            persisted.blueprints.find(
              (blueprint) =>
                blueprint.projectId === activeProjectId &&
                blueprint.id === persisted.activeBlueprintId,
            )?.id ?? null,
          ...runtimeInitialState,
        };
      },
    },
  ),
);

export const selectActiveBlueprint = (
  state: BlueprintStore,
): BlueprintProject | null =>
  state.blueprints.find(
    (blueprint) =>
      blueprint.id === state.activeBlueprintId &&
      blueprint.projectId === state.activeProjectId,
  ) ?? null;
