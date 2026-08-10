// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";
/**
 * useStoryboardAnalysis — 分镜 AI 拆镜 hook
 *
 * 读取当前分镜文档的源剧本内容（从工作区），调用 startStoryboardAnalysis。
 */
import { useCallback } from "react";
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { startStoryboardAnalysis } from "@/lib/storyboard/storyboard-analysis-service";
import { toast } from "sonner";

export function useStoryboardAnalysis() {
  const document = useActiveStoryboardDocument();
  const startedAt = useStoryboardStore((s) => s.analysisJob?.startedAt);
  const analysisJob = useStoryboardStore((s) => s.analysisJob);
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);

  const analyzing = analysisJob?.status === "running";

  const run = useCallback(async () => {
    if (!document) {
      toast.warning("没有可分镜文档，请先从项目导入剧本");
      return;
    }
    if (!document.sourceScriptPath) {
      toast.warning("当前分镜没有来源剧本，请先导入剧本");
      return;
    }
    if (!workspaceRoot) {
      toast.warning("请先在「剧本」模块打开工作区文件夹");
      return;
    }
    const fs = getScriptWorkspaceFs();
    if (!fs) {
      toast.warning("工作区文件系统不可用");
      return;
    }

    let scriptContent = "";
    try {
      scriptContent = await fs.readFile(workspaceRoot, document.sourceScriptPath);
    } catch (e) {
      toast.error("读取剧本失败：" + ((e as Error).message || "未知错误"));
      return;
    }
    if (!scriptContent || !scriptContent.trim()) {
      toast.warning("剧本内容为空，无法拆镜");
      return;
    }

    const result = await startStoryboardAnalysis(scriptContent);
    if (!result.ok) {
      toast.error(result.error || "拆镜失败");
    } else {
      toast.success(`拆镜完成，共 ${result.shotCount} 个镜头`);
    }
  }, [document, workspaceRoot]);

  return { run, analyzing, startedAt };
}