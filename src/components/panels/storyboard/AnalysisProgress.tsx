// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * AnalysisProgress — AI 拆镜进度条
 */
import { useStoryboardStore } from "@/stores/storyboard-store";
import type { StoryboardAnalysisJob } from "@/types/storyboard";
import { Button } from "@/components/ui/button";
import { Loader2, X } from "lucide-react";
import { cancelStoryboardAnalysis } from "@/lib/storyboard/storyboard-analysis-service";

interface Props {
  job: StoryboardAnalysisJob;
}

export function AnalysisProgress({ job }: Props) {
  const setAnalysisProgress = useStoryboardStore((s) => s.setAnalysisProgress);

  const handleCancel = () => {
    cancelStoryboardAnalysis(job.id);
  };

  // 失败/成功时显示结果，可关闭
  if (job.status === "failed" || job.status === "cancelled" || job.status === "succeeded") {
    const isErr = job.status === "failed" || job.status === "cancelled";
    return (
      <div className={`px-3 py-1.5 text-xs flex items-center justify-between border-b ${isErr ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"}`}>
        <span>{job.message || (isErr ? "拆镜失败" : "拆镜完成")}</span>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setAnalysisProgress({ status: "idle" })}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="px-3 py-1.5 text-xs flex items-center gap-2 border-b">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span className="flex-1">{job.message || "正在拆镜…"}</span>
      <span className="text-muted-foreground">{Math.round(job.progress)}%</span>
      <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleCancel} title="取消">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}