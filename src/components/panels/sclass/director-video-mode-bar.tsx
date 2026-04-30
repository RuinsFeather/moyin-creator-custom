// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
"use client";

/**
 * 导演面板视频功能模式切换条
 *
 * 提供与"自由"工作页一致的三种视频生成功能模式：
 * - 文生视频：仅根据视频提示词文本生成
 * - 图生视频：以分镜首帧（或上传图片）作为起始帧
 * - 多功能参考：上传多个视频/图片/音频作为综合参考
 *
 * 顶部上传的"全局参考资产"会作为对所有分镜的统一输入提示给底层生成逻辑。
 * 单分镜的图片/尾帧 / 视频提示词在分镜卡片中独立编辑。
 */

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Type, ImageIcon, Layers, Upload, X, Music, Film, Video as VideoLucide } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useSClassStore, type AssetRef } from "@/stores/sclass-store";

type VideoFeatureMode = 'text-to-video' | 'image-to-video' | 'multi-reference';

const FEATURE_MODE_OPTIONS: { value: VideoFeatureMode; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'text-to-video', label: '文生视频', icon: <Type className="h-3.5 w-3.5" />, desc: '仅依据视频提示词生成动画' },
  { value: 'image-to-video', label: '图生视频', icon: <ImageIcon className="h-3.5 w-3.5" />, desc: '以分镜首帧作为起始帧生成' },
  { value: 'multi-reference', label: '多功能参考', icon: <Layers className="h-3.5 w-3.5" />, desc: '上传视频/图片/音频做综合参考' },
];

interface DirectorVideoModeBarProps {
  disabled?: boolean;
}

function detectAssetType(file: File): AssetRef['type'] | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return null;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function DirectorVideoModeBar({ disabled }: DirectorVideoModeBarProps) {
  const projects = useSClassStore((s) => s.projects);
  const activeProjectId = useSClassStore((s) => s.activeProjectId);
  const setEditorPrefs = useSClassStore((s) => s.setEditorPrefs);
  const addAssetRef = useSClassStore((s) => s.addAssetRef);
  const removeAssetRef = useSClassStore((s) => s.removeAssetRef);

  const project = activeProjectId ? projects[activeProjectId] : null;
  const mode: VideoFeatureMode = (project?.editorPrefs.directorVideoMode as VideoFeatureMode) || 'image-to-video';
  const assets = project?.globalAssetRefs || [];

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleModeChange = (m: VideoFeatureMode) => {
    setEditorPrefs({ directorVideoMode: m });
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let added = 0;
    for (const file of Array.from(files)) {
      // 文生视频不接受任何参考素材
      if (mode === 'text-to-video') {
        toast.warning('文生视频模式无需上传参考素材');
        return;
      }
      // 图生视频仅接受图片
      if (mode === 'image-to-video' && !file.type.startsWith('image/')) {
        toast.warning(`图生视频模式仅支持图片，已跳过：${file.name}`);
        continue;
      }
      const assetType = detectAssetType(file);
      if (!assetType) {
        toast.warning(`不支持的文件类型：${file.name}`);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const tagPrefix = assetType === 'image' ? '@Image' : assetType === 'video' ? '@Video' : '@Audio';
        const sameTypeCount = assets.filter((a) => a.type === assetType).length + 1;
        const newAsset: AssetRef = {
          id: `${assetType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: assetType,
          tag: `${tagPrefix}${sameTypeCount}`,
          localUrl: dataUrl,
          httpUrl: null,
          fileName: file.name,
          fileSize: file.size,
          duration: null,
        };
        addAssetRef(null, newAsset);
        added += 1;
      } catch (err) {
        console.error('[DirectorVideoModeBar] read file error:', err);
        toast.error(`读取失败：${file.name}`);
      }
    }
    if (added > 0) toast.success(`已添加 ${added} 个参考素材`);
  };

  const triggerUpload = () => fileInputRef.current?.click();

  return (
    <div className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/20">
      {/* 功能模式切换 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground whitespace-nowrap">视频功能模式:</span>
        <div className="flex rounded-md border overflow-hidden">
          {FEATURE_MODE_OPTIONS.map((opt, idx) => (
            <button
              key={opt.value}
              onClick={() => handleModeChange(opt.value)}
              disabled={disabled}
              title={opt.desc}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors",
                idx > 0 && "border-l",
                mode === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-muted",
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {opt.icon}
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground/70 truncate flex-1">
          {FEATURE_MODE_OPTIONS.find((o) => o.value === mode)?.desc}
        </span>
      </div>

      {/* 参考素材上传区（文生模式隐藏） */}
      {mode !== 'text-to-video' && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {mode === 'image-to-video' ? '参考图片（可选，覆盖分镜首帧）' : '参考素材（视频 / 图片 / 音频）'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={mode === 'image-to-video' ? 'image/*' : 'image/*,video/*,audio/*'}
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

          {assets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {assets.map((a) => {
                const Icon = a.type === 'image' ? ImageIcon : a.type === 'video' ? Film : a.type === 'audio' ? Music : VideoLucide;
                return (
                  <div
                    key={a.id}
                    className="group relative flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px]"
                    title={`${a.tag} · ${a.fileName}`}
                  >
                    {a.type === 'image' ? (
                      <img src={a.localUrl} alt={a.fileName} className="h-6 w-6 rounded object-cover" />
                    ) : (
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
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
                );
              })}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground/60 italic">
              {mode === 'image-to-video'
                ? '未上传时将使用各分镜自身的首帧图片作为起始帧'
                : '未上传参考素材，将仅使用分镜提示词与首帧'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
