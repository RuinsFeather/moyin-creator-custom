// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  type IsValidConnection,
  type NodeMouseHandler,
  BackgroundVariant,
  type ColorMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useBlueprintStore } from '@/stores/blueprint-store';
import {
  BLUEPRINT_NODE_PORTS,
  type BlueprintDataType,
  type BlueprintEdgeData,
  type BlueprintNodeType,
  type BlueprintNode,
  type BlueprintEdge,
} from '@/types/blueprint';
import { canConnectBlueprintPorts } from '@/lib/blueprint/blueprint-schema';
import { generateUUID } from '@/lib/utils';
import { blueprintNodeTypes } from './nodes';

/** Find the port data types for a given node type + handle ID. */
function getPortDataTypes(
  nodeType: BlueprintNodeType,
  handleId: string,
  direction: 'input' | 'output',
): readonly BlueprintDataType[] | undefined {
  const ports = BLUEPRINT_NODE_PORTS[nodeType];
  const port = ports.find((p) => p.id === handleId && p.direction === direction);
  return port?.dataTypes;
}

/**
 * BlueprintCanvas — the main React Flow canvas for blueprint editing.
 *
 * Architecture:
 * - Reads nodes/edges from the blueprint store (single source of truth).
 * - Dispatches changes back through store actions (`applyNodesChange`, `applyEdgesChange`, `addEdge`).
 * - Validates connections before allowing them (port types, self-loops, duplicates).
 * - Node components are memoized to minimize re-renders.
 */
export function BlueprintCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Store selectors (fine-grained to avoid unnecessary re-renders) ──────
  const activeBlueprintId = useBlueprintStore((s) => s.activeBlueprintId);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const applyNodesChange = useBlueprintStore((s) => s.applyNodesChange);
  const applyEdgesChange = useBlueprintStore((s) => s.applyEdgesChange);
  const addEdge = useBlueprintStore((s) => s.addEdge);
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const selectEdge = useBlueprintStore((s) => s.selectEdge);
  const updateViewport = useBlueprintStore((s) => s.updateViewport);

  // ── Derive active blueprint data ────────────────────────────────────────
  const activeBlueprint = useMemo(
    () => blueprints.find((b) => b.id === activeBlueprintId) ?? null,
    [blueprints, activeBlueprintId],
  );

  const nodes = activeBlueprint?.nodes ?? [];
  const edges = activeBlueprint?.edges ?? [];
  const viewport = activeBlueprint?.viewport ?? { x: 0, y: 0, zoom: 1 };

  // ── Build a lookup map for node types (used in connection validation) ───
  const nodeTypeMap = useMemo(() => {
    const map = new Map<string, BlueprintNodeType>();
    for (const node of nodes) {
      map.set(node.id, node.data.nodeType);
    }
    return map;
  }, [nodes]);

  // ── Event handlers ──────────────────────────────────────────────────────

  const onNodesChange: OnNodesChange<BlueprintNode> = useCallback(
    (changes) => applyNodesChange(changes),
    [applyNodesChange],
  );

  const onEdgesChange: OnEdgesChange<BlueprintEdge> = useCallback(
    (changes) => applyEdgesChange(changes),
    [applyEdgesChange],
  );

  const onConnect: OnConnect = useCallback(
    (connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      if (!source || !target || !sourceHandle || !targetHandle) return;

      const sourceType = nodeTypeMap.get(source);
      const targetType = nodeTypeMap.get(target);
      if (!sourceType || !targetType) return;

      // Self-loop guard
      if (source === target) return;

      // Determine data type from source port
      const sourceDataTypes = getPortDataTypes(sourceType, sourceHandle, 'output');
      if (!sourceDataTypes?.length) return;

      // Check port compatibility for any of the source port's data types
      const isCompatible = sourceDataTypes.some((dt) =>
        canConnectBlueprintPorts(sourceType, sourceHandle, targetType, targetHandle, dt),
      );
      if (!isCompatible) return;

      const dataType = sourceDataTypes[0]; // Use the first matching type

      // Check for duplicate edges (same source+target+handles)
      const isDuplicate = edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle,
      );
      if (isDuplicate) return;

      addEdge({
        id: generateUUID(),
        source,
        target,
        sourceHandle,
        targetHandle,
        type: 'blueprint',
        data: { dataType } satisfies BlueprintEdgeData,
      });
    },
    [nodeTypeMap, edges, addEdge],
  );

  /** Reject self-loops, duplicate edges, and incompatible port types. */
  const isValidConnection: IsValidConnection = useCallback(
    (connection) => {
      const { source, target, sourceHandle, targetHandle } = connection;
      // Self-loop
      if (source === target) return false;
      if (!sourceHandle || !targetHandle) return false;

      const sourceType = nodeTypeMap.get(source ?? '');
      const targetType = nodeTypeMap.get(target ?? '');
      if (!sourceType || !targetType) return false;

      // Port type compatibility
      const sourceDataTypes = getPortDataTypes(sourceType, sourceHandle, 'output');
      if (!sourceDataTypes?.length) return false;

      const isCompatible = sourceDataTypes.some((dt) =>
        canConnectBlueprintPorts(sourceType, sourceHandle, targetType, targetHandle, dt),
      );
      if (!isCompatible) return false;

      // Duplicate edge check
      const isDuplicate = edges.some(
        (e) =>
          e.source === source &&
          e.target === target &&
          e.sourceHandle === sourceHandle &&
          e.targetHandle === targetHandle,
      );
      return !isDuplicate;
    },
    [nodeTypeMap, edges],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
      selectEdge(null);
    },
    [selectNode, selectEdge],
  );

  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  const onEdgeClick = useCallback(
    (_event: React.MouseEvent, edge: { id: string }) => {
      selectEdge(edge.id);
      selectNode(null);
    },
    [selectNode, selectEdge],
  );

  const onViewportChange = useCallback(
    (vp: { x: number; y: number; zoom: number }) => {
      updateViewport(vp);
    },
    [updateViewport],
  );

  // ── Memoize default viewport to avoid re-applying on every render ───────
  const defaultViewport = useMemo(
    () => ({ x: viewport.x, y: viewport.y, zoom: viewport.zoom }),
    [viewport.x, viewport.y, viewport.zoom],
  );

  // ── Color mode: detect from document class ──────────────────────────────
  const colorMode: ColorMode = useMemo(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    return 'light';
  }, []);

  // ── Empty state ─────────────────────────────────────────────────────────
  if (!activeBlueprintId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="text-center">
          <p className="text-lg">未选择蓝图</p>
          <p className="mt-1 text-sm">请在左侧创建或选择一个蓝图开始编辑</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={blueprintNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onViewportChange={onViewportChange}
        defaultViewport={defaultViewport}
        fitView
        snapToGrid
        snapGrid={[16, 16]}
        deleteKeyCode={['Backspace', 'Delete']}
        colorMode={colorMode}
        proOptions={{ hideAttribution: true }}
        className="bg-background"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          color="hsl(var(--border))"
        />
        <Controls />
        <MiniMap
          nodeStrokeWidth={2}
          nodeColor="hsl(var(--muted))"
          maskColor="hsl(var(--background) / 0.7)"
          className="!bg-panel"
        />
      </ReactFlow>
    </div>
  );
}
