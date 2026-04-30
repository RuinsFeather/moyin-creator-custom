// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
"use client";

/**
 * 分镜表全局参考图栏
 *
 * 用户可在此上传"角色图 / 场景图"等全局参考图，
 * 这些图会作为所有分镜生成时的额外参考被注入到 referenceImages 数组的最前部。
 *
 * 为简化数据模型，复用 sclass-store 的 globalAssetRefs（只取 type==='image' 的项）。
 */

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, X, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { useSClassStore, type AssetRef } from "@/stores/sclass-store";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

interface DirectorImageRefBarProps {
  disabled?: boolean;
}

export function DirectorImageRefBar({ disabled }: DirectorImageRefBarProps) {
  const projects = useSClassStore((s) => s.projects);
  const activeProjectId = useSClassStore((s) => s.activeProjectId);
  const addAssetRef = useSClassStore((s) => s.addAssetRef);
  const removeAssetRef = useSClassStore((s) => s.removeAssetRef);

  const project = activeProjectId ? projects[activeProjectId] : null;
  const allAssets = project?.globalAssetRefs || [];
  const imageAssets = allAssets.filter((a) => a.type === 'image');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let added = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast.warning(`不支持的文件类型：${file.name}`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const sameTypeCount = allAssets.filter((a) => a.type === 'image').length + 1;
        const newAsset: AssetRef = {
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: 'image',
          tag: `@Image${sameTypeCount}`,
          localUrl: dataUrl,
          httpUrl: null,
          fileName: file.name,
          fileSize: file.size,
          duration: null,
        };
        addAssetRef(null, newAsset);
        added += 1;
      } catch (err) {
        console.error('[DirectorImageRefBar] read file error:', err);
        toast.error(`读取失败：${file.name}`);
      }
    }
    if (added > 0) toast.success(`已添加 ${added} 张全局参考图`);
  };

  const triggerUpload = () => fileInputRef.current?.click();

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/20">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5" />
          <span>全局参考图（角色 / 场景 / 风格）</span>
          <span className="text-muted-foreground/60">- 将作为所有分镜生成的统一参考</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleUpload(e.target.files);
              e.target.value = '';
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={triggerUpload}
            disabled={disabled}
          >
            <Upload className="h-3 w-3 mr-1" />
            上传
          </Button>
        </div>
      </div>

      {imageAssets.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {imageAssets.map((a) => (
            <div
              key={a.id}
              className="group relative flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px]"
              title={`${a.tag} · ${a.fileName}`}
            >
              <img src={a.localUrl} alt={a.fileName} className="h-6 w-6 rounded object-cover" />
              <span className="font-medium text-primary">{a.tag}</span>
              <span className="text-muted-foreground truncate max-w-[100px]">{a.fileName}</span>
              <button
                onClick={() => removeAssetRef(null, a.id)}
                className="ml-0.5 opacity-60 hover:opacity-100 hover:text-destructive"
                title="移除"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground/60 italic">
          未上传时仅使用每个分镜内独立选择的角色 / 场景参考；
          上传后这些图会作为强制参考附加到每次分镜图片生成。
        </p>
      )}
    </div>
  );
}
