// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { useCallback, useMemo, useRef, useState } from 'react';
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
  type OnConnectStart,
  type OnConnectEnd,
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
import { generateUUID, cn } from '@/lib/utils';
import { blueprintNodeTypes } from './boxes';
import { CanvasContextMenu } from './CanvasContextMenu';
import {
  classifyBlueprintMediaFile,
  persistDroppedBlueprintFiles,
} from '@/lib/blueprint/blueprint-media';
import { toast } from 'sonner';

const DROP_NODE_COLUMN_GAP = 360;
const DROP_NODE_ROW_GAP = 280;
const DROP_NODE_COLUMNS = 3;

function containsExternalFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes('Files')
    && !Array.from(dataTransfer.types).includes('application/x-media-item');
}

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
 * - P1-6: Right-click context menu for creating boxes at cursor position.
 * - P1-7: onConnectStart/End port highlighting, double-click to add text box.
 */
export function BlueprintCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isImportingFiles, setIsImportingFiles] = useState(false);

  // ── Context menu state ──────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  // ── Connection highlighting state ───────────────────────────────────────
  const [connectingFrom, setConnectingFrom] = useState<{
    nodeId: string;
    handleId: string;
    handleType: 'source' | 'target';
  } | null>(null);

  // ── Store selectors (fine-grained to avoid unnecessary re-renders) ──────
  const activeBlueprintId = useBlueprintStore((s) => s.activeBlueprintId);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const applyNodesChange = useBlueprintStore((s) => s.applyNodesChange);
  const applyEdgesChange = useBlueprintStore((s) => s.applyEdgesChange);
  const addEdge = useBlueprintStore((s) => s.addEdge);
  const addNode = useBlueprintStore((s) => s.addNode);
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const selectEdge = useBlueprintStore((s) => s.selectEdge);
  const openDrawer = useBlueprintStore((s) => s.openDrawer);
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
    (event, node) => {
      event.stopPropagation();
      selectNode(node.id);
      selectEdge(null);
    },
    [selectNode, selectEdge],
  );

  // 双击图片/视频窗口展开配置抽屉；双击文本窗口不触发（保持原有行为）。
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeType = node.data?.nodeType;
      if (nodeType === 'image-box' || nodeType === 'video-box') {
        openDrawer(node.id);
      }
    },
    [openDrawer],
  );

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.react-flow__node') || target.closest('.react-flow__edge')) return;
    selectNode(null);
    selectEdge(null);
    // 点击空白处同时收起抽屉
    openDrawer(null);
  }, [selectNode, selectEdge, openDrawer]);

  const handleCanvasPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!contextMenu) return;
      const target = event.target as Node;
      const menu = document.querySelector('[data-testid="canvas-context-menu"]');
      if (!menu?.contains(target)) {
        setContextMenu(null);
      }
    },
    [contextMenu],
  );

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

  // ── P1-6: Right-click context menu ──────────────────────────────────────
  const onPaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ── P1-7: onConnectStart/End for port highlighting ─────────────────────
  const onConnectStart: OnConnectStart = useCallback((_event, params) => {
    if (params.nodeId && params.handleId && params.handleType) {
      setConnectingFrom({
        nodeId: params.nodeId,
        handleId: params.handleId,
        handleType: params.handleType,
      });
    }
  }, []);

  const onConnectEnd: OnConnectEnd = useCallback(() => {
    setConnectingFrom(null);
  }, []);

  // ── P1-7: Double-click pane to add text box ────────────────────────────
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if (!containerRef.current) return;

      // Calculate flow position from screen coordinates
      const bounds = containerRef.current.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;

      // Manual viewport transform (since useReactFlow screenToFlowPosition 
      // is only available inside ReactFlowProvider children, and we're at
      // the ReactFlow component level itself)
      const flowX = (x - viewport.x) / viewport.zoom;
      const flowY = (y - viewport.y) / viewport.zoom;

      const id = generateUUID();
      addNode({
        id,
        type: 'text-box',
        position: { x: flowX, y: flowY },
        data: {
          nodeType: 'text-box',
          label: '文本',
          config: { text: '', language: '', role: '', skillRefs: [] },
        },
      } as BlueprintNode);
    },
    [viewport, addNode],
  );

  const onFileDragEnter = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const onFileDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onFileDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!containsExternalFiles(event.dataTransfer)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsDraggingFiles(false);
  }, []);

  const onFileDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    if (!containsExternalFiles(event.dataTransfer) || !containerRef.current) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
    if (isImportingFiles) return;

    const files = Array.from(event.dataTransfer.files);
    const supportedCount = files.filter((file) => classifyBlueprintMediaFile(file) !== null).length;
    const unsupportedCount = files.length - supportedCount;
    if (supportedCount === 0) {
      toast.error('未检测到支持的图片或视频文件');
      return;
    }

    const bounds = containerRef.current.getBoundingClientRect();
    const dropPosition = {
      x: (event.clientX - bounds.left - viewport.x) / viewport.zoom,
      y: (event.clientY - bounds.top - viewport.y) / viewport.zoom,
    };

    setIsImportingFiles(true);
    try {
      const persisted = await persistDroppedBlueprintFiles(files);
      persisted.forEach(({ file, kind, ref }, index) => {
        const nodeType = kind === 'image' ? 'image-box' : 'video-box';
        addNode({
          id: generateUUID(),
          type: nodeType,
          position: {
            x: dropPosition.x + (index % DROP_NODE_COLUMNS) * DROP_NODE_COLUMN_GAP,
            y: dropPosition.y + Math.floor(index / DROP_NODE_COLUMNS) * DROP_NODE_ROW_GAP,
          },
          data: {
            nodeType,
            label: file.name,
            config: { media: [ref] },
          },
        } as BlueprintNode);
      });
      toast.success(`已创建 ${persisted.length} 个素材窗口`);
      if (unsupportedCount > 0) {
        toast.warning(`已忽略 ${unsupportedCount} 个不支持的文件`);
      }
    } catch (error) {
      console.error('[BlueprintCanvas] 导入素材失败:', error);
      toast.error(error instanceof Error ? error.message : '素材导入失败');
    } finally {
      setIsImportingFiles(false);
    }
  }, [addNode, isImportingFiles, viewport.x, viewport.y, viewport.zoom]);

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

  // Double-click on the pane (not on a node/edge) adds a text box.
  const handleContainerDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.react-flow__pane') && !target.closest('.react-flow__node')) {
        onPaneDoubleClick(event);
      }
    },
    [onPaneDoubleClick],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative h-full w-full',
        connectingFrom && 'blueprint-canvas-connecting',
      )}
      onPointerDownCapture={handleCanvasPointerDownCapture}
      onDoubleClick={handleContainerDoubleClick}
      onDragEnter={onFileDragEnter}
      onDragOver={onFileDragOver}
      onDragLeave={onFileDragLeave}
      onDrop={onFileDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={blueprintNodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onViewportChange={onViewportChange}
        defaultViewport={defaultViewport}
        fitView
        panOnDrag={[1, 2]}
        selectionOnDrag
        panActivationKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
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
      {contextMenu && (
        <CanvasContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        />
      )}
      {(isDraggingFiles || isImportingFiles) && (
        <div className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
          <div className="rounded-lg bg-panel px-6 py-4 text-center shadow-lg">
            <div className="text-2xl">{isImportingFiles ? '⏳' : '📥'}</div>
            <p className="mt-2 text-sm font-medium text-foreground">
              {isImportingFiles ? '正在导入素材…' : '释放以创建图片或视频窗口'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">支持同时拖入多个图片和视频文件</p>
          </div>
        </div>
      )}
    </div>
  );
}
