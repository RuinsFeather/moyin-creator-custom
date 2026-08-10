// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * BlueprintImportPreview — Modal for previewing and confirming script → blueprint import.
 *
 * Shows:
 * - Shot count, node count, estimated task count
 * - Diagnostics (missing prompts, missing character names)
 * - Option to create new blueprint or join existing one
 * - Shot selection (which shots to include)
 * - Snapshot disclaimer (import does NOT modify the original script)
 */

import { useState, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { useMediaPanelStore } from '@/stores/media-panel-store';
import type { BlueprintDiagnostic } from '@/lib/blueprint/graph-validation';
import type { Shot } from '@/types/script';
import {
  XIcon,
  AlertTriangleIcon,
  InfoIcon,
  CheckIcon,
  ChevronDownIcon,
  LayersIcon,
  PlusIcon,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

export interface BlueprintImportPreviewProps {
  /** Shots to import (from script store or parsed markdown). */
  shots: Shot[];
  /** Raw Markdown script content (for Markdown-based import). */
  rawScript?: string;
  /** Display name for the new blueprint. */
  blueprintName?: string;
  /** Called when the user confirms the import. */
  onImport: (result: {
    target: 'new' | string;
    selectedShotIds?: string[];
    name: string;
  }) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
  /** Whether the modal is open. */
  open: boolean;
}

// ── Diagnostic badge ──────────────────────────────────────────────────────

function DiagnosticBadge({ diagnostic }: { diagnostic: BlueprintDiagnostic }) {
  const isWarning = diagnostic.severity === 'warning';
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 px-2 py-1 rounded text-[10px]',
        isWarning ? 'bg-yellow-500/10 text-yellow-600' : 'bg-blue-500/10 text-blue-500',
      )}
    >
      {isWarning ? (
        <AlertTriangleIcon className="h-3 w-3 mt-0.5 shrink-0" />
      ) : (
        <InfoIcon className="h-3 w-3 mt-0.5 shrink-0" />
      )}
      <span>{diagnostic.message}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function BlueprintImportPreview({
  shots,
  rawScript,
  blueprintName,
  onImport,
  onCancel,
  open,
}: BlueprintImportPreviewProps) {
  const { previewScriptImport, blueprints } = useBlueprintStore();
  const setActiveTab = useMediaPanelStore((s) => s.setActiveTab);

  const [target, setTarget] = useState<'new' | string>('new');
  const [name, setName] = useState(blueprintName ?? `剧本导入 ${new Date().toLocaleDateString('zh-CN')}`);
  const [selectedShotIds, setSelectedShotIds] = useState<string[] | undefined>(undefined);
  const [showShotSelector, setShowShotSelector] = useState(false);

  // Compute preview
  const preview = useMemo(() => {
    try {
      return previewScriptImport({
        shots,
        rawScript,
        selectedShotIds,
      });
    } catch {
      return null;
    }
  }, [shots, rawScript, selectedShotIds, previewScriptImport]);

  const estimatedTasks = preview ? preview.hasPrompts : 0;

  const handleToggleShot = useCallback((shotId: string) => {
    setSelectedShotIds((prev) => {
      if (prev === undefined) {
        // First toggle: select all except the toggled one
        return shots.filter((s) => s.id !== shotId).map((s) => s.id);
      }
      const isSelected = prev.includes(shotId);
      const next = isSelected
        ? prev.filter((id) => id !== shotId)
        : [...prev, shotId];
      // If all selected, treat as undefined (select all)
      return next.length === shots.length ? undefined : next;
    });
  }, [shots]);

  const handleSelectAll = useCallback(() => {
    setSelectedShotIds(undefined);
  }, []);

  const handleConfirm = useCallback(() => {
    onImport({
      target,
      selectedShotIds,
      name: name.trim() || `剧本导入 ${new Date().toLocaleDateString('zh-CN')}`,
    });
  }, [target, selectedShotIds, name, onImport]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-panel border border-border rounded-lg shadow-xl w-[480px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <LayersIcon className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">导入蓝图预览</span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Snapshot disclaimer */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-md px-3 py-2 text-[11px] text-blue-600">
            <InfoIcon className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            导入为快照模式：将基于当前分镜数据创建蓝图副本，不会修改原始剧本。
          </div>

          {/* Preview stats */}
          {preview ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-muted/50 rounded-md px-3 py-2 text-center">
                <div className="text-lg font-semibold text-primary">{preview.shotCount}</div>
                <div className="text-[10px] text-muted-foreground">分镜数</div>
              </div>
              <div className="bg-muted/50 rounded-md px-3 py-2 text-center">
                <div className="text-lg font-semibold text-primary">{preview.nodeCount}</div>
                <div className="text-[10px] text-muted-foreground">节点数</div>
              </div>
              <div className="bg-muted/50 rounded-md px-3 py-2 text-center">
                <div className="text-lg font-semibold text-primary">{estimatedTasks}</div>
                <div className="text-[10px] text-muted-foreground">预计任务数</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground text-center py-4">
              无可用分镜数据
            </div>
          )}

          {/* Diagnostics */}
          {preview && preview.diagnostics.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] text-muted-foreground font-medium">诊断信息</div>
              {preview.diagnostics.map((d, i) => (
                <DiagnosticBadge key={`${d.code}-${i}`} diagnostic={d} />
              ))}
            </div>
          )}

          {/* Shot selector */}
          {shots.length > 0 && (
            <div>
              <button
                onClick={() => setShowShotSelector(!showShotSelector)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDownIcon
                  className={cn('h-3 w-3 transition-transform', showShotSelector && 'rotate-180')}
                />
                选择要导入的分镜
                {selectedShotIds && (
                  <span className="text-primary ml-1">
                    ({selectedShotIds.length}/{shots.length})
                  </span>
                )}
              </button>
              {showShotSelector && (
                <div className="mt-2 max-h-[120px] overflow-y-auto border border-border rounded-md">
                  <div className="flex items-center justify-between px-2 py-1 bg-muted/50 border-b border-border">
                    <span className="text-[10px] text-muted-foreground">
                      {selectedShotIds ? `已选 ${selectedShotIds.length} 个` : '全部'}
                    </span>
                    <button
                      onClick={handleSelectAll}
                      className="text-[10px] text-primary hover:underline"
                    >
                      全选
                    </button>
                  </div>
                  {shots.map((shot) => {
                    const isSelected = selectedShotIds
                      ? selectedShotIds.includes(shot.id)
                      : true;
                    return (
                      <label
                        key={shot.id}
                        className="flex items-center gap-2 px-2 py-1 hover:bg-muted/30 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleShot(shot.id)}
                          className="h-3 w-3"
                        />
                        <span className="text-[11px] truncate">
                          镜头 {shot.index + 1}
                          {shot.actionSummary ? `: ${shot.actionSummary.slice(0, 40)}` : ''}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Target selection */}
          <div>
            <div className="text-[10px] text-muted-foreground font-medium mb-2">导入目标</div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 px-3 py-2 border border-border rounded-md hover:bg-muted/30 cursor-pointer">
                <input
                  type="radio"
                  name="import-target"
                  checked={target === 'new'}
                  onChange={() => setTarget('new')}
                  className="h-3 w-3"
                />
                <PlusIcon className="h-3.5 w-3.5 text-primary" />
                <div>
                  <div className="text-xs font-medium">创建新蓝图</div>
                  <div className="text-[10px] text-muted-foreground">
                    在蓝图列表中创建一个新蓝图
                  </div>
                </div>
              </label>
              {blueprints.length > 0 && (
                <label className="flex items-center gap-2 px-3 py-2 border border-border rounded-md hover:bg-muted/30 cursor-pointer">
                  <input
                    type="radio"
                    name="import-target"
                    checked={target !== 'new'}
                    onChange={() => {
                      const firstOther = blueprints.find((bp) => bp.id !== target);
                      if (firstOther) setTarget(firstOther.id);
                    }}
                    className="h-3 w-3"
                  />
                  <LayersIcon className="h-3.5 w-3.5 text-primary" />
                  <div className="flex-1">
                    <div className="text-xs font-medium">替换现有蓝图</div>
                    <div className="text-[10px] text-muted-foreground">
                      将内容替换到选定蓝图中
                    </div>
                  </div>
                </label>
              )}
              {target !== 'new' && blueprints.length > 0 && (
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-full text-xs bg-muted/50 border border-border rounded px-2 py-1.5"
                >
                  {blueprints.map((bp) => (
                    <option key={bp.id} value={bp.id}>
                      {bp.name}（{bp.nodes.length} 个节点）
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Blueprint name */}
          <div>
            <div className="text-[10px] text-muted-foreground font-medium mb-1">蓝图名称</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs bg-muted/50 border border-border rounded px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="输入蓝图名称..."
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-border hover:bg-muted/50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!preview || preview.shotCount === 0}
            className={cn(
              'px-3 py-1.5 text-xs rounded-md transition-colors flex items-center gap-1.5',
              preview && preview.shotCount > 0
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-muted text-muted-foreground cursor-not-allowed',
            )}
          >
            <CheckIcon className="h-3.5 w-3.5" />
            确认导入
          </button>
        </div>
      </div>
    </div>
  );
}
