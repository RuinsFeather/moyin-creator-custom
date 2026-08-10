// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";
import { useMemo } from "react";
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileUp,
  Wand2,
  Plus,
  Trash2,
  History,
  Save,
  PanelRight,
  Loader2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { useStoryboardAnalysis } from "./useStoryboardAnalysis";
import { useStoryboardToBlueprint } from "./useStoryboardToBlueprint";

interface Props {
  onToggleDetail: () => void;
  showDetail: boolean;
}

export function StoryboardToolbar({ onToggleDetail, showDetail }: Props) {
  const setImportDialogOpen = useStoryboardStore((s) => s.setImportDialogOpen);
  const addShot = useStoryboardStore((s) => s.addShot);
  const deleteShots = useStoryboardStore((s) => s.deleteShots);
  const saveToWorkspace = useStoryboardStore((s) => s.saveToWorkspace);
  const document = useActiveStoryboardDocument();
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);

  const { run: runAnalysis, analyzing } = useStoryboardAnalysis();
  const { sendToBlueprint, selectedCount } = useStoryboardToBlueprint();

  const canAnalyze = Boolean(document && document.sourceScriptPath && !analyzing);

  const handleSave = async () => {
    if (!document) {
      toast.warning("没有可分镜文档");
      return;
    }
    if (!workspaceRoot) {
      toast.warning("请先在「剧本」模块打开工作区文件夹");
      return;
    }
    try {
      await saveToWorkspace();
      toast.success("已保存到工作区");
    } catch (e) {
      toast.error((e as Error).message || "保存失败");
    }
  };

  return (
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-panel">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">分镜</span>
        {document && (
          <Badge variant="outline" className="text-[10px]">
            v{document.version} · {document.shots.length} 镜头
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => setImportDialogOpen(true)} title="从项目导入剧本">
          <FileUp className="h-4 w-4 mr-1" />
          导入剧本
        </Button>

        <Button
          variant="default"
          size="sm"
          disabled={!canAnalyze}
          onClick={runAnalysis}
          title={canAnalyze ? "AI 拆分当前剧本" : "请先导入剧本"}
        >
          {analyzing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1" />}
          {analyzing ? "拆分中…" : "AI 拆分"}
        </Button>

        <Button variant="outline" size="sm" onClick={() => addShot()} title="新增镜头" disabled={!document}>
          <Plus className="h-4 w-4 mr-1" />
          新增镜头
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={() => document && deleteShots([document.shots.map((s) => s.id)].flat())}
          title="删除全部镜头"
          disabled={!document || document.shots.length === 0}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          清空
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={sendToBlueprint}
          title="把勾选的分镜镜头组合成文本，发送到蓝图中心创建文本节点"
          disabled={!document || selectedCount === 0}
        >
          <Send className="h-4 w-4 mr-1" />
          发送到蓝图{selectedCount > 0 ? `(${selectedCount})` : ""}
        </Button>

        <Button variant="ghost" size="sm" title="版本历史" disabled>
          <History className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="sm" onClick={handleSave} title="保存到工作区" disabled={!document}>
          <Save className="h-4 w-4" />
        </Button>

        <Button variant="ghost" size="sm" onClick={onToggleDetail} title="折叠/展开详情面板">
          <PanelRight className={`h-4 w-4 ${showDetail ? "" : "text-muted-foreground"}`} />
        </Button>
      </div>
    </div>
  );
}