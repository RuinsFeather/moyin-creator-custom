"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ImageIcon, Loader2, Download, Save, Sparkles, Archive, Upload, X, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PromptTextarea } from './PromptTextarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { corsFetch } from '@/lib/cors-fetch';
import { saveFreedomMedia } from '@/lib/freedom/download-utils';
import { cn } from '@/lib/utils';
import { useFreedomStore } from '@/stores/freedom-store';
import { useFreedomHistoryStore, type HistoryEntry } from '@/stores/freedom-history-store';
import { useProjectStore } from '@/stores/project-store';
import { ModelSelector } from './ModelSelector';
import { GenerationHistory } from './GenerationHistory';
import { ActiveTaskCard, formatElapsed } from './ActiveTaskCard';
import { SaveToPropsDialog } from './SaveToPropsDialog';
import { generateFreedomImage, FreedomCancelledError } from '@/lib/freedom/freedom-api';
import {
  getT2IModelById,
  getAspectRatiosForT2IModel,
} from '@/lib/freedom/model-registry';

const DEFAULT_ASPECT_RATIOS = ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const DEFAULT_RESOLUTIONS = ['1K', '2K', '4K'];
const MAX_REFERENCE_IMAGES = 10;
const DEFAULT_MIDJOURNEY_SPEED = 'relaxed';
const DEFAULT_MIDJOURNEY_STYLIZATION = 100;
const MIDJOURNEY_BOT_TYPES = [
  { value: 'MID_JOURNEY', label: 'MID_JOURNEY' },
  { value: 'NIJI_JOURNEY', label: 'NIJI_JOURNEY' },
] as const;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function isMidjourneyGridEntry(entry: HistoryEntry | null): boolean {
  return !!entry && entry.type === 'image' && Boolean(entry.metadata?.mjGrid || entry.params?.mjGrid);
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片加载失败，无法拆分'));
    image.src = src;
  });
}

async function splitImageGridToDataUrls(src: string): Promise<string[]> {
  let objectUrl: string | null = null;
  try {
    let imageSrc = src;
    if (/^https?:\/\//i.test(src)) {
      const response = await corsFetch(src);
      if (!response.ok) throw new Error('图片下载失败，无法拆分');
      objectUrl = URL.createObjectURL(await response.blob());
      imageSrc = objectUrl;
    }

    const image = await loadImageElement(imageSrc);
    const width = Math.floor(image.naturalWidth / 2);
    const height = Math.floor(image.naturalHeight / 2);
    if (width <= 0 || height <= 0) throw new Error('图片尺寸异常，无法拆分');

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('当前环境不支持图片拆分');

    const positions = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ] as const;

    return positions.map(([sx, sy]) => {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(image, sx, sy, width, height, 0, 0, width, height);
      return canvas.toDataURL('image/png');
    });
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export function ImageStudio() {
  const [saveToPropsOpen, setSaveToPropsOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedHistoryEntry, setSelectedHistoryEntry] = useState<HistoryEntry | null>(null);
  const [mjSplitImages, setMjSplitImages] = useState<string[]>([]);
  const [mjSplitLoading, setMjSplitLoading] = useState(false);
  const [mjSplitError, setMjSplitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    imagePrompt, setImagePrompt,
    selectedImageModel, setSelectedImageModel,
    imageAspectRatio, setImageAspectRatio,
    imageResolution, setImageResolution,
    imageExtraParams, setImageExtraParams,
    imageReferenceImages, setImageReferenceImages,
    imageResult, setImageResult,
    imageGenerating, setImageGenerating,
    activeTasks,
    addActiveTask, updateActiveTask, removeActiveTask, cancelActiveTask,
  } = useFreedomStore();
  const addHistoryEntry = useFreedomHistoryStore((s) => s.addHistoryEntry);

  // 当前查看的任务（用户点击历史栏中的活动任务卡片）
  const viewingTask = useMemo(
    () => (selectedTaskId ? activeTasks.find((t) => t.id === selectedTaskId) : null) || null,
    [selectedTaskId, activeTasks],
  );

  const handleDownloadImage = useCallback(async () => {
    const targetUrl = viewingTask?.resultUrl || imageResult;
    if (!targetUrl) return;

    try {
      await saveFreedomMedia(targetUrl, `freedom-image-${Date.now()}.png`);
    } catch (error) {
      console.error('Image download failed:', error);
      toast.error('下载失败，请稍后重试');
    }
  }, [viewingTask?.resultUrl, imageResult]);

  const selectedHistoryIsMjGrid = isMidjourneyGridEntry(selectedHistoryEntry);

  const handleDownloadSplitImage = useCallback(async (url: string, index: number) => {
    try {
      await saveFreedomMedia(url, `midjourney-grid-${index + 1}-${Date.now()}.png`);
    } catch (error) {
      console.error('MJ split image download failed:', error);
      toast.error('下载失败，请稍后重试');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const sourceUrl = selectedHistoryEntry?.resultUrl;

    setMjSplitImages([]);
    setMjSplitError(null);
    if (!selectedHistoryIsMjGrid || !sourceUrl) {
      setMjSplitLoading(false);
      return;
    }

    setMjSplitLoading(true);
    splitImageGridToDataUrls(sourceUrl)
      .then((images) => {
        if (!cancelled) setMjSplitImages(images);
      })
      .catch((error: unknown) => {
        if (!cancelled) setMjSplitError(error instanceof Error ? error.message : '拆分失败');
      })
      .finally(() => {
        if (!cancelled) setMjSplitLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedHistoryEntry?.resultUrl, selectedHistoryIsMjGrid]);

  // 用于实时显示"已等待 Xs"，仅当主预览区有运行中任务时每秒刷新
  const viewingRunning = !!viewingTask && (viewingTask.status === 'running' || viewingTask.status === 'cancelling');
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  useEffect(() => {
    if (!viewingRunning) return;
    setElapsedNow(Date.now());
    const id = setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [viewingRunning]);

  // 仅本 studio (image) 的活动任务，按时间倒序
  const imageActiveTasks = useMemo(
    () => activeTasks.filter((t) => t.type === 'image'),
    [activeTasks],
  );

  const model = useMemo(() => getT2IModelById(selectedImageModel), [selectedImageModel]);

  // Dynamic capabilities based on selected model（无定义时回退到通用列表）
  const aspectRatios = useMemo(() => {
    const list = getAspectRatiosForT2IModel(selectedImageModel);
    return list.length > 0 ? (list.includes('auto') ? list : ['auto', ...list]) : DEFAULT_ASPECT_RATIOS;
  }, [selectedImageModel]);

  // 模型切换后，避免保留上一个模型不支持的比例并继续提交到接口。
  useEffect(() => {
    if (aspectRatios.includes(imageAspectRatio)) return;
    setImageAspectRatio(aspectRatios[0] || 'auto');
  }, [aspectRatios, imageAspectRatio, setImageAspectRatio]);

  const resolutions = useMemo(() => {
    const list = (model?.inputs?.resolution?.enum as string[]) || [];
    return list.length > 0 ? list : DEFAULT_RESOLUTIONS;
  }, [model]);

  useEffect(() => {
    if (resolutions.length === 0) return;
    const current = imageResolution || '';
    const exact = current && resolutions.includes(current);
    if (exact) return;

    const caseInsensitiveMatch = current
      ? resolutions.find((r) => String(r).toLowerCase() === current.toLowerCase())
      : undefined;
    setImageResolution(caseInsensitiveMatch || resolutions[0]);
  }, [imageResolution, resolutions, setImageResolution]);

  // Midjourney-specific params
  const hasMidjourneyParams = /midjourney|^mj_|^niji-/i.test(selectedImageModel);
  const selectedMidjourneyBotType = String(
    imageExtraParams.botType || (/^niji-/i.test(selectedImageModel) ? 'NIJI_JOURNEY' : 'MID_JOURNEY'),
  );
  const hasIdeogramParams = selectedImageModel.includes('ideogram');

  const addReferenceFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    const remaining = MAX_REFERENCE_IMAGES - imageReferenceImages.length;
    if (remaining <= 0) {
      toast.error(`最多只能添加 ${MAX_REFERENCE_IMAGES} 张参考图`);
      return;
    }
    const accepted = imageFiles.slice(0, remaining);
    if (imageFiles.length > remaining) {
      toast.warning(`只添加了前 ${remaining} 张，参考图上限为 ${MAX_REFERENCE_IMAGES} 张`);
    }
    try {
      const dataUrls = await Promise.all(accepted.map(fileToDataUrl));
      setImageReferenceImages([...imageReferenceImages, ...dataUrls]);
    } catch (err: any) {
      toast.error(err?.message || '读取图片失败');
    }
  }, [imageReferenceImages, setImageReferenceImages]);

  const removeReference = useCallback((index: number) => {
    setImageReferenceImages(imageReferenceImages.filter((_, i) => i !== index));
  }, [imageReferenceImages, setImageReferenceImages]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length > 0) void addReferenceFiles(files);
  }, [addReferenceFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }, [isDragOver]);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const onFileInputChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (files.length > 0) await addReferenceFiles(files);
  }, [addReferenceFiles]);

  const handleGenerate = useCallback(async () => {
    // 开始新任务前，关闭上一次保留的失败提示
    toast.dismiss('freedom-image-error');
    if (!imagePrompt.trim()) {
      toast.error('请输入描述文字');
      return;
    }

    const taskId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const controller = new AbortController();
    const startedAt = Date.now();

    // 快照当前参数（避免后台运行期间用户改了 store 状态影响任务）
    const snapshot = {
      projectId: useProjectStore.getState().activeProjectId || undefined,
      prompt: imagePrompt,
      model: selectedImageModel,
      aspectRatio: imageAspectRatio,
      resolution: imageResolution || undefined,
      extraParams: {
        ...(hasMidjourneyParams ? {
          speed: DEFAULT_MIDJOURNEY_SPEED,
          stylization: DEFAULT_MIDJOURNEY_STYLIZATION,
        } : {}),
        ...imageExtraParams,
      },
      referenceImages: [...imageReferenceImages],
      thumbnail: imageReferenceImages[0],
    };

    // 写入 store activeTasks，组件卸载/页面跳转后任务仍继续运行
    addActiveTask({
      id: taskId,
      projectId: snapshot.projectId,
      type: 'image',
      prompt: snapshot.prompt,
      model: snapshot.model,
      status: 'running',
      percent: 5,
      message: '准备中…',
      createdAt: Date.now(),
      thumbnailUrl: snapshot.thumbnail,
      controller,
    });

    setSelectedTaskId(taskId);
    setSelectedHistoryEntry(null);
    setImageGenerating(true);
    setImageResult(null);

    // 后台异步执行：不 await，保证组件可立即返回；任务通过 store 通信
    void (async () => {
      try {
        const result = await generateFreedomImage({
          prompt: snapshot.prompt,
          projectId: snapshot.projectId,
          model: snapshot.model,
          aspectRatio: snapshot.aspectRatio,
          resolution: snapshot.resolution,
          extraParams: Object.keys(snapshot.extraParams).length > 0 ? snapshot.extraParams : undefined,
          referenceImages: snapshot.referenceImages.length > 0 ? snapshot.referenceImages : undefined,
          signal: controller.signal,
          onProgress: ({ percent, message }) => {
            updateActiveTask(taskId, { percent, message: message || '生成中…' });
          },
        });

        updateActiveTask(taskId, {
          status: 'done',
          percent: 100,
          message: '完成',
          resultUrl: result.url,
        });

        addHistoryEntry({
          id: taskId,
          prompt: snapshot.prompt,
          model: snapshot.model,
          resultUrl: result.url,
          params: {
            aspectRatio: snapshot.aspectRatio,
            resolution: snapshot.resolution,
            referenceCount: snapshot.referenceImages.length,
            ...(result.metadata?.mjGrid ? {
              mjGrid: true,
              mjTaskId: result.metadata.mjTaskId,
              mjBotType: result.metadata.mjBotType,
            } : {}),
            ...snapshot.extraParams,
          },
          metadata: result.metadata,
          createdAt: Date.now(),
          durationMs: Date.now() - startedAt,
          mediaId: result.mediaId,
          type: 'image',
        }, snapshot.projectId);

        // 同步预览主图（仅当用户当前查看的就是此任务）
        useFreedomStore.setState((s) => {
          if (selectedTaskIdRef.current === taskId || !s.imageResult) {
            return { imageResult: result.url };
          }
          return {};
        });

        toast.success('图片生成成功！已保存到素材库');

        // 完成后短暂保留卡片，再自动移除
        setTimeout(() => removeActiveTask(taskId), 4000);
      } catch (err: any) {
        if (err instanceof FreedomCancelledError || err?.name === 'AbortError') {
          updateActiveTask(taskId, { status: 'cancelled', message: '已取消' });
          toast.info('已取消生成任务');
          setTimeout(() => removeActiveTask(taskId), 2500);
        } else {
          updateActiveTask(taskId, { status: 'error', message: err?.message || '生成失败', error: err?.message });
          // 保留提示直到下一次生成（duration: Infinity + 固定 id）
          toast.error(`生成失败: ${err?.message || err}`, {
            id: 'freedom-image-error',
            duration: Infinity,
            closeButton: true,
          });
          setTimeout(() => removeActiveTask(taskId), 6000);
        }
      } finally {
        // 仅当没有其他正在跑的图片任务时，才清掉全局 generating 标志
        const stillRunning = useFreedomStore
          .getState()
          .activeTasks.some((t) => t.type === 'image' && t.status === 'running');
        if (!stillRunning) setImageGenerating(false);
      }
    })();
  }, [
    imagePrompt, selectedImageModel, imageAspectRatio, imageResolution, hasMidjourneyParams,
    imageExtraParams, imageReferenceImages,
    addActiveTask, updateActiveTask, removeActiveTask, addHistoryEntry,
    setImageGenerating, setImageResult,
  ]);

  // 用 ref 跟踪当前选中任务（异步回调里读到最新值）
  const selectedTaskIdRef = useRef<string | null>(null);
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId; }, [selectedTaskId]);

  const handleCancelTask = useCallback((taskId: string) => {
    cancelActiveTask(taskId);
  }, [cancelActiveTask]);

  // 组件挂载时兜底：若 store 残留 imageGenerating=true 但无运行中任务，立即复位
  useEffect(() => {
    const hasRunning = useFreedomStore
      .getState()
      .activeTasks.some((t) => t.type === 'image' && t.status === 'running');
    if (imageGenerating && !hasRunning) {
      setImageGenerating(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateExtraParam = (key: string, value: any) => {
    setImageExtraParams({ ...imageExtraParams, [key]: value });
  };

  return (
    <div className="flex h-full">
      {/* Left: Controls */}
      <div className="w-[340px] border-r flex flex-col">
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Model Selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">模型选择</Label>
              <ModelSelector
                type="image"
                value={selectedImageModel}
                onChange={setSelectedImageModel}
              />
              {model && (
                <p className="text-xs text-muted-foreground">
                  ID: {selectedImageModel}
                </p>
              )}
            </div>

            {/* Aspect Ratio */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">宽高比</Label>
              <div className="flex flex-wrap gap-1.5">
                {aspectRatios.map((ratio) => (
                  <Button
                    key={ratio}
                    variant={imageAspectRatio === ratio ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs px-2.5"
                    onClick={() => setImageAspectRatio(ratio)}
                  >
                    {ratio}
                  </Button>
                ))}
              </div>
            </div>

            {/* Resolution */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">分辨率</Label>
              <Select value={imageResolution || ''} onValueChange={setImageResolution}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="选择分辨率（可选）" />
                </SelectTrigger>
                <SelectContent>
                  {resolutions.map((r) => (
                    <SelectItem key={r} value={String(r)}>{String(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Midjourney Params */}
            {hasMidjourneyParams && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Bot 类型</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {MIDJOURNEY_BOT_TYPES.map((bot) => (
                      <Button
                        key={bot.value}
                        type="button"
                        variant={selectedMidjourneyBotType === bot.value ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 text-xs px-2"
                        onClick={() => updateExtraParam('botType', bot.value)}
                      >
                        {bot.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">速度</Label>
                  <Select
                    value={imageExtraParams.speed || DEFAULT_MIDJOURNEY_SPEED}
                    onValueChange={(v) => updateExtraParam('speed', v)}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relaxed">Relaxed</SelectItem>
                      <SelectItem value="fast">Fast</SelectItem>
                      <SelectItem value="turbo">Turbo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Stylization</Label>
                    <span className="text-xs text-muted-foreground">{imageExtraParams.stylization || DEFAULT_MIDJOURNEY_STYLIZATION}</span>
                  </div>
                  <Slider
                    min={0} max={1000} step={1}
                    value={[imageExtraParams.stylization || DEFAULT_MIDJOURNEY_STYLIZATION]}
                    onValueChange={([v]) => updateExtraParam('stylization', v)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Label className="text-sm">Weirdness</Label>
                    <span className="text-xs text-muted-foreground">{imageExtraParams.weirdness || 1}</span>
                  </div>
                  <Slider
                    min={0} max={3000} step={1}
                    value={[imageExtraParams.weirdness || 1]}
                    onValueChange={([v]) => updateExtraParam('weirdness', v)}
                  />
                </div>
              </>
            )}

            {/* Ideogram Params */}
            {hasIdeogramParams && (
              <>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">渲染速度</Label>
                  <Select
                    value={imageExtraParams.render_speed || 'Balanced'}
                    onValueChange={(v) => updateExtraParam('render_speed', v)}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Turbo">Turbo</SelectItem>
                      <SelectItem value="Balanced">Balanced</SelectItem>
                      <SelectItem value="Quality">Quality</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">风格</Label>
                  <Select
                    value={imageExtraParams.style || 'Auto'}
                    onValueChange={(v) => updateExtraParam('style', v)}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Auto">Auto</SelectItem>
                      <SelectItem value="General">General</SelectItem>
                      <SelectItem value="Realistic">Realistic</SelectItem>
                      <SelectItem value="Design">Design</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Reference Images (drag & drop, max 10) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">参考图</Label>
                <span className="text-xs text-muted-foreground">
                  {imageReferenceImages.length}/{MAX_REFERENCE_IMAGES}
                </span>
              </div>

              {imageReferenceImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {imageReferenceImages.map((src, index) => (
                    <div key={index} className="relative rounded border overflow-hidden group/ref">
                      <img
                        src={src}
                        alt={`参考图 ${index + 1}`}
                        className="h-20 w-full object-cover"
                      />
                      <button
                        type="button"
                        className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover/ref:opacity-100 transition-opacity"
                        onClick={() => removeReference(index)}
                        aria-label="移除参考图"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {imageReferenceImages.length < MAX_REFERENCE_IMAGES && (
                <div
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onDragLeave={onDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                  className={cn(
                    "rounded-md border border-dashed flex flex-col items-center justify-center gap-1 px-3 py-4 cursor-pointer transition-colors",
                    "text-muted-foreground hover:text-foreground hover:border-primary/40",
                    isDragOver && "border-primary bg-primary/5 text-foreground",
                  )}
                >
                  <Upload className="h-4 w-4" />
                  <span className="text-xs">拖入图片或点击选择（最多 {MAX_REFERENCE_IMAGES} 张）</span>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={onFileInputChange}
              />
            </div>

            {/* Prompt Input */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">描述文字</Label>
              <PromptTextarea
                placeholder="描述你想生成的图片..."
                value={imagePrompt}
                onChange={setImagePrompt}
                expandTitle="编辑描述文字（图片生成）"
                className="min-h-[120px] resize-none"
              />
            </div>

            {/* Generate Button */}
            <Button
              className="w-full h-11"
              onClick={handleGenerate}
              disabled={!imagePrompt.trim()}
            >
              <Sparkles className="mr-2 h-4 w-4" /> 生成图片
              {imageActiveTasks.filter((t) => t.status === 'running').length > 0 && (
                <span className="ml-1 text-xs opacity-80">
                  ({imageActiveTasks.filter((t) => t.status === 'running').length} 个进行中)
                </span>
              )}
            </Button>
          </div>
        </ScrollArea>
      </div>

      {/* Center: Result */}
      <div className="flex-1 flex items-center justify-center p-8 bg-muted/30">
        {viewingTask && (viewingTask.status === 'running' || viewingTask.status === 'cancelling') ? (
          <div className="flex flex-col items-center gap-4 w-full max-w-md">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm font-medium">{viewingTask.message || '图片生成中，请稍候...'}</p>
            <div className="w-full space-y-1.5">
              <Progress value={viewingTask.percent} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{viewingTask.percent}%</span>
                <span>可切换页面，任务将在后台继续</span>
              </div>
              <div className="flex justify-end">
                <span className="text-[11px] text-muted-foreground/70 tabular-nums">
                  已等待 {formatElapsed(elapsedNow - viewingTask.createdAt)}
                </span>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleCancelTask(viewingTask.id)}
              disabled={viewingTask.status === 'cancelling'}
              className="mt-1"
            >
              <StopCircle className="h-4 w-4 mr-1.5" />
              {viewingTask.status === 'cancelling' ? '正在取消…' : '取消任务'}
            </Button>
          </div>
        ) : viewingTask && viewingTask.status === 'error' ? (
          <div className="flex flex-col items-center gap-3 text-destructive max-w-md text-center">
            <X className="h-12 w-12" />
            <p className="text-sm font-medium">生成失败</p>
            <p className="text-xs text-muted-foreground">{viewingTask.error || viewingTask.message}</p>
          </div>
        ) : (viewingTask?.resultUrl || imageResult) ? (
          <div className="flex max-h-full max-w-full flex-col items-center gap-3">
            <div className="relative group max-w-full">
              <img
                src={viewingTask?.resultUrl || imageResult || ''}
                alt="Generated"
                className="max-w-full max-h-[calc(100vh-260px)] rounded-lg shadow-lg object-contain"
              />
              <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setSaveToPropsOpen(true)}>
                  <Archive className="h-4 w-4 mr-1" /> 保存到道具库
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void handleDownloadImage()}>
                  <Download className="h-4 w-4 mr-1" /> 下载
                </Button>
              </div>
            </div>
            {selectedHistoryIsMjGrid && (
              <div className="w-full max-w-3xl rounded-lg border bg-background p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">Midjourney 四宫格拆分</p>
                    <p className="text-[11px] text-muted-foreground">历史记录保留为一组，下方子图可分别下载</p>
                  </div>
                  {selectedHistoryEntry?.metadata?.mjTaskId && (
                    <span className="text-[10px] text-muted-foreground">任务 {String(selectedHistoryEntry.metadata.mjTaskId)}</span>
                  )}
                </div>
                {mjSplitLoading ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在拆分图片…
                  </div>
                ) : mjSplitError ? (
                  <p className="text-xs text-destructive">{mjSplitError}</p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {mjSplitImages.map((url, index) => (
                      <div key={index} className="overflow-hidden rounded-md border bg-muted">
                        <img src={url} alt={`MJ 子图 ${index + 1}`} className="aspect-square w-full object-cover" />
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-7 w-full rounded-none text-[11px]"
                          onClick={() => void handleDownloadSplitImage(url, index)}
                        >
                          下载图 {index + 1}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <ImageIcon className="h-16 w-16 opacity-20" />
            <p className="text-lg font-medium">图片工作室</p>
            <p className="text-sm">选择模型，输入描述，生成你想要的图片</p>
          </div>
        )}
      </div>

      {/* Right: Active tasks + History */}
      <div className="w-[260px] border-l flex flex-col">
        {imageActiveTasks.length > 0 && (
          <div className="border-b">
            <div className="px-3 py-2 border-b">
              <span className="text-sm font-medium">当前任务 ({imageActiveTasks.length})</span>
            </div>
            <div className="p-2 space-y-2 max-h-[40vh] overflow-y-auto">
              {imageActiveTasks.map((t) => (
                <ActiveTaskCard
                  key={t.id}
                  task={t}
                  selected={selectedTaskId === t.id}
                  onSelect={() => setSelectedTaskId(t.id)}
                  onCancel={() => handleCancelTask(t.id)}
                  onDismiss={() => {
                    removeActiveTask(t.id);
                    if (selectedTaskId === t.id) setSelectedTaskId(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div className="flex-1 min-h-0">
          <GenerationHistory type="image" onSelect={(entry) => {
            setSelectedImageModel(entry.model);
            setImageResult(entry.resultUrl);
            setSelectedTaskId(null);
            setSelectedHistoryEntry(entry);
          }} />
        </div>
      </div>

      {/* 保存到道具库弹窗 */}
      {imageResult && (
        <SaveToPropsDialog
          open={saveToPropsOpen}
          onOpenChange={setSaveToPropsOpen}
          imageUrl={imageResult}
          prompt={imagePrompt}
        />
      )}
    </div>
  );
}
