// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
"use client";

/**
 * Storyboard Table Panel — 专业动画分镜表
 *
 * 列：镜号 / 分镜图（首帧·尾帧） / 描述（场景·动作·对白） / 提示词 / 参考图
 *
 * 仅承担四件事：
 *   1. 从剧本页导入分镜描述（依靠现有 director-store splitScenes 数据）
 *   2. 调整景别与镜头详情（景别下拉 + 时长下拉）
 *   3. 选择参考角色 / 场景，可上传额外参考图
 *   4. 生成分镜首帧 / 尾帧图片
 *
 * 设计要点：
 *   - 不再耦合 sclass-store / 视频生成 / 九宫格切片等遗留逻辑
 *   - 直接调用 freedom-api 的 generateFreedomImage，复用其完整智能路由（与"自由"页一致）
 *   - 表格化布局，单行单分镜
 */

import { useCallback, useMemo, useRef, useState } from "react";
import {
  useDirectorStore,
  useActiveDirectorProject,
  SHOT_SIZE_PRESETS,
  DURATION_PRESETS,
  type SplitScene,
  type ShotSizeType,
  type DurationType,
} from "@/stores/director-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { useProjectStore } from "@/stores/project-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2,
  Image as ImageIcon,
  Upload,
  X,
  Wand2,
  Trash2,
  Plus,
  Film,
  Users,
  MapPin,
} from "lucide-react";
import { CharacterSelector } from "@/components/panels/director/character-selector";
import { SceneLibrarySelector } from "@/components/panels/director/scene-library-selector";
import { generateFreedomImage } from "@/lib/freedom/freedom-api";
import { persistSceneImage } from "@/lib/utils/image-persist";
import { readImageAsBase64 } from "@/lib/image-storage";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ============ 工具：把任意图片 URL 形式归一化为可发送的 dataURL/http ============

async function normalizeRefForApi(url?: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("data:image/")) return url;
  if (url.startsWith("local-image://")) {
    try {
      const base64 = await readImageAsBase64(url);
      return base64 || null;
    } catch {
      return null;
    }
  }
  return null;
}

// ============ 单行：分镜表中一行 ============

interface RowProps {
  scene: SplitScene;
  index: number;
  isGenerating: boolean;
  globalRefs: string[];
  extraRefs: string[];
  onGenerateImage: (sceneId: number, frame: "first" | "end") => Promise<void>;
  onUploadImage: (sceneId: number, frame: "first" | "end", file: File) => Promise<void>;
  onDeleteImage: (sceneId: number, frame: "first" | "end") => void;
  onAddExtraRefs: (sceneId: number, files: File[]) => Promise<void>;
  onRemoveExtraRef: (sceneId: number, idx: number) => void;
  onDelete: (sceneId: number) => void;
}

function StoryboardRow({
  scene,
  index,
  isGenerating,
  globalRefs,
  extraRefs,
  onGenerateImage,
  onUploadImage,
  onDeleteImage,
  onAddExtraRefs,
  onRemoveExtraRef,
  onDelete,
}: RowProps) {
  const [dragOver, setDragOver] = useState<"first" | "end" | "extra" | null>(null);
  const extraInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (frame: "first" | "end") => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const file = Array.from(e.dataTransfer.files || []).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) onUploadImage(scene.id, frame, file);
  };
  const handleDragOver = (frame: "first" | "end") => (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setDragOver(frame);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
  };

  // === 其他参考图：拖入 / 点击上传 ===
  const handleExtraDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(null);
    const files = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) onAddExtraRefs(scene.id, files);
  };
  const handleExtraDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) setDragOver("extra");
  };
  const handleExtraInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (files.length > 0) onAddExtraRefs(scene.id, files);
    e.target.value = "";
  };
  const {
    updateSplitSceneShotSize,
    updateSplitSceneDuration,
    updateSplitSceneImagePrompt,
    updateSplitSceneEndFramePrompt,
    updateSplitSceneNeedsEndFrame,
    updateSplitSceneCharacters,
    updateSplitSceneCharacterVariationMap,
    updateSplitSceneReference,
    updateSplitSceneEndFrameReference,
    updateSplitSceneField,
  } = useDirectorStore();

  const firstInputRef = useRef<HTMLInputElement>(null);
  const endInputRef = useRef<HTMLInputElement>(null);

  const handleFirstUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUploadImage(scene.id, "first", file);
    e.target.value = "";
  };
  const handleEndUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUploadImage(scene.id, "end", file);
    e.target.value = "";
  };

  const charCount = scene.characterIds?.length || 0;
  const sceneRefImg = scene.sceneReferenceImage;

  return (
    <tr className="border-b align-top hover:bg-muted/30 transition-colors">
      {/* 镜号 */}
      <td className="p-2 text-center text-xs font-mono w-12">
        <div className="flex flex-col items-center gap-1">
          <span className="font-semibold text-sm">{index + 1}</span>
          <button
            onClick={() => onDelete(scene.id)}
            className="text-muted-foreground/50 hover:text-destructive"
            title="删除分镜"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </td>

      {/* 分镜图（首帧 + 可选尾帧） */}
      <td className="p-2 w-[260px]">
        <div className="flex flex-col gap-2">
          {/* 首帧 */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>首帧</span>
              <div className="flex items-center gap-1">
                <input
                  ref={firstInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFirstUpload}
                />
                <button
                  onClick={() => firstInputRef.current?.click()}
                  className="hover:text-primary"
                  title="上传首帧"
                >
                  <Upload className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onGenerateImage(scene.id, "first")}
                  disabled={isGenerating || scene.imageStatus === "generating"}
                  className="hover:text-primary disabled:opacity-40"
                  title="生成首帧"
                >
                  {scene.imageStatus === "generating" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                </button>
                {scene.imageDataUrl && (
                  <button
                    onClick={() => onDeleteImage(scene.id, "first")}
                    className="hover:text-destructive"
                    title="删除首帧图片"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            <div
              className={cn(
                "group relative aspect-video w-full rounded border bg-muted/40 overflow-hidden flex items-center justify-center transition-colors",
                dragOver === "first" && "border-primary border-2 bg-primary/10",
              )}
              onDragOver={handleDragOver("first")}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop("first")}
            >
              {scene.imageDataUrl ? (
                <>
                  <img
                    src={scene.imageDataUrl}
                    alt={`首帧 ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <button
                    onClick={() => onDeleteImage(scene.id, "first")}
                    className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="删除首帧图片"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              ) : scene.imageStatus === "generating" ? (
                <div className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>{scene.imageProgress}%</span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground/60">
                  <ImageIcon className="h-5 w-5" />
                  <span>点击或拖入图片</span>
                </div>
              )}
              {dragOver === "first" && (
                <div className="absolute inset-0 flex items-center justify-center bg-primary/20 text-primary text-xs font-medium pointer-events-none">
                  释放以上传
                </div>
              )}
            </div>
            {scene.imageError && (
              <div className="text-[10px] text-destructive truncate" title={scene.imageError}>
                {scene.imageError}
              </div>
            )}
          </div>

          {/* 尾帧（可选） */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={scene.needsEndFrame}
                  onChange={(e) => updateSplitSceneNeedsEndFrame(scene.id, e.target.checked)}
                  className="h-3 w-3"
                />
                <span>尾帧</span>
              </label>
              {scene.needsEndFrame && (
                <div className="flex items-center gap-1">
                  <input
                    ref={endInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleEndUpload}
                  />
                  <button
                    onClick={() => endInputRef.current?.click()}
                    className="hover:text-primary"
                    title="上传尾帧"
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onGenerateImage(scene.id, "end")}
                    disabled={isGenerating || scene.endFrameStatus === "generating"}
                    className="hover:text-primary disabled:opacity-40"
                    title="生成尾帧"
                  >
                    {scene.endFrameStatus === "generating" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Wand2 className="h-3 w-3" />
                    )}
                  </button>
                  {scene.endFrameImageUrl && (
                    <button
                      onClick={() => onDeleteImage(scene.id, "end")}
                      className="hover:text-destructive"
                      title="删除尾帧图片"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {scene.needsEndFrame && (
              <div
                className={cn(
                  "group relative aspect-video w-full rounded border bg-muted/40 overflow-hidden flex items-center justify-center transition-colors",
                  dragOver === "end" && "border-primary border-2 bg-primary/10",
                )}
                onDragOver={handleDragOver("end")}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop("end")}
              >
                {scene.endFrameImageUrl ? (
                  <>
                    <img
                      src={scene.endFrameImageUrl}
                      alt={`尾帧 ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <button
                      onClick={() => onDeleteImage(scene.id, "end")}
                      className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="删除尾帧图片"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </>
                ) : scene.endFrameStatus === "generating" ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <div className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground/60">
                    <ImageIcon className="h-5 w-5" />
                    <span>点击或拖入图片</span>
                  </div>
                )}
                {dragOver === "end" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-primary/20 text-primary text-xs font-medium pointer-events-none">
                    释放以上传
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </td>

      {/* 描述：场景 / 动作 / 对白 + 景别 + 时长 */}
      <td className="p-2 w-[260px] text-xs">
        <div className="flex flex-col gap-1.5">
          <Input
            value={scene.sceneName}
            onChange={(e) => updateSplitSceneField(scene.id, "sceneName", e.target.value)}
            placeholder="场景名称"
            className="h-7 text-xs"
          />
          <Input
            value={scene.sceneLocation}
            onChange={(e) => updateSplitSceneField(scene.id, "sceneLocation", e.target.value)}
            placeholder="场景地点"
            className="h-7 text-xs"
          />
          <Textarea
            value={scene.actionSummary || ""}
            onChange={(e) => updateSplitSceneField(scene.id, "actionSummary", e.target.value)}
            placeholder="动作描述"
            className="text-xs min-h-[44px] resize-y"
          />
          <Textarea
            value={scene.dialogue || ""}
            onChange={(e) => updateSplitSceneField(scene.id, "dialogue", e.target.value)}
            placeholder="对白"
            className="text-xs min-h-[36px] resize-y"
          />

          {/* 景别 + 时长 */}
          <div className="flex items-center gap-1.5">
            <Select
              value={scene.shotSize || ""}
              onValueChange={(v) =>
                updateSplitSceneShotSize(scene.id, (v || null) as ShotSizeType | null)
              }
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder="景别" />
              </SelectTrigger>
              <SelectContent>
                {SHOT_SIZE_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.abbr} · {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(scene.duration ?? 5)}
              onValueChange={(v) => updateSplitSceneDuration(scene.id, Number(v) as DurationType)}
            >
              <SelectTrigger className="h-7 text-xs w-[72px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={String(p.value)} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Input
            value={scene.cameraMovement || ""}
            onChange={(e) => updateSplitSceneField(scene.id, "cameraMovement", e.target.value)}
            placeholder="镜头运动（Pan / Zoom / Static…）"
            className="h-7 text-xs"
          />
        </div>
      </td>

      {/* 提示词：首帧 / 尾帧（中文） */}
      <td className="p-2 w-[300px] text-xs">
        <div className="flex flex-col gap-1.5">
          <div>
            <div className="text-[10px] text-muted-foreground mb-0.5">首帧提示词</div>
            <Textarea
              value={scene.imagePromptZh || ""}
              onChange={(e) =>
                updateSplitSceneImagePrompt(scene.id, scene.imagePrompt || "", e.target.value)
              }
              placeholder="例：宁静的山村清晨，薄雾缭绕，主角望向远方"
              className="text-xs min-h-[140px] resize-y leading-relaxed"
            />
          </div>
          {scene.needsEndFrame && (
            <div>
              <div className="text-[10px] text-muted-foreground mb-0.5">尾帧提示词</div>
              <Textarea
                value={scene.endFramePromptZh || ""}
                onChange={(e) =>
                  updateSplitSceneEndFramePrompt(
                    scene.id,
                    scene.endFramePrompt || "",
                    e.target.value,
                  )
                }
                placeholder="尾帧（结束姿态/位置）"
                className="text-xs min-h-[110px] resize-y leading-relaxed"
              />
            </div>
          )}
        </div>
      </td>

      {/* 参考图：角色 / 场景库 */}
      <td className="p-2 w-[220px] text-xs">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Users className="h-3 w-3" />
            <span>角色（{charCount}）</span>
          </div>
          <CharacterSelector
            selectedIds={scene.characterIds || []}
            onChange={(ids) => updateSplitSceneCharacters(scene.id, ids)}
            characterVariationMap={scene.characterVariationMap}
            onChangeVariation={(charId, varId) => {
              const current = { ...(scene.characterVariationMap || {}) };
              if (varId) current[charId] = varId;
              else delete current[charId];
              updateSplitSceneCharacterVariationMap?.(scene.id, current);
            }}
            disabled={isGenerating}
          />

          <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-1">
            <MapPin className="h-3 w-3" />
            <span>场景</span>
          </div>
          <SceneLibrarySelector
            sceneId={scene.id}
            selectedSceneLibraryId={scene.sceneLibraryId}
            selectedViewpointId={scene.viewpointId}
            selectedSubViewId={scene.subViewId}
            isEndFrame={false}
            onChange={(sceneLibId, viewpointId, refImage, subViewId) =>
              updateSplitSceneReference(scene.id, sceneLibId, viewpointId, refImage, subViewId)
            }
            disabled={isGenerating}
          />
          {scene.needsEndFrame && (
            <SceneLibrarySelector
              sceneId={scene.id}
              selectedSceneLibraryId={scene.endFrameSceneLibraryId}
              selectedViewpointId={scene.endFrameViewpointId}
              selectedSubViewId={scene.endFrameSubViewId}
              isEndFrame={true}
              onChange={(sceneLibId, viewpointId, refImage, subViewId) =>
                updateSplitSceneEndFrameReference(
                  scene.id,
                  sceneLibId,
                  viewpointId,
                  refImage,
                  subViewId,
                )
              }
              disabled={isGenerating}
            />
          )}

          {/* 其他参考图：本行独立、拖入或点击上传 */}
          <div className="flex items-center justify-between gap-1 text-[10px] text-muted-foreground mt-1">
            <div className="flex items-center gap-1">
              <ImageIcon className="h-3 w-3" />
              <span>其他参考图（{extraRefs.length}）</span>
            </div>
            <input
              ref={extraInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={handleExtraInput}
            />
            <button
              onClick={() => extraInputRef.current?.click()}
              className="hover:text-primary"
              title="上传参考图"
            >
              <Upload className="h-3 w-3" />
            </button>
          </div>
          <div
            className={cn(
              "rounded border border-dashed p-1.5 transition-colors min-h-[52px]",
              dragOver === "extra"
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30 bg-muted/20",
            )}
            onDragOver={handleExtraDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleExtraDrop}
          >
            {extraRefs.length === 0 ? (
              <div className="text-[10px] text-muted-foreground/60 text-center py-2">
                {dragOver === "extra" ? "释放以添加参考图" : "拖入或点击上传图片"}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1">
                {extraRefs.map((u, i) => (
                  <div key={i} className="relative group">
                    <img
                      src={u}
                      alt={`参考 ${i + 1}`}
                      className="h-9 w-9 rounded object-cover border"
                    />
                    <button
                      onClick={() => onRemoveExtraRef(scene.id, i)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="移除"
                    >
                      <X className="h-2 w-2" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 显示当前参考图缩略 */}
          {(sceneRefImg || globalRefs.length > 0) && (
            <div className="flex flex-wrap gap-1 pt-1 border-t">
              {sceneRefImg && (
                <img
                  src={sceneRefImg}
                  alt="场景参考"
                  className="h-9 w-9 rounded object-cover border"
                  title="场景参考图"
                />
              )}
              {globalRefs.slice(0, 4).map((u, i) => (
                <img
                  key={i}
                  src={u}
                  alt={`全局参考 ${i + 1}`}
                  className="h-9 w-9 rounded object-cover border opacity-80"
                  title="全局参考图"
                />
              ))}
              {globalRefs.length > 4 && (
                <div className="h-9 w-9 rounded border flex items-center justify-center text-[10px] text-muted-foreground">
                  +{globalRefs.length - 4}
                </div>
              )}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

// ============ 主组件 ============

export function StoryboardTablePanel() {
  const projectData = useActiveDirectorProject();
  const splitScenes = projectData?.splitScenes || [];
  const storyboardConfig = projectData?.storyboardConfig;

  const {
    addBlankSplitScene,
    deleteSplitScene,
    updateSplitSceneImage,
    updateSplitSceneImageStatus,
    updateSplitSceneEndFrame,
    updateSplitSceneEndFrameStatus,
  } = useDirectorStore();

  const { resourceSharing } = useAppSettingsStore();
  const { activeProjectId } = useProjectStore();

  // 全局参考图（仅本组件内 state，刷新即清空，专注本次会话）
  const [globalRefs, setGlobalRefs] = useState<string[]>([]);
  const globalUploadRef = useRef<HTMLInputElement>(null);
  const [isAnyGenerating, setIsAnyGenerating] = useState(false);

  // 每行额外参考图（sceneId -> dataURL[]）；本组件内 state，跟随会话
  const [extraRefsMap, setExtraRefsMap] = useState<Record<number, string[]>>({});

  const filesToDataUrls = useCallback((files: File[]): Promise<string[]> => {
    return Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
          }),
      ),
    );
  }, []);

  const handleAddExtraRefs = useCallback(
    async (sceneId: number, files: File[]) => {
      if (files.length === 0) return;
      try {
        const urls = await filesToDataUrls(files);
        setExtraRefsMap((prev) => ({
          ...prev,
          [sceneId]: [...(prev[sceneId] || []), ...urls],
        }));
        toast.success(`已为分镜 ${sceneId + 1} 添加 ${urls.length} 张参考图`);
      } catch (err: any) {
        toast.error(`参考图读取失败：${err?.message || err}`);
      }
    },
    [filesToDataUrls],
  );

  const handleRemoveExtraRef = useCallback((sceneId: number, idx: number) => {
    setExtraRefsMap((prev) => {
      const list = prev[sceneId] || [];
      return { ...prev, [sceneId]: list.filter((_, i) => i !== idx) };
    });
  }, []);

  // 收集角色参考图
  const allCharacters = useCharacterLibraryStore((s) => s.characters);
  const accessibleCharacters = useMemo(() => {
    if (resourceSharing.shareCharacters) return allCharacters;
    if (!activeProjectId) return [];
    return allCharacters.filter((c) => c.projectId === activeProjectId);
  }, [allCharacters, resourceSharing.shareCharacters, activeProjectId]);

  const getCharacterReferenceImages = useCallback(
    (characterIds: string[], variationMap?: Record<string, string>): string[] => {
      const refs: string[] = [];
      const seen = new Set<string>();
      const push = (v?: string) => {
        if (v && !seen.has(v)) {
          seen.add(v);
          refs.push(v);
        }
      };
      const MAX = 8;
      for (const id of characterIds) {
        const c = accessibleCharacters.find((x) => x.id === id);
        if (!c) continue;
        const variationId = variationMap?.[id];
        const variation = variationId ? c.variations?.find((v) => v.id === variationId) : undefined;
        push(variation?.referenceImage);
        for (const v of c.views || []) {
          push(v.imageBase64 || v.imageUrl);
          if (refs.length >= MAX) return refs;
        }
        for (const img of c.referenceImages || []) {
          push(img);
          if (refs.length >= MAX) return refs;
        }
      }
      return refs.slice(0, MAX);
    },
    [accessibleCharacters],
  );

  // ============ 全局参考图上传 / 删除 ============

  const handleGlobalUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const promises: Promise<string>[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      promises.push(
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }),
      );
    }
    Promise.all(promises).then((urls) => {
      setGlobalRefs((prev) => [...prev, ...urls]);
      toast.success(`已添加 ${urls.length} 张全局参考图`);
    });
    e.target.value = "";
  };

  const removeGlobalRef = (idx: number) => {
    setGlobalRefs((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleUploadImage = async (sceneId: number, frame: "first" | "end", file: File) => {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const persisted = await persistSceneImage(dataUrl, sceneId, frame);
      if (frame === "first") {
        updateSplitSceneImage(sceneId, persisted.localPath, undefined, undefined, persisted.httpUrl || undefined);
      } else {
        updateSplitSceneEndFrame(sceneId, persisted.localPath, "upload", persisted.httpUrl);
      }
      toast.success(`分镜 ${sceneId + 1} ${frame === "first" ? "首帧" : "尾帧"}已上传`);
    } catch (err: any) {
      toast.error(`上传失败：${err?.message || err}`);
    }
  };

  // ============ 删除分镜首/尾帧图片 ============

  const handleDeleteImage = (sceneId: number, frame: "first" | "end") => {
    if (frame === "first") {
      updateSplitSceneImage(sceneId, "", undefined, undefined, undefined);
      updateSplitSceneImageStatus(sceneId, {
        imageStatus: "idle",
        imageProgress: 0,
        imageError: null,
      });
    } else {
      updateSplitSceneEndFrame(sceneId, null, undefined, null);
      updateSplitSceneEndFrameStatus(sceneId, {
        endFrameStatus: "idle",
        endFrameProgress: 0,
        endFrameError: null,
      });
    }
    toast.success(`已删除分镜 ${sceneId + 1} ${frame === "first" ? "首帧" : "尾帧"}图片`);
  };

  // ============ 生成单分镜首/尾帧 ============

  const handleGenerateImage = async (sceneId: number, frame: "first" | "end") => {
    const scene = splitScenes.find((s) => s.id === sceneId);
    if (!scene) return;

    const promptZh =
      frame === "first"
        ? scene.imagePromptZh || scene.imagePrompt
        : scene.endFramePromptZh || scene.endFramePrompt;
    if (!promptZh?.trim()) {
      toast.warning(`请先填写${frame === "first" ? "首帧" : "尾帧"}提示词`);
      return;
    }

    // 收集参考图：全局 + 场景背景 + 角色 + 该行额外参考图
    const refsRaw: (string | null | undefined)[] = [
      ...globalRefs,
      frame === "first" ? scene.sceneReferenceImage : scene.endFrameSceneReferenceImage,
      ...getCharacterReferenceImages(scene.characterIds || [], scene.characterVariationMap),
      ...(extraRefsMap[sceneId] || []),
    ];
    const refs = (await Promise.all(refsRaw.map(normalizeRefForApi))).filter(
      (x): x is string => !!x,
    );

    setIsAnyGenerating(true);
    if (frame === "first") {
      updateSplitSceneImageStatus(sceneId, {
        imageStatus: "generating",
        imageProgress: 0,
        imageError: null,
      });
    } else {
      updateSplitSceneEndFrameStatus(sceneId, {
        endFrameStatus: "generating",
        endFrameProgress: 0,
        endFrameError: null,
      });
    }

    try {
      const aspectRatio = (storyboardConfig?.aspectRatio as string) || "16:9";
      const resolution = (storyboardConfig?.resolution as string) || "2K";

      console.log("[StoryboardTable] Generate image", {
        sceneId,
        frame,
        prompt: promptZh.slice(0, 80),
        refCount: refs.length,
        aspectRatio,
      });
      toast.info(`分镜 ${sceneId + 1} 生成中（参考图 ${refs.length} 张）…`);

      const result = await generateFreedomImage({
        prompt: promptZh,
        aspectRatio,
        resolution,
        referenceImages: refs.length > 0 ? refs : undefined,
        onProgress: (info) => {
          if (frame === "first") {
            updateSplitSceneImageStatus(sceneId, { imageProgress: info.percent });
          } else {
            updateSplitSceneEndFrameStatus(sceneId, { endFrameProgress: info.percent });
          }
        },
      });

      if (!result.url) throw new Error("API 未返回图片 URL");

      const persisted = await persistSceneImage(result.url, sceneId, frame);
      if (frame === "first") {
        updateSplitSceneImage(
          sceneId,
          persisted.localPath,
          scene.width,
          scene.height,
          persisted.httpUrl || result.url,
        );
        updateSplitSceneImageStatus(sceneId, {
          imageStatus: "completed",
          imageProgress: 100,
          imageError: null,
        });
      } else {
        updateSplitSceneEndFrame(sceneId, persisted.localPath, "ai-generated", persisted.httpUrl);
        updateSplitSceneEndFrameStatus(sceneId, {
          endFrameStatus: "completed",
          endFrameProgress: 100,
          endFrameError: null,
        });
      }
      toast.success(`分镜 ${sceneId + 1} ${frame === "first" ? "首帧" : "尾帧"}生成完成`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error("[StoryboardTable] Generate failed:", err);
      if (frame === "first") {
        updateSplitSceneImageStatus(sceneId, {
          imageStatus: "failed",
          imageProgress: 0,
          imageError: msg,
        });
      } else {
        updateSplitSceneEndFrameStatus(sceneId, {
          endFrameStatus: "failed",
          endFrameProgress: 0,
          endFrameError: msg,
        });
      }
      toast.error(`分镜 ${sceneId + 1} 生成失败：${msg}`);
    } finally {
      setIsAnyGenerating(false);
    }
  };

  // ============ 一键全部生成首帧 ============

  const handleGenerateAll = async () => {
    const targets = splitScenes.filter((s) => !s.imageDataUrl && (s.imagePromptZh || s.imagePrompt));
    if (targets.length === 0) {
      toast.info("没有待生成的分镜（所有分镜已有首帧或缺少提示词）");
      return;
    }
    toast.info(`开始批量生成 ${targets.length} 个分镜首帧…`);
    for (const s of targets) {
      // 串行，避免 API 限流
      // eslint-disable-next-line no-await-in-loop
      await handleGenerateImage(s.id, "first");
    }
  };

  // ============ 渲染 ============

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-card/40">
        <div className="flex items-center gap-2">
          <Film className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">分镜表</span>
          <span className="text-xs text-muted-foreground">{splitScenes.length} 个分镜</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={addBlankSplitScene}>
            <Plus className="h-3 w-3 mr-1" />
            新增分镜
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={isAnyGenerating || splitScenes.length === 0}
            onClick={handleGenerateAll}
          >
            {isAnyGenerating ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                生成中
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3 mr-1" />
                一键全部生成首帧
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 全局参考图栏 */}
      <div className="flex flex-col gap-2 px-3 py-2 border-b bg-muted/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ImageIcon className="h-3.5 w-3.5" />
            <span>全局参考图</span>
            <span className="text-muted-foreground/60">- 应用于所有分镜的统一风格 / 角色 / 场景参考</span>
          </div>
          <input
            ref={globalUploadRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={handleGlobalUpload}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => globalUploadRef.current?.click()}
          >
            <Upload className="h-3 w-3 mr-1" />
            上传
          </Button>
        </div>
        {globalRefs.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {globalRefs.map((url, i) => (
              <div key={i} className="relative group">
                <img
                  src={url}
                  alt={`全局参考 ${i + 1}`}
                  className="h-12 w-12 rounded object-cover border"
                />
                <button
                  onClick={() => removeGlobalRef(i)}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="移除"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground/60 italic">
            未上传时仅使用每个分镜内独立选择的角色 / 场景参考。
          </p>
        )}
      </div>

      {/* 表格 */}
      <ScrollArea className="flex-1">
        {splitScenes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm gap-2">
            <Film className="h-10 w-10 opacity-40" />
            <p>暂无分镜</p>
            <p className="text-xs">请先在「剧本」页面生成分镜，或点击右上角"新增分镜"</p>
          </div>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-card/95 backdrop-blur z-10 border-b">
              <tr className="text-muted-foreground">
                <th className="p-2 text-center font-medium w-12">镜号</th>
                <th className="p-2 text-left font-medium w-[260px]">分镜图</th>
                <th className="p-2 text-left font-medium w-[260px]">描述</th>
                <th className="p-2 text-left font-medium w-[300px]">提示词</th>
                <th className="p-2 text-left font-medium w-[220px]">参考图</th>
              </tr>
            </thead>
            <tbody>
              {splitScenes.map((scene, idx) => (
                <StoryboardRow
                  key={scene.id}
                  scene={scene}
                  index={idx}
                  isGenerating={isAnyGenerating}
                  globalRefs={globalRefs}
                  extraRefs={extraRefsMap[scene.id] || []}
                  onGenerateImage={handleGenerateImage}
                  onUploadImage={handleUploadImage}
                  onDeleteImage={handleDeleteImage}
                  onAddExtraRefs={handleAddExtraRefs}
                  onRemoveExtraRef={handleRemoveExtraRef}
                  onDelete={deleteSplitScene}
                />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>
    </div>
  );
}
