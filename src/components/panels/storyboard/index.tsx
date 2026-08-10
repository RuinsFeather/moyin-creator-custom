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
import { useState } from "react";
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { StoryboardToolbar } from "./StoryboardToolbar";
import { StoryboardTable } from "./StoryboardTable";
import { StoryboardDetailPanel } from "./StoryboardDetailPanel";
import { ScriptImportDialog } from "./ScriptImportDialog";
import { AnalysisProgress } from "./AnalysisProgress";
import { EmptyState } from "./EmptyState";
import { Button } from "@/components/ui/button";

export function StoryboardPanel() {
  const document = useActiveStoryboardDocument();
  const analysisJob = useStoryboardStore((s) => s.analysisJob);
  const setImportDialogOpen = useStoryboardStore((s) => s.setImportDialogOpen);
  const [showDetail, setShowDetail] = useState(true);

  return (
    <div className="h-full flex flex-col bg-background">
      <StoryboardToolbar onToggleDetail={() => setShowDetail((v) => !v)} showDetail={showDetail} />

      {analysisJob && analysisJob.status === "running" && <AnalysisProgress job={analysisJob} />}

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