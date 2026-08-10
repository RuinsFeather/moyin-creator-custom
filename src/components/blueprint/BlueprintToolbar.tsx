// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useRef, useState, useEffect } from 'react';
import type { BlueprintNodeType, BlueprintNode } from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID } from '@/lib/utils';
import { undo, redo, useCanUndo, useCanRedo } from '@/lib/blueprint/undo-redo';
import { executeBlueprintRun, retryNodeExecution } from '@/lib/blueprint/execution-bridge';
import { useAppSettingsStore } from '@/stores/app-settings-store';

// ── Node type catalog grouped by category ─────────────────────────────────

interface NodeCatalogItem {
  type: BlueprintNodeType;
  icon: string;
  label: string;
  description: string;
  disabled?: boolean;
}

interface NodeCatalogGroup {
  label: string;
  icon: string;
  items: NodeCatalogItem[];
}

const NODE_CATALOG: NodeCatalogGroup[] = [
  {
    label: '输入',
    icon: '📥',
    items: [
      {
        type: 'text-input',
        icon: '📝',
        label: '文本输入',
        description: '提示词、台词、上下文',
      },
      {
        type: 'script-import',
        icon: '📜',
        label: '剧本导入',
        description: '从项目剧本导入分镜',
      },
    ],
  },
  {
    label: '素材',
    icon: '🖼️',
    items: [
      {
        type: 'image-reference',
        icon: '🖼️',
        label: '图片参考',
        description: '参考图片素材',
      },
      {
        type: 'video-reference',
        icon: '🎬',
        label: '视频参考',
        description: '参考视频/图片素材',
      },
    ],
  },
  {
    label: '生成器',
    icon: '⚡',
    items: [
      {
        type: 'image-generator',
        icon: '🎨',
        label: '图片生成',
        description: 'AI 图片生成',
      },
      {
        type: 'video-generator',
        icon: '🎥',
        label: '视频生成',
        description: 'AI 视频生成',
      },
    ],
  },
  {
    label: '输出',
    icon: '📦',
    items: [
      {
        type: 'output',
        icon: '📦',
        label: '输出',
        description: '收集生成结果',
      },
    ],
  },
];

/** Default config factory per node type. */
function getDefaultConfig(nodeType: BlueprintNodeType): Record<string, unknown> {
  switch (nodeType) {
    case 'text-input':
      return { text: '' };
    case 'image-reference':
      return { media: [] };
    case 'video-reference':
      return { media: [] };
    case 'script-import':
      return { selectedShotIds: [], mode: 'snapshot' };
    case 'image-generator':
      return {};
    case 'video-generator':
      return {};
    case 'output':
      return { acceptedTypes: ['image'] };
    default:
      return {};
  }
}

// ── Add Node Menu ─────────────────────────────────────────────────────────

const AddNodeMenu = memo(function AddNodeMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const addNode = useBlueprintStore((s) => s.addNode);
  const beginnerMode = useBlueprintStore((s) => s.beginnerMode);

  // Filter catalog: hide disabled items and (in beginner mode) video-generator
  const visibleCatalog = NODE_CATALOG.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => !item.disabled && !(beginnerMode && item.type === 'video-generator'),
    ),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAdd = useCallback(
    (item: NodeCatalogItem) => {
      const id = generateUUID();
      const label = item.label;
      addNode({
        id,
        type: item.type,
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          nodeType: item.type,
          label,
          config: getDefaultConfig(item.type),
        },
      } as BlueprintNode);
      setOpen(false);
    },
    [addNode],
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent"
        title="添加节点"
      >
        <span>＋</span>
        <span>添加节点</span>
        <span className="text-[10px] opacity-60">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-panel p-1.5 shadow-xl">
          {visibleCatalog.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <div className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <span>{group.icon}</span>
                <span>{group.label}</span>
              </div>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  disabled={item.disabled}
                  onClick={() => handleAdd(item)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className="text-sm">{item.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-foreground">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {item.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// ── Undo / Redo (§11.1) ──────────────────────────────────────────────────

const UndoRedoButtons = memo(function UndoRedoButtons() {
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  return (
    <div className="flex items-center gap-0.5">
      <button
        disabled={!canUndo}
        onClick={() => undo()}
        className="inline-flex h-7 items-center rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        title="撤销 (Ctrl+Z)"
      >
        ↩
      </button>
      <button
        disabled={!canRedo}
        onClick={() => redo()}
        className="inline-flex h-7 items-center rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        title="重做 (Ctrl+Shift+Z)"
      >
        ↪
      </button>
    </div>
  );
});

// ── Run Actions ───────────────────────────────────────────────────────────

const RunActions = memo(function RunActions() {
  const currentRun = useBlueprintStore((s) => s.currentRun);
  const executionLock = useBlueprintStore((s) => s.executionLock);
  const selectedNodeId = useBlueprintStore((s) => s.selectedNodeId);
  const selectedNodeStatus = useBlueprintStore((s) => {
    if (!s.selectedNodeId) return undefined;
    const bp = s.blueprints[s.activeBlueprintId ?? ''];
    return bp?.nodes.find((n) => n.id === s.selectedNodeId)?.data.execution?.status;
  });
  const cancelRun = useBlueprintStore((s) => s.cancelRun);
  const clearExecutionState = useBlueprintStore((s) => s.clearExecutionState);

  const isRunning = executionLock || currentRun != null;
  const isSelectedFailed = selectedNodeStatus === 'failed';

  // Paid task confirmation callback (§11.2)
  const confirmPaidTask = useCallback(
    async (nodes: Array<{ data: { label: string } }>) => {
      // 灰度开关（P1-4）：关闭付费执行时，拒绝提交付费生成任务。
      const allowPaid =
        useAppSettingsStore.getState().blueprintConfig?.allowPaidExecution !== false;
      if (!allowPaid) {
        window.alert(
          '蓝图已关闭付费生成（灰度设置）。请在设置中开启「允许付费生成任务」后再执行图片/视频生成节点。',
        );
        return false;
      }
      return window.confirm(
        `以下节点将执行付费生成任务：\n${nodes.map((n) => `• ${n.data.label}`).join('\n')}\n\n确认执行？`,
      );
    },
    [],
  );

  const handleRunSelected = useCallback(() => {
    if (selectedNodeId) {
      void executeBlueprintRun('node', selectedNodeId, { confirmPaidTask });
    }
  }, [selectedNodeId, confirmPaidTask]);

  const handleRunDownstream = useCallback(() => {
    if (selectedNodeId) {
      void executeBlueprintRun('downstream', selectedNodeId, { confirmPaidTask });
    }
  }, [selectedNodeId, confirmPaidTask]);

  const handleRunAll = useCallback(() => {
    void executeBlueprintRun('all', undefined, { confirmPaidTask });
  }, [confirmPaidTask]);

  const handleRetrySelected = useCallback(() => {
    if (selectedNodeId) {
      void retryNodeExecution(selectedNodeId, { confirmPaidTask });
    }
  }, [selectedNodeId, confirmPaidTask]);

  const handleCancel = useCallback(() => {
    cancelRun();
  }, [cancelRun]);

  const handleClear = useCallback(() => {
    clearExecutionState();
  }, [clearExecutionState]);

  return (
    <div className="flex items-center gap-1">
      <button
        disabled={isRunning || !selectedNodeId}
        onClick={handleRunSelected}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-40"
        title="运行选中节点"
      >
        ▶ 选中
      </button>
      <button
        disabled={isRunning || !selectedNodeId}
        onClick={handleRunDownstream}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-40"
        title="运行选中及其下游"
      >
        ▶ 下游
      </button>
      <button
        disabled={isRunning}
        onClick={handleRunAll}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 text-xs text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-40"
        title="运行全部节点"
      >
        ▶▶ 全部
      </button>

      {isSelectedFailed && (
        <button
          disabled={isRunning}
          onClick={handleRetrySelected}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 text-xs text-warning transition-colors hover:bg-warning/20 disabled:cursor-not-allowed disabled:opacity-40"
          title="重试选中失败节点及其上游"
        >
          🔄 重试
        </button>
      )}

      {isRunning && (
        <button
          onClick={handleCancel}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 text-xs text-destructive transition-colors hover:bg-destructive/20"
          title="取消当前运行"
        >
          ■ 取消
        </button>
      )}

      <div className="mx-0.5 h-4 w-px bg-border" />

      <button
        disabled={isRunning}
        onClick={handleClear}
        className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        title="清理所有运行状态"
      >
        🧹 清理
      </button>
    </div>
  );
});

// ── Validation Status ─────────────────────────────────────────────────────

const ValidationStatus = memo(function ValidationStatus() {
  const currentRun = useBlueprintStore((s) => s.currentRun);
  const executionLock = useBlueprintStore((s) => s.executionLock);
  const errorSummary = useBlueprintStore((s) => s.errorSummary);

  const isRunning = executionLock || currentRun != null;

  return (
    <div className="flex items-center gap-1.5">
      {isRunning && (
        <span className="flex items-center gap-1 text-[10px] text-info">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-info" />
          {currentRun?.mode === 'all'
            ? '运行全部'
            : currentRun?.mode === 'downstream'
              ? '运行下游'
              : '运行中'}
        </span>
      )}

      {errorSummary.length > 0 && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
          ⚠ {errorSummary.length} 个错误
        </span>
      )}

      {!isRunning && errorSummary.length === 0 && (
        <span className="text-[10px] text-muted-foreground">就绪</span>
      )}
    </div>
  );
});

// ── Main Toolbar ──────────────────────────────────────────────────────────

// ── Beginner Mode Toggle (§11.3.2) ────────────────────────────────────────

const BeginnerModeToggle = memo(function BeginnerModeToggle() {
  const beginnerMode = useBlueprintStore((s) => s.beginnerMode);
  const toggleBeginnerMode = useBlueprintStore((s) => s.toggleBeginnerMode);

  return (
    <button
      onClick={toggleBeginnerMode}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors ${
        beginnerMode
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-input bg-background text-muted-foreground hover:bg-accent'
      }`}
      title={beginnerMode ? '新手模式已开启（点击切换到高级模式）' : '高级模式（点击切换到新手模式）'}
    >
      {beginnerMode ? '🌱 新手' : '⚡ 高级'}
    </button>
  );
});

export function BlueprintToolbar() {
  return (
    <div className="flex h-9 items-center gap-1 border-b border-border bg-panel px-2">
      <AddNodeMenu />
      <div className="mx-1 h-4 w-px bg-border" />
      <UndoRedoButtons />
      <div className="mx-1 h-4 w-px bg-border" />
      <RunActions />
      <div className="flex-1" />
      <BeginnerModeToggle />
      <div className="mx-1 h-4 w-px bg-border" />
      <ValidationStatus />
    </div>
  );
}
