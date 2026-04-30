"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { VideoIcon, Loader2, Download, Sparkles, Upload, X, Type, ImageIcon, Layers, Film, Music, StopCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PromptTextarea, type PromptTextareaRef } from './PromptTextarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { useFreedomStore, type VideoFeatureMode, type ImageToVideoSubMode } from '@/stores/freedom-store';
import { useAPIConfigStore } from '@/stores/api-config-store';
import { ModelSelector } from './ModelSelector';
import { GenerationHistory } from './GenerationHistory';
import { ActiveTaskCard, formatElapsed } from './ActiveTaskCard';
import { generateFreedomVideo, FreedomCancelledError, type FreedomVideoUploadFile, type FreedomVideoUploadRole } from '@/lib/freedom/freedom-api';
import {
  getAspectRatiosForT2VModel,
  getDurationsForModel,
  getResolutionsForModel,
} from '@/lib/freedom/model-registry';
import { resolveVeoUploadCapability, type VeoUploadCapability } from '@/lib/freedom/veo-capability';

// ==================== 宽高比和分辨率常量 ====================

const ASPECT_RATIO_OPTIONS = [
  { value: '21:9', label: '21:9', desc: '超宽屏' },
  { value: '16:9', label: '16:9', desc: '宽屏' },
  { value: '4:3', label: '4:3', desc: '标准' },
  { value: '1:1', label: '1:1', desc: '正方形' },
  { value: '3:4', label: '3:4', desc: '竖屏' },
  { value: '9:16', label: '9:16', desc: '手机竖屏' },
] as const;

const RESOLUTION_OPTIONS = [
  { value: '480p', label: '480p', desc: 'SD 标清' },
  { value: '720p', label: '720p', desc: 'HD 高清' },
  { value: '1080p', label: '1080p', desc: 'FHD 全高清' },
] as const;

const FEATURE_MODE_OPTIONS: { value: VideoFeatureMode; label: string; icon: React.ReactNode; desc: string }[] = [
  { value: 'text-to-video', label: '文生视频', icon: <Type className="h-4 w-4" />, desc: '输入文字描述生成视频' },
  { value: 'image-to-video', label: '图生视频', icon: <ImageIcon className="h-4 w-4" />, desc: '上传图片生成视频' },
  { value: 'multi-reference', label: '多功能参考', icon: <Layers className="h-4 w-4" />, desc: '上传多个视频、图片、音频' },
];

const I2V_SUB_MODE_OPTIONS: { value: ImageToVideoSubMode; label: string; desc: string }[] = [
  { value: 'first-frame', label: '首帧功能', desc: '上传一张图片作为视频起始帧' },
  { value: 'first-last-frame', label: '首尾帧功能', desc: '上传首帧和尾帧图片' },
];

/** 多功能参考模式常量 */
const MULTI_REF_MAX_ASSETS = 12;
const MULTI_REF_AUDIO_MAX_SECONDS = 15;

/** Seedance 多功能参考模式可选视频时长范围 (4s–15s) */
const SEEDANCE_MULTI_REF_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] as const;

interface LocalUploadAsset {
  id: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  localPath?: string;
  fileSize?: number;
}

/** 多功能参考模式的资源类型 */
type MultiRefAssetType = 'video' | 'image' | 'audio';

interface MultiRefAsset {
  id: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  assetType: MultiRefAssetType;
  /** 音频时长（秒），仅 audio 类型有值 */
  audioDuration?: number;
  localPath?: string;
  fileSize?: number;
}function resolveVideoCapabilityModelId(modelId: string): string {
  const lower = modelId.toLowerCase();
  // Kling 版本化模型（kling-v* / kling-video-o1）沿用 kling-video 的能力定义
  if (/^kling-v/i.test(modelId) || modelId === 'kling-video-o1') {
    return 'kling-video';
  }
  // Veo 版本化模型沿用家族基础能力定义，避免 components/frames 变体丢失参数控件
  if (/^veo_3_1/i.test(modelId)) {
    return 'veo_3_1';
  }
  if (lower.startsWith('veo3.1')) {
    return 'veo3.1';
  }
  if (/^veo3/i.test(modelId)) {
    return 'veo3';
  }
  if (/^veo2/i.test(modelId)) {
    return 'veo2';
  }
  if (/^vidu/i.test(modelId) || modelId === 'aigc-video-vidu') {
    return 'vidu2.0';
  }
  if (/^doubao-seedance-/i.test(modelId)) {
    if (modelId.includes('pro-fast')) return 'seedance-pro-t2v-fast';
    if (modelId.includes('lite')) return 'seedance-lite-t2v';
    return 'seedance-pro-t2v';
  }
  if (lower.startsWith('minimax/video-01')) {
    return 'minimax-hailuo-02-standard-t2v';
  }
  return modelId;
}

/** 判断模型是否属于 Seedance 组别 */
function isSeedanceGroupModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.includes('seedance');
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** 获取音频文件时长（秒） */
function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(dur) ? dur : 0);
    });
    audio.addEventListener('error', () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取音频时长'));
    });
    audio.src = url;
  });
}

function getVeoUploadValidationError(
  capability: VeoUploadCapability,
  singleUpload: LocalUploadAsset | null,
  firstFrameUpload: LocalUploadAsset | null,
  lastFrameUpload: LocalUploadAsset | null,
  referenceUploads: LocalUploadAsset[],
): string | null {
  if (!capability.isVeo || capability.mode === 'none') return null;

  if (capability.mode === 'single') {
    if (capability.minFiles > 0 && !singleUpload && !firstFrameUpload) {
      return '当前模型需要上传 1 张图片';
    }
    return null;
  }

  if (capability.mode === 'first_last') {
    if (capability.minFiles > 0 && !firstFrameUpload) {
      return '当前模型需要上传首帧图片';
    }
    if (!firstFrameUpload && lastFrameUpload) {
      return '请先上传首帧图，再上传尾帧图';
    }
    return null;
  }

  if (capability.mode === 'multi') {
    if (referenceUploads.length < capability.minFiles) {
      return `当前模型至少需要 ${capability.minFiles} 张参考图`;
    }
    if (referenceUploads.length > capability.maxFiles) {
      return `当前模型最多支持 ${capability.maxFiles} 张参考图`;
    }
  }

  return null;
}

function buildVeoUploadFiles(
  capability: VeoUploadCapability,
  singleUpload: LocalUploadAsset | null,
  firstFrameUpload: LocalUploadAsset | null,
  lastFrameUpload: LocalUploadAsset | null,
  referenceUploads: LocalUploadAsset[],
): FreedomVideoUploadFile[] {
  if (!capability.isVeo || capability.mode === 'none') return [];

  if (capability.mode === 'single') {
    const file = singleUpload || firstFrameUpload;
    if (!file) return [];
    return [{
      role: 'single',
      dataUrl: file.dataUrl,
      fileName: file.fileName,
      mimeType: file.mimeType,
    }];
  }

  if (capability.mode === 'first_last') {
    const files: FreedomVideoUploadFile[] = [];
    if (firstFrameUpload) {
      files.push({
        role: 'first',
        dataUrl: firstFrameUpload.dataUrl,
        fileName: firstFrameUpload.fileName,
        mimeType: firstFrameUpload.mimeType,
      });
    }
    if (lastFrameUpload) {
      files.push({
        role: 'last',
        dataUrl: lastFrameUpload.dataUrl,
        fileName: lastFrameUpload.fileName,
        mimeType: lastFrameUpload.mimeType,
      });
    }
    return files;
  }

  if (capability.mode === 'multi') {
    return referenceUploads.slice(0, capability.maxFiles).map((file) => ({
      role: 'reference',
      dataUrl: file.dataUrl,
      fileName: file.fileName,
      mimeType: file.mimeType,
    }));
  }

  return [];
}

export function VideoStudio() {
  const {
    videoPrompt, setVideoPrompt,
    selectedVideoModel, setSelectedVideoModel,
    videoAspectRatio, setVideoAspectRatio,
    videoDuration, setVideoDuration,
    videoResolution, setVideoResolution,
    videoResult, setVideoResult,
    videoGenerating, setVideoGenerating,
    videoFeatureMode, setVideoFeatureMode,
    videoI2VSubMode, setVideoI2VSubMode,
    videoSingleUpload: singleUpload,
    setVideoSingleUpload: setSingleUpload,
    videoFirstFrameUpload: firstFrameUpload,
    setVideoFirstFrameUpload: setFirstFrameUpload,
    videoLastFrameUpload: lastFrameUpload,
    setVideoLastFrameUpload: setLastFrameUpload,
    videoReferenceUploads: referenceUploads,
    setVideoReferenceUploads: setReferenceUploads,
    videoMultiRefAssets: multiRefAssets,
    setVideoMultiRefAssets: setMultiRefAssets,
    clearVideoUploads,
    uploadProgress,
    setUploadProgress,
    addHistoryEntry,
    activeTasks,
    addActiveTask,
    updateActiveTask,
    removeActiveTask,
    cancelActiveTask,
  } = useFreedomStore();

  const modelEndpointTypes = useAPIConfigStore((s) => s.modelEndpointTypes);
  const endpointTypes = useMemo(
    () => modelEndpointTypes[selectedVideoModel] || [],
    [modelEndpointTypes, selectedVideoModel],
  );

  // 当前选中的任务 ID（用于在中央预览区展示任务进度）
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null);
  selectedTaskIdRef.current = selectedTaskId;

  const promptTextareaRef = useRef<PromptTextareaRef>(null);

  // 仅本 studio (video) 的活动任务
  const videoActiveTasks = useMemo(
    () => activeTasks.filter((t) => t.type === 'video'),
    [activeTasks],
  );

  // 当前正在查看的任务（用于中央区域展示进度/结果）
  const viewingTask = useMemo(
    () => (selectedTaskId ? activeTasks.find((t) => t.id === selectedTaskId) : null) || null,
    [selectedTaskId, activeTasks],
  );

  // 用于实时显示"已等待 Xs"，仅当主预览区有运行中任务时每秒刷新
  const viewingRunning = !!viewingTask && (viewingTask.status === 'running' || viewingTask.status === 'cancelling');
  const [elapsedNow, setElapsedNow] = useState(() => Date.now());
  useEffect(() => {
    if (!viewingRunning) return;
    setElapsedNow(Date.now());
    const id = setInterval(() => setElapsedNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [viewingRunning]);

  const handleCancelTask = useCallback((taskId: string) => {
    cancelActiveTask(taskId);
  }, [cancelActiveTask]);

  const capabilityModelId = useMemo(
    () => resolveVideoCapabilityModelId(selectedVideoModel),
    [selectedVideoModel],
  );

  const aspectRatios = useMemo(() => getAspectRatiosForT2VModel(capabilityModelId), [capabilityModelId]);
  const durations = useMemo(() => getDurationsForModel(capabilityModelId), [capabilityModelId]);
  const resolutions = useMemo(() => getResolutionsForModel(capabilityModelId), [capabilityModelId]);
  const veoCapability = useMemo(
    () => resolveVeoUploadCapability(selectedVideoModel, endpointTypes),
    [selectedVideoModel, endpointTypes],
  );

  const singleInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  /** 是否属于 seedance 组 */
  const isSeedance = useMemo(() => isSeedanceGroupModel(selectedVideoModel), [selectedVideoModel]);

  const multiRefInputRef = useRef<HTMLInputElement>(null);

  /** 计算当前功能模式下可用的 feature mode 列表（多功能参考仅对 seedance） */
  const availableFeatureModes = useMemo(() => {
    return FEATURE_MODE_OPTIONS.filter(
      (opt) => opt.value !== 'multi-reference' || isSeedance,
    );
  }, [isSeedance]);

  /** 当前模型不支持多功能参考时，自动回退 */
  useEffect(() => {
    if (videoFeatureMode === 'multi-reference' && !isSeedance) {
      setVideoFeatureMode('text-to-video');
    }
  }, [isSeedance, videoFeatureMode, setVideoFeatureMode]);

  /** 仅在用户**主动切换模型**时清空已上传素材；mount 时不清空，避免切 Tab 后丢失。 */
  const prevVideoModelRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevVideoModelRef.current !== null && prevVideoModelRef.current !== selectedVideoModel) {
      clearVideoUploads();
    }
    prevVideoModelRef.current = selectedVideoModel;
  }, [selectedVideoModel, clearVideoUploads]);

  /** 订阅主进程对象存储上传进度（按 localPath → asset.id 映射） */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.objectStorage?.onProgress) return;
    const off = window.objectStorage.onProgress(({ filePath, loaded, total }) => {
      // 在当前所有上传素材中按 localPath 找到对应 asset.id
      const matches: { id: string }[] = [];
      multiRefAssets.forEach((a) => { if (a.localPath === filePath) matches.push({ id: a.id }); });
      referenceUploads.forEach((a) => { if (a.localPath === filePath) matches.push({ id: a.id }); });
      if (singleUpload?.localPath === filePath) matches.push({ id: singleUpload.id });
      if (firstFrameUpload?.localPath === filePath) matches.push({ id: firstFrameUpload.id });
      if (lastFrameUpload?.localPath === filePath) matches.push({ id: lastFrameUpload.id });
      const status: 'uploading' | 'done' = total > 0 && loaded >= total ? 'done' : 'uploading';
      matches.forEach(({ id }) => setUploadProgress(id, { loaded, total, status }));
    });
    return () => { off(); };
  }, [multiRefAssets, referenceUploads, singleUpload, firstFrameUpload, lastFrameUpload, setUploadProgress]);

  const toAsset = useCallback(async (file: File): Promise<LocalUploadAsset> => {
    const dataUrl = await fileToDataUrl(file);
    const localPath = (() => {
      try {
        return window.objectStorage?.getPathForFile(file) || undefined;
      } catch {
        return undefined;
      }
    })();
    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      dataUrl,
      fileName: file.name,
      mimeType: file.type || 'image/png',
      localPath,
      fileSize: file.size,
    };
  }, []);

  /** 仅接受图片文件 */
  const pickImageFile = (files: FileList | File[] | null | undefined): File | null => {
    if (!files) return null;
    const arr = Array.from(files as ArrayLike<File>);
    return arr.find((f) => f.type.startsWith('image/')) ?? arr[0] ?? null;
  };

  const ingestSingleImage = useCallback(async (
    file: File | null | undefined,
    setter: (asset: LocalUploadAsset | null) => void,
  ) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('请上传图片文件');
      return;
    }
    try {
      setter(await toAsset(file));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [toAsset]);

  const handleSingleUploadChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = pickImageFile(e.target.files);
    e.target.value = '';
    await ingestSingleImage(file, setSingleUpload);
  }, [ingestSingleImage, setSingleUpload]);

  const handleFirstFrameChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = pickImageFile(e.target.files);
    e.target.value = '';
    await ingestSingleImage(file, setFirstFrameUpload);
  }, [ingestSingleImage, setFirstFrameUpload]);

  const handleLastFrameChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = pickImageFile(e.target.files);
    e.target.value = '';
    await ingestSingleImage(file, setLastFrameUpload);
  }, [ingestSingleImage, setLastFrameUpload]);

  const ingestReferenceImages = useCallback(async (files: File[]) => {
    const remaining = Math.max(veoCapability.maxFiles, 1) - referenceUploads.length;
    if (remaining <= 0) {
      toast.error(`当前模型最多支持 ${veoCapability.maxFiles} 张参考图`);
      return;
    }
    const accepted = files.filter((f) => f.type.startsWith('image/')).slice(0, remaining);
    if (accepted.length === 0) {
      toast.error('请上传图片文件');
      return;
    }
    try {
      const assets = await Promise.all(accepted.map(toAsset));
      setReferenceUploads((prev) => [...prev, ...assets]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [referenceUploads.length, setReferenceUploads, toAsset, veoCapability.maxFiles]);

  const handleReferenceChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    if (files.length === 0) return;
    await ingestReferenceImages(files);
  }, [ingestReferenceImages]);

  const removeReference = useCallback((id: string) => {
    setReferenceUploads((prev) => prev.filter((item) => item.id !== id));
  }, [setReferenceUploads]);

  /** 多功能参考模式：处理一组文件（支持视频/图片/音频，依次入队） */
  const ingestMultiRefFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;

    let remaining = MULTI_REF_MAX_ASSETS - multiRefAssets.length;
    if (remaining <= 0) {
      toast.error(`最多支持上传 ${MULTI_REF_MAX_ASSETS} 个参考素材`);
      return;
    }

    let existingAudioTotal = multiRefAssets
      .filter((a) => a.assetType === 'audio')
      .reduce((sum, a) => sum + (a.audioDuration ?? 0), 0);

    const newAssets: MultiRefAsset[] = [];

    for (const file of files) {
      if (remaining <= 0) {
        toast.error(`最多支持上传 ${MULTI_REF_MAX_ASSETS} 个参考素材`);
        break;
      }
      try {
        let assetType: MultiRefAssetType = 'image';
        if (file.type.startsWith('video/')) assetType = 'video';
        else if (file.type.startsWith('audio/')) assetType = 'audio';
        else if (!file.type.startsWith('image/')) {
          // 不支持的类型，跳过
          continue;
        }

        // 视频 1GB 限制
        if (assetType === 'video' && file.size > 1024 * 1024 * 1024) {
          toast.error(`视频文件 ${file.name} 超过 1GB 限制（${(file.size / 1024 / 1024).toFixed(1)} MB）`);
          continue;
        }

        let audioDuration: number | undefined;
        if (assetType === 'audio') {
          audioDuration = await getAudioDuration(file);
          if (existingAudioTotal + audioDuration > MULTI_REF_AUDIO_MAX_SECONDS) {
            toast.error(
              `音频总时长不能超过 ${MULTI_REF_AUDIO_MAX_SECONDS} 秒（已 ${Math.round(existingAudioTotal)}s，新增 ${Math.round(audioDuration)}s）`,
            );
            continue;
          }
          existingAudioTotal += audioDuration;
        }

        // 视频/音频不读 dataUrl（避免数百MB base64 内存爆），仅保留 localPath
        const localPath = (() => {
          try {
            return window.objectStorage?.getPathForFile(file) || undefined;
          } catch {
            return undefined;
          }
        })();

        let dataUrl = '';
        if (assetType === 'image') {
          dataUrl = await fileToDataUrl(file);
        } else if (!localPath) {
          // 视频/音频但拿不到本地路径（极少见，例如来自浏览器 Blob），降级读 dataUrl
          dataUrl = await fileToDataUrl(file);
        }

        newAssets.push({
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          dataUrl,
          fileName: file.name,
          mimeType: file.type,
          assetType,
          audioDuration,
          localPath,
          fileSize: file.size,
        });
        remaining -= 1;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '读取文件失败';
        toast.error(message);
      }
    }

    if (newAssets.length > 0) {
      setMultiRefAssets((prev) => [...prev, ...newAssets]);
    }
  }, [multiRefAssets, setMultiRefAssets]);

  /** 多功能参考模式：上传文件（视频/图片/音频） */
  const handleMultiRefChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    await ingestMultiRefFiles(files);
  }, [ingestMultiRefFiles]);

  const removeMultiRefAsset = useCallback((id: string) => {
    setMultiRefAssets((prev) => prev.filter((a) => a.id !== id));
    setUploadProgress(id, null);
  }, [setMultiRefAssets, setUploadProgress]);

  /** 计算某个素材在同类型中的序号标签，如 @image_file_1 */
  const getMultiRefTag = useCallback((assetId: string): string => {
    const asset = multiRefAssets.find((a) => a.id === assetId);
    if (!asset) return '';
    const prefix = asset.assetType === 'video' ? 'video_file' : asset.assetType === 'audio' ? 'audio_file' : 'image_file';
    const sameTypeIndex = multiRefAssets.filter((a) => a.assetType === asset.assetType).findIndex((a) => a.id === assetId) + 1;
    return `@${prefix}_${sameTypeIndex}`;
  }, [multiRefAssets]);

  /** 右键素材卡片 → 在光标位置插入引用标签 */
  const insertRefToPrompt = useCallback((assetId: string) => {
    const tag = getMultiRefTag(assetId);
    if (!tag) return;
    if (promptTextareaRef.current) {
      promptTextareaRef.current.insertAtCursor(tag);
      toast.success(`已在光标位置插入 ${tag}`);
    } else {
      // 回退：末尾追加
      const prev = videoPrompt;
      const sep = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
      setVideoPrompt(`${prev}${sep}${tag} `);
      toast.success(`已插入 ${tag}`);
    }
  }, [getMultiRefTag, videoPrompt, setVideoPrompt]);

  const veoUploadFiles = useMemo(
    () => buildVeoUploadFiles(
      veoCapability,
      singleUpload,
      firstFrameUpload,
      lastFrameUpload,
      referenceUploads,
    ),
    [veoCapability, singleUpload, firstFrameUpload, lastFrameUpload, referenceUploads],
  );

  const renderUploadSlot = (
    label: string,
    asset: LocalUploadAsset | null,
    onPick: () => void,
    onClear: () => void,
    required = false,
    onDropFile?: (file: File) => void,
  ) => {
    const dropProps = onDropFile
      ? {
          onDragOver: (e: React.DragEvent<HTMLDivElement>) => {
            if (e.dataTransfer.types.includes('Files')) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }
          },
          onDrop: (e: React.DragEvent<HTMLDivElement>) => {
            const file = pickImageFile(e.dataTransfer.files);
            if (!file) return;
            e.preventDefault();
            onDropFile(file);
          },
        }
      : {};

    return (
      <div
        className="rounded-md border p-2 space-y-2 transition-colors"
        {...dropProps}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium">
            {label}{required ? ' *' : ''}
          </span>
          {asset && (
            <button
              type="button"
              onClick={onClear}
              className="text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {asset ? (
          <img
            src={asset.dataUrl}
            alt={label}
            className="h-24 w-full rounded object-cover"
          />
        ) : (
          <button
            type="button"
            onClick={onPick}
            className="h-24 w-full rounded border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-primary/40"
          >
            <Upload className="h-4 w-4" />
            <span className="text-xs">点击或拖入图片</span>
          </button>
        )}
        {asset && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-7 text-xs"
            onClick={onPick}
            disabled={videoGenerating}
          >
            更换
          </Button>
        )}
      </div>
    );
  };

  const handleGenerate = useCallback(async () => {
    // 开始新任务前，关闭上一次保留的失败提示
    toast.dismiss('freedom-video-error');
    if (!videoPrompt.trim()) {
      toast.error('请输入描述文字');
      return;
    }

    // 图生视频模式验证
    if (videoFeatureMode === 'image-to-video') {
      if (videoI2VSubMode === 'first-frame' && !firstFrameUpload) {
        toast.error('请上传首帧图片');
        return;
      }
      if (videoI2VSubMode === 'first-last-frame' && !firstFrameUpload) {
        toast.error('请上传首帧图片');
        return;
      }
    }

    // 多功能参考模式验证
    if (videoFeatureMode === 'multi-reference') {
      if (multiRefAssets.length === 0) {
        toast.error('请上传至少一个参考素材');
        return;
      }
    }

    // Veo 验证（仅文生视频模式或 veo 模型时使用旧逻辑）
    if (videoFeatureMode === 'text-to-video') {
      const uploadError = getVeoUploadValidationError(
        veoCapability,
        singleUpload,
        firstFrameUpload,
        lastFrameUpload,
        referenceUploads,
      );
      if (uploadError) {
        toast.error(uploadError);
        return;
      }
    }

    // 快照当前参数
    const snapshot = {
      prompt: videoPrompt,
      model: selectedVideoModel,
      aspectRatio: videoAspectRatio,
      duration: videoDuration,
      resolution: videoResolution || undefined,
      featureMode: videoFeatureMode,
    };

    // 构建上传文件列表
    let uploadFiles: FreedomVideoUploadFile[] | undefined;

    if (videoFeatureMode === 'text-to-video') {
      uploadFiles = veoUploadFiles.length > 0 ? veoUploadFiles : undefined;
    } else if (videoFeatureMode === 'image-to-video') {
      const files: FreedomVideoUploadFile[] = [];
      if (firstFrameUpload) {
        files.push({
          role: 'first',
          dataUrl: firstFrameUpload.dataUrl,
          fileName: firstFrameUpload.fileName,
          mimeType: firstFrameUpload.mimeType,
        });
      }
      if (videoI2VSubMode === 'first-last-frame' && lastFrameUpload) {
        files.push({
          role: 'last',
          dataUrl: lastFrameUpload.dataUrl,
          fileName: lastFrameUpload.fileName,
          mimeType: lastFrameUpload.mimeType,
        });
      }
      uploadFiles = files.length > 0 ? files : undefined;
    } else if (videoFeatureMode === 'multi-reference') {
      uploadFiles = multiRefAssets.map((a) => ({
        role: 'reference' as FreedomVideoUploadRole,
        dataUrl: a.dataUrl,
        fileName: a.fileName,
        mimeType: a.mimeType,
        assetType: a.assetType,
        localPath: a.localPath,
      }));
    }

    // 创建任务
    const taskId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const controller = new AbortController();

    addActiveTask({
      id: taskId,
      type: 'video',
      prompt: snapshot.prompt,
      model: snapshot.model,
      status: 'running',
      percent: 5,
      message: '准备提交…',
      createdAt: Date.now(),
      controller,
    });

    setSelectedTaskId(taskId);
    setVideoGenerating(true);
    setVideoResult(null);

    // 后台异步执行：不 await，保证 UI 可立即返回
    void (async () => {
      // 预估进度定时器（视频生成通常 60-240 秒，模拟渐进进度）
      let estimatedPercent = 5;
      const progressTimer = setInterval(() => {
        if (estimatedPercent < 90) {
          // 缓慢递增，越接近 90% 越慢
          const increment = estimatedPercent < 30 ? 3 : estimatedPercent < 60 ? 2 : 1;
          estimatedPercent = Math.min(90, estimatedPercent + increment);
          updateActiveTask(taskId, {
            percent: estimatedPercent,
            message: estimatedPercent < 20 ? '提交任务中…' :
                     estimatedPercent < 50 ? '视频生成中…' :
                     estimatedPercent < 80 ? '渲染中，请耐心等待…' :
                     '即将完成…',
          });
        }
      }, 3000);

      try {
        const result = await generateFreedomVideo({
          prompt: snapshot.prompt,
          model: snapshot.model,
          aspectRatio: snapshot.aspectRatio,
          duration: snapshot.duration,
          resolution: snapshot.resolution,
          uploadFiles,
          signal: controller.signal,
        });

        clearInterval(progressTimer);

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
            duration: snapshot.duration,
            resolution: snapshot.resolution,
            featureMode: snapshot.featureMode,
            uploadCount: uploadFiles?.length ?? 0,
          },
          createdAt: Date.now(),
          mediaId: result.mediaId,
          type: 'video',
        });

        // 同步预览结果（仅当用户当前查看此任务时）
        useFreedomStore.setState((s) => {
          if (selectedTaskIdRef.current === taskId || !s.videoResult) {
            return { videoResult: result.url };
          }
          return {};
        });

        toast.success('视频生成成功！已保存到素材库');
        setTimeout(() => removeActiveTask(taskId), 4000);
      } catch (err: any) {
        clearInterval(progressTimer);

        if (err instanceof FreedomCancelledError || err?.name === 'AbortError') {
          updateActiveTask(taskId, { status: 'cancelled', message: '已取消' });
          setTimeout(() => removeActiveTask(taskId), 3000);
        } else {
          const message = err instanceof Error ? err.message : '未知错误';
          updateActiveTask(taskId, {
            status: 'error',
            message,
            error: message,
          });
          toast.error(`生成失败: ${message}`, {
            id: 'freedom-video-error',
            duration: Infinity,
            closeButton: true,
          });
          setTimeout(() => removeActiveTask(taskId), 6000);
        }
      } finally {
        setVideoGenerating(false);
      }
    })();
  }, [
    videoPrompt,
    videoFeatureMode,
    videoI2VSubMode,
    veoCapability,
    singleUpload,
    firstFrameUpload,
    lastFrameUpload,
    referenceUploads,
    multiRefAssets,
    setVideoGenerating,
    setVideoResult,
    videoAspectRatio,
    videoDuration,
    videoResolution,
    selectedVideoModel,
    veoUploadFiles,
    addHistoryEntry,
    addActiveTask,
    updateActiveTask,
    removeActiveTask,
    setSelectedTaskId,
  ]);

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
                type="video"
                value={selectedVideoModel}
                onChange={setSelectedVideoModel}
              />
              {selectedVideoModel && (
                <p className="text-xs text-muted-foreground">ID: {selectedVideoModel}</p>
              )}
            </div>

            {/* ========== 功能模式选择 ========== */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">功能模式</Label>
              <div className="grid grid-cols-1 gap-1.5">
                {availableFeatureModes.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setVideoFeatureMode(opt.value)}
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      videoFeatureMode === opt.value
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {opt.icon}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs">{opt.label}</div>
                      <div className="text-[11px] opacity-70 truncate">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ========== 宽高比（始终显示） ========== */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">宽高比</Label>
              <div className="flex flex-wrap gap-1.5">
                {(aspectRatios.length > 0 ? aspectRatios : ASPECT_RATIO_OPTIONS.map((o) => o.value)).map((ratio) => {
                  const meta = ASPECT_RATIO_OPTIONS.find((o) => o.value === ratio);
                  return (
                    <Button
                      key={ratio}
                      variant={videoAspectRatio === ratio ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      onClick={() => setVideoAspectRatio(ratio)}
                      title={meta?.desc}
                    >
                      {ratio}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* ========== 分辨率（始终显示） ========== */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">分辨率</Label>
              <div className="flex flex-wrap gap-1.5">
                {(resolutions.length > 0 ? resolutions : RESOLUTION_OPTIONS.map((o) => o.value)).map((r) => {
                  const meta = RESOLUTION_OPTIONS.find((o) => o.value === String(r));
                  return (
                    <Button
                      key={r}
                      variant={videoResolution === String(r) ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs px-2.5"
                      onClick={() => setVideoResolution(String(r))}
                      title={meta?.desc}
                    >
                      {String(r)}{meta ? ` ${meta.desc}` : ''}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* ========== 视频时长（滑动条 + 输入框） ========== */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">视频时长 (秒)</Label>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">4s</span>
                <Slider
                  min={4}
                  max={15}
                  step={1}
                  value={[Math.max(4, Math.min(15, videoDuration))]}
                  onValueChange={([v]) => setVideoDuration(v)}
                  className="flex-1"
                />
                <span className="text-[11px] text-muted-foreground shrink-0">15s</span>
                <Input
                  type="number"
                  min={4}
                  max={15}
                  value={videoDuration}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isNaN(v)) setVideoDuration(Math.max(4, Math.min(15, v)));
                  }}
                  className="w-14 h-7 text-xs text-center px-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
              </div>
            </div>

            {/* ========== 图生视频模式：子模式 + 上传 ========== */}
            {videoFeatureMode === 'image-to-video' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">图生视频子模式</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {I2V_SUB_MODE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setVideoI2VSubMode(opt.value)}
                        className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                          videoI2VSubMode === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/40 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        <div className="font-medium">{opt.label}</div>
                        <div className="text-[10px] opacity-70">{opt.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 首帧上传 */}
                <div className={videoI2VSubMode === 'first-last-frame' ? 'grid grid-cols-2 gap-2' : ''}>
                  {renderUploadSlot(
                    '首帧图',
                    firstFrameUpload,
                    () => firstInputRef.current?.click(),
                    () => setFirstFrameUpload(null),
                    true,
                    (file) => void ingestSingleImage(file, setFirstFrameUpload),
                  )}
                  {videoI2VSubMode === 'first-last-frame' && renderUploadSlot(
                    '尾帧图',
                    lastFrameUpload,
                    () => lastInputRef.current?.click(),
                    () => setLastFrameUpload(null),
                    false,
                    (file) => void ingestSingleImage(file, setLastFrameUpload),
                  )}
                </div>
              </div>
            )}

            {/* ========== 多功能参考模式 ========== */}
            {videoFeatureMode === 'multi-reference' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">参考素材（视频/图片/音频）</Label>
                  <div
                    className="grid grid-cols-3 gap-2 rounded-md border border-dashed border-transparent transition-colors p-1 -m-1 hover:border-primary/30"
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes('Files')) {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }
                    }}
                    onDrop={(e) => {
                      const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                      if (files.length === 0) return;
                      e.preventDefault();
                      void ingestMultiRefFiles(files);
                    }}
                  >
                    {multiRefAssets.map((asset, index) => (
                      <div
                        key={asset.id}
                        className="relative rounded border overflow-hidden group/card cursor-context-menu"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          insertRefToPrompt(asset.id);
                        }}
                        title="右键点击插入引用到描述文字"
                      >
                        {asset.assetType === 'image' ? (
                          <img
                            src={asset.dataUrl}
                            alt={`参考 ${index + 1}`}
                            className="h-20 w-full object-cover"
                          />
                        ) : asset.assetType === 'video' ? (
                          <div className="h-20 w-full flex flex-col items-center justify-center bg-muted/50 gap-1">
                            <Film className="h-5 w-5 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground truncate max-w-full px-1">{asset.fileName}</span>
                          </div>
                        ) : (
                          <div className="h-20 w-full flex flex-col items-center justify-center bg-muted/50 gap-1">
                            <Music className="h-5 w-5 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground truncate max-w-full px-1">{asset.fileName}</span>
                            {asset.audioDuration != null && (
                              <span className="text-[9px] text-muted-foreground">{Math.round(asset.audioDuration)}s</span>
                            )}
                          </div>
                        )}
                        {/* 引用标签 */}
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] text-center py-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity pointer-events-none">
                          {getMultiRefTag(asset.id)} · 右键引用
                        </span>
                        <button
                          type="button"
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white"
                          onClick={() => removeMultiRefAsset(asset.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                        {/* 上传进度条（仅视频/音频；done 状态保留 1 秒后由后续清理） */}
                        {(asset.assetType === 'video' || asset.assetType === 'audio') && uploadProgress[asset.id] && (
                          <div className="absolute left-0 right-0 bottom-0 h-1 bg-black/30 overflow-hidden">
                            <div
                              className="h-full bg-green-500 transition-[width] duration-150"
                              style={{
                                width: uploadProgress[asset.id].total > 0
                                  ? `${Math.min(100, (uploadProgress[asset.id].loaded / uploadProgress[asset.id].total) * 100)}%`
                                  : '0%',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                    {multiRefAssets.length < MULTI_REF_MAX_ASSETS && (
                      <button
                        type="button"
                        onClick={() => multiRefInputRef.current?.click()}
                        className="h-20 rounded border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-primary/40"
                      >
                        <Upload className="h-4 w-4" />
                        <span className="text-[11px]">添加</span>
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    已上传 {multiRefAssets.length}/{MULTI_REF_MAX_ASSETS} 个素材 · 音频总时长限制 {MULTI_REF_AUDIO_MAX_SECONDS}s
                    {multiRefAssets.some((a) => a.assetType === 'audio') && (
                      <>（已用 {Math.round(multiRefAssets.filter((a) => a.assetType === 'audio').reduce((s, a) => s + (a.audioDuration ?? 0), 0))}s）</>
                    )}
                  </p>
                </div>
              </div>
            )}

            {/* ========== Veo 动态上传（仅文生视频模式下显示） ========== */}
            {videoFeatureMode === 'text-to-video' && veoCapability.isVeo && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">上传素材（Veo）</Label>
                {veoCapability.mode === 'none' ? (
                  <p className="text-xs text-muted-foreground rounded-md border px-2 py-2">
                    当前模型仅文生视频，不需要上传图片。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {veoCapability.mode === 'single' && renderUploadSlot(
                      '参考图',
                      singleUpload || firstFrameUpload,
                      () => singleInputRef.current?.click(),
                      () => {
                        setSingleUpload(null);
                        setFirstFrameUpload(null);
                      },
                      veoCapability.minFiles > 0,
                      (file) => void ingestSingleImage(file, setSingleUpload),
                    )}

                    {veoCapability.mode === 'first_last' && (
                      <div className="grid grid-cols-2 gap-2">
                        {renderUploadSlot(
                          '首帧图',
                          firstFrameUpload,
                          () => firstInputRef.current?.click(),
                          () => setFirstFrameUpload(null),
                          veoCapability.minFiles > 0,
                          (file) => void ingestSingleImage(file, setFirstFrameUpload),
                        )}
                        {renderUploadSlot(
                          '尾帧图',
                          lastFrameUpload,
                          () => lastInputRef.current?.click(),
                          () => setLastFrameUpload(null),
                          false,
                          (file) => void ingestSingleImage(file, setLastFrameUpload),
                        )}
                      </div>
                    )}

                    {veoCapability.mode === 'multi' && (
                      <div className="space-y-2">
                        <div
                          className="grid grid-cols-3 gap-2 rounded-md border border-dashed border-transparent transition-colors p-1 -m-1 hover:border-primary/30"
                          onDragOver={(e) => {
                            if (e.dataTransfer.types.includes('Files')) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'copy';
                            }
                          }}
                          onDrop={(e) => {
                            const files = e.dataTransfer.files ? Array.from(e.dataTransfer.files) : [];
                            if (files.length === 0) return;
                            e.preventDefault();
                            void ingestReferenceImages(files);
                          }}
                        >
                          {referenceUploads.map((asset, index) => (
                            <div key={asset.id} className="relative rounded border overflow-hidden">
                              <img
                                src={asset.dataUrl}
                                alt={`参考图 ${index + 1}`}
                                className="h-20 w-full object-cover"
                              />
                              <button
                                type="button"
                                className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white"
                                onClick={() => removeReference(asset.id)}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                          {referenceUploads.length < veoCapability.maxFiles && (
                            <button
                              type="button"
                              onClick={() => referenceInputRef.current?.click()}
                              className="h-20 rounded border border-dashed flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground hover:border-primary/40"
                            >
                              <Upload className="h-4 w-4" />
                              <span className="text-[11px]">添加</span>
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          已上传 {referenceUploads.length}/{veoCapability.maxFiles} 张参考图
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Prompt */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">描述文字</Label>
              <PromptTextarea
                ref={promptTextareaRef}
                placeholder="描述你想生成的视频..."
                value={videoPrompt}
                onChange={setVideoPrompt}
                expandTitle="编辑描述文字（视频生成）"
                className="min-h-[120px] resize-none"
              />
            </div>

            <input
              ref={singleInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleSingleUploadChange}
            />
            <input
              ref={firstInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFirstFrameChange}
            />
            <input
              ref={lastInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLastFrameChange}
            />
            <input
              ref={referenceInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleReferenceChange}
            />
            <input
              ref={multiRefInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              className="hidden"
              onChange={handleMultiRefChange}
            />

            {/* Generate Button */}
            <Button
              className="w-full h-11"
              onClick={handleGenerate}
              disabled={!videoPrompt.trim()}
            >
              <Sparkles className="mr-2 h-4 w-4" /> 生成视频
              {videoActiveTasks.filter((t) => t.status === 'running').length > 0 && (
                <span className="ml-1 text-xs opacity-80">
                  ({videoActiveTasks.filter((t) => t.status === 'running').length} 个进行中)
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
            <p className="text-sm font-medium">{viewingTask.message || '视频生成中，请稍候...'}</p>
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
        ) : (viewingTask?.resultUrl || videoResult) ? (
          <div className="max-w-full max-h-full relative group">
            <video
              src={viewingTask?.resultUrl || videoResult || ''}
              controls
              autoPlay
              loop
              className="max-w-full max-h-[calc(100vh-200px)] rounded-lg shadow-lg"
            />
            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <Button size="sm" variant="secondary" asChild>
                <a href={viewingTask?.resultUrl || videoResult || ''} download target="_blank" rel="noopener">
                  <Download className="h-4 w-4 mr-1" /> 下载
                </a>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <VideoIcon className="h-16 w-16 opacity-20" />
            <p className="text-lg font-medium">视频工作室</p>
            <p className="text-sm">选择模型，输入描述，生成你想要的视频</p>
          </div>
        )}
      </div>

      {/* Right: Active tasks + History */}
      <div className="w-[260px] border-l flex flex-col">
        {videoActiveTasks.length > 0 && (
          <div className="border-b">
            <div className="px-3 py-2 border-b">
              <span className="text-sm font-medium">当前任务 ({videoActiveTasks.length})</span>
            </div>
            <div className="p-2 space-y-2 max-h-[40vh] overflow-y-auto">
              {videoActiveTasks.map((t) => (
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
          <GenerationHistory type="video" onSelect={(entry) => {
            setVideoPrompt(entry.prompt);
            setSelectedVideoModel(entry.model);
            setVideoResult(entry.resultUrl);
            setSelectedTaskId(null);
          }} />
        </div>
      </div>
    </div>
  );
}
