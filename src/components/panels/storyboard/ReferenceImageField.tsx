// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * ReferenceImageField — 镜头参考图（只用于信息整理，不触发生成）
 * 仅支持上传本地图片：上传即落盘到工作区 reference/ 目录（若没有则新建），
 * 引用保存为稳定的 workspace-image:// URL；重新打开分镜可再次显示。
 */
import { useRef, useState } from "react";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import {
  STORYBOARD_REFS_DIR,
  WORKSPACE_IMAGE_PREFIX,
  dataUrlExt,
} from "@/lib/storyboard/storyboard-file-service";
import type { StoryboardShot } from "@/types/storyboard";
import { Button } from "@/components/ui/button";
import { Upload, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceImageUrl } from "@/hooks/use-workspace-image";

interface Props {
  shot: StoryboardShot;
}

/** 单张参考图缩略图：workspace-image:// 引用经 hook 异步解析后显示 */
function ReferenceThumb({ url, label }: { url: string | undefined; label?: string }) {
  const src = useWorkspaceImageUrl(url);
  if (!url) return null;
  if (!src) {
    // 引用存在但暂未解析（加载中 / 文件缺失）
    return <div className="h-16 w-16 rounded border bg-muted animate-pulse" title="图片加载中…" />;
  }
  return <img src={src} alt={label || "参考图"} className="h-16 w-16 object-cover rounded border" />;
}

export function ReferenceImageField({ shot }: Props) {
  const addReferenceImage = useStoryboardStore((s) => s.addReferenceImage);
  const removeReferenceImage = useStoryboardStore((s) => s.removeReferenceImage);
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const dataUrl = await readFileAsDataUrl(file);
    if (!dataUrl) {
      toast.error("读取图片失败");
      return;
    }

    // 有工作区时直接落盘为稳定引用；无工作区时暂存 data URL（保存时统一固化）
    if (!workspaceRoot) {
      addReferenceImage(shot.id, {
        sourceType: "upload",
        localUrl: dataUrl,
        thumbnailUrl: dataUrl,
        label: file.name,
      });
      toast.warning("尚未打开工作区，图片暂存于内存；保存分镜时需要工作区");
      return;
    }

    const fs = getScriptWorkspaceFs();
    if (!fs?.writeImage) {
      // 兼容：FS 无二进制通道时退回 data URL
      addReferenceImage(shot.id, {
        sourceType: "upload",
        localUrl: dataUrl,
        thumbnailUrl: dataUrl,
        label: file.name,
      });
      return;
    }

    setUploading(true);
    try {
      const [, base64] = dataUrl.split(",");
      // 文件名：shotId + 时间戳，避免覆盖既有图片（imageId 在 addReferenceImage 内才生成）
      const fileName = `${shot.id}-${Date.now()}${dataUrlExt(dataUrl)}`;
      const relPath = `${STORYBOARD_REFS_DIR}/${fileName}`;
      await fs.writeImage(workspaceRoot, relPath, base64);
      const stableUrl = `${WORKSPACE_IMAGE_PREFIX}${relPath}`;
      addReferenceImage(shot.id, {
        sourceType: "upload",
        localUrl: stableUrl,
        thumbnailUrl: stableUrl,
        label: file.name,
      });
      toast.success("参考图已保存到工作区 reference 文件夹");
    } catch (err) {
      // 落盘失败退回 data URL，保证 UI 不丢图（保存时还会再试固化）
      addReferenceImage(shot.id, {
        sourceType: "upload",
        localUrl: dataUrl,
        thumbnailUrl: dataUrl,
        label: file.name,
      });
      toast.error("参考图写入工作区失败：" + ((err as Error).message || "未知错误"));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border rounded-md p-2">
      <h5 className="text-[10px] font-medium text-muted-foreground">参考图</h5>

      <div className="flex flex-wrap gap-2">
        {shot.referenceImages.map((img) => (
          <div key={img.id} className="relative group">
            <ReferenceThumb url={img.localUrl || img.thumbnailUrl} label={img.label} />
            <button
              className="absolute -top-1 -right-1 bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100"
              onClick={() => removeReferenceImage(shot.id, img.id)}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-[11px]"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1" />}
          上传
        </Button>
        <span className="text-[10px] text-muted-foreground">
          {workspaceRoot ? "保存至工作区 reference/ 文件夹" : "未打开工作区，暂存内存"}
        </span>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleUpload}
        />
      </div>
    </div>
  );
}

function readFileAsDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}