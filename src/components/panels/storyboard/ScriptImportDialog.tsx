// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ScriptImportDialog — 从当前项目导入一份剧本
 *
 * 1. 扫描当前工作区文件
 * 2. 筛选可导入的剧本文件
 * 3. 选择后按攻略策略导入（首导/更新/覆盖/建版本）
 */
import { useEffect, useMemo, useState } from "react";
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import {
  pickImportableScripts,
  resolveImportStrategy,
  hashScriptContent,
  type ImportableScript,
} from "@/lib/storyboard/script-importer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { snapshotBeforeOverwrite } from "@/lib/storyboard/storyboard-script-sync";

const STRATEGY_LABEL: Record<string, string> = {
  "first-import": "首次导入",
  update: "内容未变，更新元数据",
  overwrite: "内容已变，覆盖现有分镜",
  "create-version": "新剧本，创建分镜版本",
};

export function ScriptImportDialog() {
  const open = useStoryboardStore((s) => s.importDialogOpen);
  const setImportDialogOpen = useStoryboardStore((s) => s.setImportDialogOpen);
  const initDocument = useStoryboardStore((s) => s.initDocument);
  const document = useActiveStoryboardDocument();
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);

  const [files, setFiles] = useState<ImportableScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = async () => {
    if (!workspaceRoot) return;
    setLoading(true);
    try {
      const fs = getScriptWorkspaceFs();
      if (!fs) return;
      const resources = await fs.scan(workspaceRoot);
      const importable = pickImportableScripts(
        resources.map((r) => ({
          path: r.relativePath,
          name: r.name,
          content: r.content,
          size: r.size,
          mtime: r.mtime,
          type: r.kind === "directory" ? "directory" : r.editable ? "script" : "metadata",
        })),
      );
      setFiles(importable);
      if (importable.length > 0) setSelected(importable[0].path);
    } catch (e) {
      toast.error("扫描文件失败：" + ((e as Error).message || ""));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void refresh();
  }, [open, workspaceRoot]);

  const selectedFile = files.find((f) => f.path === selected) || null;

  const strategy = useMemo(() => {
    if (!selectedFile) return null;
    const incomingHash = hashScriptContent(selectedFile.content);
    return resolveImportStrategy(
      document?.sourceScriptPath,
      document?.sourceScriptContentHash,
      selectedFile.path,
      incomingHash,
    );
  }, [selectedFile, document]);

  const handleImport = () => {
    if (!selectedFile) return;
    const incomingHash = hashScriptContent(selectedFile.content);
    // §14 风险3：覆盖/换新剧本前，若已有镜头则自动快照，保证人工修改可恢复
    const hasShots = Boolean(document && document.shots.length > 0);
    if (strategy && hasShots && (strategy.strategy === "overwrite" || strategy.strategy === "create-version")) {
      snapshotBeforeOverwrite(
        strategy.strategy === "overwrite" ? "覆盖现有分镜前快照" : "导入新剧本前快照",
      );
    }
    initDocument({
      title: selectedFile.name.replace(/\.(md|txt|markdown)$/i, "") || "分镜",
      sourceScriptPath: selectedFile.path,
      sourceScriptContentHash: incomingHash,
    });
    toast.success(`已导入剧本「${selectedFile.name}」`);
    setImportDialogOpen(false);
  };

  const handleOpenWorkspace = async () => {
    const fs = getScriptWorkspaceFs();
    if (!fs) {
      toast.warning("工作区文件系统不可用");
      return;
    }
    const root = await fs.selectRoot();
    if (root) {
      useScriptWorkspaceStore.getState().setWorkspaceRoot(root);
      toast.success("已选择工作区");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setImportDialogOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>从项目导入剧本</DialogTitle>
        </DialogHeader>

        {!workspaceRoot ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <p className="text-xs text-muted-foreground">尚未打开工作区文件夹，无法扫描剧本文件。</p>
            <Button onClick={handleOpenWorkspace}>
              <FolderOpen className="h-4 w-4 mr-1" />
              打开工作区
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">工作区：{workspaceRoot}</span>
              <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={refresh} disabled={loading}>
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "刷新"}
              </Button>
            </div>

            <div className="border rounded-md max-h-52 overflow-auto">
              {loading ? (
                <div className="p-4 text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 扫描中…
                </div>
              ) : files.length === 0 ? (
                <div className="p-4 text-xs text-muted-foreground">未找到可导入的剧本文件（支持 .md / .txt）</div>
              ) : (
                files.map((f) => (
                  <button
                    key={f.path}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-accent ${selected === f.path ? "bg-accent" : ""}`}
                    onClick={() => setSelected(f.path)}
                  >
                    {f.name}
                  </button>
                ))
              )}
            </div>

            {strategy && selectedFile && (
              <div className="flex items-center gap-2 text-xs">
                <Badge variant="outline">{selectedFile.name}</Badge>
                <span className="text-muted-foreground">{STRATEGY_LABEL[strategy.strategy]}</span>
              </div>
            )}
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setImportDialogOpen(false)}>取消</Button>
          <Button onClick={handleImport} disabled={!selectedFile || !workspaceRoot}>
            导入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}