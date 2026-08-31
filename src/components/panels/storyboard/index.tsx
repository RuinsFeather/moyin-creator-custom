// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * Storyboard Panel (分镜) — 新分镜模块
 *
 * 一个项目维护一份当前分镜文档：AI 完整剧本拆镜 + 人工整理的表格式界面。
 * 不包含 集/场 层级，不生成首尾帧/图片/视频/提示词。
 *
 * 布局：顶部工具栏 + 主区（表格）+ 右侧详情面板（可选）。
 */
import { useState, useEffect, useCallback } from "react";
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { StoryboardToolbar } from "./StoryboardToolbar";
import { StoryboardTable } from "./StoryboardTable";
import { StoryboardDetailPanel } from "./StoryboardDetailPanel";
import { ScriptImportDialog } from "./ScriptImportDialog";
import { AnalysisProgress } from "./AnalysisProgress";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/ui/button";
import {
  detectScriptChange,
  applyScriptUpdate,
  snapshotBeforeOverwrite,
  type ScriptChangeResult,
} from "@/lib/storyboard/storyboard-script-sync";
import { toast } from "sonner";

export function StoryboardPanel() {
  const document = useActiveStoryboardDocument();
  const analysisJob = useStoryboardStore((s) => s.analysisJob);
  const setImportDialogOpen = useStoryboardStore((s) => s.setImportDialogOpen);
  const [showDetail, setShowDetail] = useState(true);
  const [scriptChange, setScriptChange] = useState<ScriptChangeResult | null>(null);

  // 进入分镜页时检测源剧本变更（§14 风险3：人工修改不被静默覆盖）
  const checkChange = useCallback(async () => {
    if (!document || !document.sourceScriptPath) {
      setScriptChange(null);
      return;
    }
    const result = await detectScriptChange();
    setScriptChange(result.kind === "changed" ? result : null);
  }, [document]);

  useEffect(() => {
    void checkChange();
  }, [checkChange]);

  const handleUpdate = () => {
    if (!document || !scriptChange?.currentHash) return;
    applyScriptUpdate(document, scriptChange.currentHash);
    toast.success("已更新剧本哈希，保留当前分镜");
    setScriptChange(null);
  };

  const handleOverwrite = () => {
    if (!document || !scriptChange?.currentHash) return;
    // 覆盖重拆前自动快照
    snapshotBeforeOverwrite("剧本变更覆盖重拆前快照");
    setScriptChange(null);
    setImportDialogOpen(true);
  };

  const handleIgnore = () => {
    setScriptChange(null);
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <StoryboardToolbar onToggleDetail={() => setShowDetail((v) => !v)} showDetail={showDetail} />

      {analysisJob && analysisJob.status === "running" && <AnalysisProgress job={analysisJob} />}

      {scriptChange && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-amber-500/30 bg-amber-500/10 text-xs text-amber-700">
          <span className="flex-1">
            源剧本内容已变更。更新可保留当前分镜并记录新哈希；覆盖重拆会基于新剧本重新拆分（先自动快照）。
          </span>
          <Button variant="outline" size="sm" className="h-6 text-[11px]" onClick={handleUpdate}>
            更新
          </Button>
          <Button variant="default" size="sm" className="h-6 text-[11px]" onClick={handleOverwrite}>
            覆盖重拆
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={handleIgnore}>
            忽略
          </Button>
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          {!document || document.shots.length === 0 ? (
            <EmptyState
              hasDocument={Boolean(document)}
              onImport={() => setImportDialogOpen(true)}
            />
          ) : (
            <StoryboardTable />
          )}
        </div>

        {showDetail && document && (
          <div className="w-80 border-l border-border flex flex-col">
            <StoryboardDetailPanel />
          </div>
        )}
      </div>

      <ScriptImportDialog />
    </div>
  );
}

export default StoryboardPanel;