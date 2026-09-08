// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// BoxShell — shared window shell for the three canvas "boxes"
// (text-box / image-box / video-box). §4.1 / P1-1.
//
// Responsibilities:
//   - Rounded-rectangle card, sized per box type (280–360px).
//   - Status color bar (reuses getNodeStatusColor from NodeUI.tsx).
//   - Selected state highlight (ring + shadow).
//   - Left/right "connection balls" — real `Handle` components underneath,
//     restyled as circles. Left = input (target), right = output (source).
//   - Hover toolbar: copy / delete, plus retry when execution failed.
//
// Node-level duplication has no dedicated store action yet (only whole
// -blueprint duplication exists), so it is implemented inline here using
// `addNode` + `generateUUID`, mirroring `BLUEPRINT_COPY_POLICY`
// (reset execution state, regenerate ids).

import { memo, useCallback, type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Loader2, StopCircle } from 'lucide-react';
import {
  BLUEPRINT_NODE_PORTS,
  type BlueprintDataType,
  type BlueprintNode,
  type BlueprintNodeExecution,
  type BlueprintNodeType,
} from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID, cn } from '@/lib/utils';
import { retryNodeExecution } from '@/lib/blueprint/execution-bridge';
import { NodeLabel, getNodeStatusColor } from '../nodes/NodeUI';

/** Handle color per data type — matches legacy node conventions. */
const PORT_COLOR: Record<BlueprintDataType, string> = {
  text: '!bg-info',
  image: '!bg-success',
  video: '!bg-destructive',
  audio: '!bg-warning',
  context: '!bg-info',
};

function portColorClass(dataTypes: readonly BlueprintDataType[]): string {
  return PORT_COLOR[dataTypes[0]] ?? '!bg-muted-foreground';
}

/** Evenly distribute `count` handles along one edge as top-% positions. */
function portTop(index: number, count: number): string {
  if (count <= 1) return '50%';
  return `${((index + 1) / (count + 1)) * 100}%`;
}

const HANDLE_BASE_CLASS =
  '!h-3 !w-3 !rounded-full !border-2 !border-panel transition-transform hover:!scale-125';

export interface BoxShellProps {
  id: string;
  nodeType: BlueprintNodeType;
  selected?: boolean;
  icon: string;
  label: string;
  execution?: BlueprintNodeExecution;
  /** Box width in px (per-type default: text 280 / image 320 / video 340). */
  width?: number;
  /** Extra content rendered in the header row, after the label (e.g. char count, ✨ AI button). */
  headerExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}

function BoxShellComponent({
  id,
  nodeType,
  selected,
  icon,
  label,
  execution,
  width,
  headerExtra,
  className,
  children,
}: BoxShellProps) {
  const removeNode = useBlueprintStore((s) => s.removeNode);
  const selectNode = useBlueprintStore((s) => s.selectNode);
  const openDrawer = useBlueprintStore((s) => s.openDrawer);
  const cancelRun = useBlueprintStore((s) => s.cancelRun);

  const statusColor = getNodeStatusColor(execution?.status);
  const isFailed = execution?.status === 'failed';
  const isStale = execution?.status === 'stale';
  const isRunning = execution?.status === 'running';
  const isBoxNode = nodeType === 'image-box' || nodeType === 'video-box';

  const runProgress = (() => {
    const p = execution?.progress;
    if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return 0;
    // 引擎按 0–100 上报；兼容 0–1 历史数据
    if (p <= 1) return Math.round(p * 100);
    return Math.round(Math.min(100, p));
  })();

  const ports = BLUEPRINT_NODE_PORTS[nodeType];
  const leftPorts = ports.filter((p) => p.direction === 'input');
  const rightPorts = ports.filter((p) => p.direction === 'output');

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeNode(id);
    },
    [id, removeNode],
  );

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const state = useBlueprintStore.getState();
      const blueprint = state.blueprints.find((b) => b.id === state.activeBlueprintId);
      const node = blueprint?.nodes.find((n) => n.id === id);
      if (!node) return;

      const clonedData = JSON.parse(JSON.stringify(node.data)) as BlueprintNode['data'];
      delete clonedData.execution;

      const newId = generateUUID();
      state.addNode({
        ...(JSON.parse(JSON.stringify(node)) as BlueprintNode),
        id: newId,
        position: { x: node.position.x + 40, y: node.position.y + 40 },
        data: clonedData,
        selected: false,
      });
      state.selectNode(newId);
    },
    [id],
  );

  const handleRetry = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void retryNodeExecution(id);
    },
    [id],
  );

  // 双击展开配置抽屉（仅图片/视频窗口）。React Flow 的 onNodeDoubleClick
  // 在部分环境下不触发，这里在节点 DOM 上直接挂监听作为双保险；TextBox
  // 不会走到这个回调（由 BlueprintCanvas 层过滤），但这里仍按类型过滤一次。
  const handleShellDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (nodeType !== 'image-box' && nodeType !== 'video-box') return;
      e.stopPropagation();
      openDrawer(id);
    },
    [id, nodeType, openDrawer],
  );

  return (
    <div
      onDoubleClick={handleShellDoubleClick}
      className={cn(
        'group relative rounded-lg border-2 bg-panel px-3 py-2 shadow-md transition-shadow',
        statusColor,
        selected && 'ring-2 ring-primary ring-offset-1',
        className,
      )}
      style={{ width: width ?? 300 }}
    >
      {/* Hover toolbar */}
      <div className="nodrag absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-panel px-0.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        {(isFailed || isStale) && (
          <button
            onClick={handleRetry}
            className="rounded px-1 py-0.5 text-[10px] text-info hover:bg-accent"
            title={isStale ? '上游已变化，重新生成' : '重试'}
          >
            🔄
          </button>
        )}
        <button
          onClick={handleCopy}
          className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title="复制"
        >
          📋
        </button>
        <button
          onClick={handleDelete}
          className="rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
          title="删除"
        >
          🗑
        </button>
      </div>

      {/* Stale banner — upstream content changed (§5.2 失效传播)；生成中时不显示，避免中断任务 */}
      {isStale && !isRunning && (
        <div
          data-testid="box-stale-banner"
          className="mb-1 flex items-center justify-between rounded bg-warning/15 px-1.5 py-0.5 text-[9px] text-warning"
        >
          <span>上游内容已变化，结果可能过期</span>
          <button
            onClick={handleRetry}
            className="nodrag rounded bg-warning/20 px-1.5 py-0.5 transition-colors hover:bg-warning/30"
            title="重新生成"
          >
            重新生成
          </button>
        </div>
      )}

      <NodeLabel icon={icon} label={label}>
        {headerExtra}
      </NodeLabel>

      {/* 内容区（相对定位，供运行覆盖层叠加） */}
      <div className="relative">
        {children}

        {/* 运行覆盖层：仅图片/视频窗口，参考自由页工作室样式 */}
        {isBoxNode && isRunning && (
          <div
            data-testid="box-running-overlay"
            className={cn(
              'nodrag nowheel absolute inset-0 z-20 flex flex-col items-center justify-center gap-3',
              'rounded-md bg-background/92 backdrop-blur-[3px]',
            )}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-[11px] font-medium text-foreground">
              {nodeType === 'video-box' ? '视频生成中' : '图片生成中'}… {runProgress}%
            </p>
            {/* 进度条 */}
            <div className="h-1.5 w-4/5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${runProgress}%` }}
              />
            </div>
            <p className="text-[10px] text-muted-foreground">可切换页面，任务将在后台继续</p>
            <button
              type="button"
              className={cn(
                'nodrag inline-flex h-7 items-center gap-1.5 rounded-md border border-input',
                'bg-background px-3 text-[11px] text-foreground transition-colors hover:bg-muted',
              )}
              onClick={(e) => {
                e.stopPropagation();
                cancelRun();
              }}
            >
              <StopCircle className="h-3.5 w-3.5" />
              取消任务
            </button>
          </div>
        )}
      </div>

      {/* Connection balls (left = input, right = output) */}
      {leftPorts.map((port, i) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Left}
          id={port.id}
          className={cn(HANDLE_BASE_CLASS, portColorClass(port.dataTypes))}
          style={{ top: portTop(i, leftPorts.length) }}
        />
      ))}
      {rightPorts.map((port, i) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Right}
          id={port.id}
          className={cn(HANDLE_BASE_CLASS, portColorClass(port.dataTypes))}
          style={{ top: portTop(i, rightPorts.length) }}
        />
      ))}
    </div>
  );
}

/** Shared window shell for canvas boxes. */
export const BoxShell = memo(BoxShellComponent);
