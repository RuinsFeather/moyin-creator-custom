// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { memo, useCallback, useRef, useState, useEffect } from 'react';
import type { BlueprintNode } from '@/types/blueprint';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { generateUUID } from '@/lib/utils';
import { undo, redo, useCanUndo, useCanRedo } from '@/lib/blueprint/undo-redo';
import { BOX_CATALOG, type BoxCatalogItem } from './CanvasContextMenu';
import { loadBlueprintProject, saveBlueprintProject } from '@/lib/blueprint/blueprint-project-file-service';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import { toast } from 'sonner';

/** Default config factory per node type — shared by AddNodeMenu and CanvasContextMenu. */
function getDefaultConfig(nodeType: BoxCatalogItem['type']): Record<string, unknown> {
  switch (nodeType) {
    case 'text-box':
      return { text: '', language: '', role: '', skillRefs: [] };
    case 'image-box':
      return { media: [] };
    case 'video-box':
      return { media: [] };
    case 'script-import':
      return { selectedShotIds: [], mode: 'snapshot' };
    default:
      return {};
  }
}

// ── Add Window Menu (P1-8: uses the same BOX_CATALOG as the canvas
// right-click menu, so both entry points offer identical options) ────────

const AddNodeMenu = memo(function AddNodeMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const addNode = useBlueprintStore((s) => s.addNode);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAdd = useCallback(
    (item: BoxCatalogItem) => {
      const id = generateUUID();
      addNode({
        id,
        type: item.type,
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          nodeType: item.type,
          label: item.label,
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
        data-testid="add-node-menu"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent"
        title="添加窗口"
      >
        <span>＋</span>
        <span>添加窗口</span>
        <span className="text-[10px] opacity-60">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-panel p-1.5 shadow-xl">
          {BOX_CATALOG.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <div className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  key={item.type}
                  onClick={() => handleAdd(item)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
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

// ── More Menu (P1-8): 剧本导入 / 输出节点 / 指标面板 / 自动布局 ────────────

export interface BlueprintToolbarProps {
  /** Toggle the execution metrics panel visibility (owned by BlueprintView). */
  metricsOpen?: boolean;
  onToggleMetrics?: () => void;
}

const MoreMenu = memo(function MoreMenu({
  metricsOpen,
  onToggleMetrics,
}: {
  metricsOpen?: boolean;
  onToggleMetrics?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const addNode = useBlueprintStore((s) => s.addNode);
  const autoLayoutNodes = useBlueprintStore((s) => s.autoLayoutNodes);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleAddAdvanced = useCallback(
    (item: BoxCatalogItem) => {
      const id = generateUUID();
      addNode({
        id,
        type: item.type,
        position: { x: 100 + Math.random() * 200, y: 100 + Math.random() * 200 },
        data: {
          nodeType: item.type,
          label: item.label,
          config: getDefaultConfig(item.type),
        },
      } as BlueprintNode);
      setOpen(false);
    },
    [addNode],
  );

  const handleAutoLayout = useCallback(() => {
    autoLayoutNodes();
    setOpen(false);
  }, [autoLayoutNodes]);

  const handleToggleMetrics = useCallback(() => {
    onToggleMetrics?.();
    setOpen(false);
  }, [onToggleMetrics]);

  const advancedItems = BOX_CATALOG.find((g) => g.label === '高级')?.items ?? [];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent"
        title="更多"
      >
        <span>⋯</span>
        <span>更多</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-panel p-1.5 shadow-xl">
          {advancedItems.map((item) => (
            <button
              key={item.type}
              onClick={() => handleAddAdvanced(item)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
            >
              <span className="text-sm">{item.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="text-foreground">{item.label}</div>
                <div className="text-[10px] text-muted-foreground">{item.description}</div>
              </div>
            </button>
          ))}

          <div className="my-1 h-px bg-border" />

          <button
            onClick={handleToggleMetrics}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ${
              metricsOpen ? 'text-primary' : 'text-foreground'
            }`}
          >
            <span className="text-sm">📊</span>
            <span>{metricsOpen ? '隐藏指标面板' : '显示指标面板'}</span>
          </button>

          <button
            onClick={handleAutoLayout}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
          >
            <span className="text-sm">🧭</span>
            <span>自动布局</span>
          </button>
        </div>
      )}
    </div>
  );
});

// ── Status Bar：错误数/就绪 + 清理（运行中/取消已移至各窗口覆盖层）────────────

const StatusBar = memo(function StatusBar() {
  const currentRun = useBlueprintStore((s) => s.currentRun);
  const executionLock = useBlueprintStore((s) => s.executionLock);
  const errorSummary = useBlueprintStore((s) => s.errorSummary);
  const clearExecutionState = useBlueprintStore((s) => s.clearExecutionState);

  const isRunning = executionLock || currentRun != null;

  const handleClear = useCallback(() => {
    clearExecutionState();
  }, [clearExecutionState]);

  return (
    <div className="flex items-center gap-1.5">
      {errorSummary.length > 0 && (
        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
          ⚠ {errorSummary.length} 个错误
        </span>
      )}

      {!isRunning && errorSummary.length === 0 && (
        <span className="text-[10px] text-muted-foreground">就绪</span>
      )}

      <button
        disabled={isRunning}
        onClick={handleClear}
        className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        title="清理所有运行状态"
      >
        🧹 清理
      </button>
    </div>
  );
});

// ── Main Toolbar ──────────────────────────────────────────────────────────

export function BlueprintToolbar({ metricsOpen, onToggleMetrics }: BlueprintToolbarProps = {}) {
  const activeBlueprintId = useBlueprintStore((s) => s.activeBlueprintId);
  const blueprints = useBlueprintStore((s) => s.blueprints);
  const loadSavedBlueprint = useBlueprintStore((s) => s.loadSavedBlueprint);
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);
  const activeBlueprint = blueprints.find((blueprint) => blueprint.id === activeBlueprintId);

  const handleSave = useCallback(async () => {
    if (!activeBlueprint) return toast.info('请先创建或选择蓝图');
    try {
      await saveBlueprintProject(activeBlueprint);
      toast.success('蓝图项目已保存到资源管理器');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '蓝图项目保存失败');
    }
  }, [activeBlueprint]);

  const handleOpen = useCallback(async () => {
    if (!workspaceRoot) return toast.info('请先在资源管理器中打开工作区文件夹');
    try {
      const blueprint = await loadBlueprintProject();
      loadSavedBlueprint(blueprint);
      toast.success(`已打开蓝图项目：${blueprint.name}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '蓝图项目打开失败');
    }
  }, [workspaceRoot, loadSavedBlueprint]);

  return (
    <div className="flex h-9 items-center gap-1 border-b border-border bg-panel px-2">
      <AddNodeMenu />
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => void handleSave()}
        disabled={!activeBlueprint}
        title="保存蓝图项目"
      >
        <span>保存</span>
      </button>
      <button
        type="button"
        className="inline-flex h-7 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => void handleOpen()}
        disabled={!workspaceRoot}
        title="打开已保存的蓝图项目"
      >
        <span>打开项目</span>
      </button>
      <div className="mx-1 h-4 w-px bg-border" />
      <UndoRedoButtons />
      <div className="mx-1 h-4 w-px bg-border" />
      <MoreMenu metricsOpen={metricsOpen} onToggleMetrics={onToggleMetrics} />
      <div className="flex-1" />
      <StatusBar />
    </div>
  );
}
