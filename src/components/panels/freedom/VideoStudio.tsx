"use client";

import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { VideoIcon, Loader2, Download, Sparkles, Upload, X, Type, ImageIcon, Layers, Film, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { useFreedomStore, type VideoFeatureMode, type ImageToVideoSubMode } from '@/stores/freedom-store';
import { useAPIConfigStore } from '@/stores/api-config-store';
import { ModelSelector } from './ModelSelector';
import { GenerationHistory } from './GenerationHistory';
import { generateFreedomVideo, type FreedomVideoUploadFile, type FreedomVideoUploadRole } from '@/lib/freedom/freedom-api';
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
}

function resolveVideoCapabilityModelId(modelId: string): string {
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
    addHistoryEntry,
  } = useFreedomStore();

  const modelEndpointTypes = useAPIConfigStore((s) => s.modelEndpointTypes);
  const endpointTypes = useMemo(
    () => modelEndpointTypes[selectedVideoModel] || [],
    [modelEndpointTypes, selectedVideoModel],
  );

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

  const [singleUpload, setSingleUpload] = useState<LocalUploadAsset | null>(null);
  const [firstFrameUpload, setFirstFrameUpload] = useState<LocalUploadAsset | null>(null);
  const [lastFrameUpload, setLastFrameUpload] = useState<LocalUploadAsset | null>(null);
  const [referenceUploads, setReferenceUploads] = useState<LocalUploadAsset[]>([]);

  const singleInputRef = useRef<HTMLInputElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const lastInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);

  /** 是否属于 seedance 组 */
  const isSeedance = useMemo(() => isSeedanceGroupModel(selectedVideoModel), [selectedVideoModel]);

  /** 多功能参考模式的资源列表 */
  const [multiRefAssets, setMultiRefAssets] = useState<MultiRefAsset[]>([]);
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

  useEffect(() => {
    setSingleUpload(null);
    setFirstFrameUpload(null);
    setLastFrameUpload(null);
    setReferenceUploads([]);
    setMultiRefAssets([]);
  }, [selectedVideoModel]);

  const toAsset = useCallback(async (file: File): Promise<LocalUploadAsset> => {
    const dataUrl = await fileToDataUrl(file);
    return {
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      dataUrl,
      fileName: file.name,
      mimeType: file.type || 'image/png',
    };
  }, []);

  const handleSingleUploadChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setSingleUpload(await toAsset(file));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [toAsset]);

  const handleFirstFrameChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setFirstFrameUpload(await toAsset(file));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [toAsset]);

  const handleLastFrameChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setLastFrameUpload(await toAsset(file));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [toAsset]);

  const handleReferenceChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (referenceUploads.length >= Math.max(veoCapability.maxFiles, 1)) {
      toast.error(`当前模型最多支持 ${veoCapability.maxFiles} 张参考图`);
      return;
    }
    try {
      const asset = await toAsset(file);
      setReferenceUploads((prev) => [...prev, asset]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [referenceUploads.length, toAsset, veoCapability.maxFiles]);

  const removeReference = useCallback((id: string) => {
    setReferenceUploads((prev) => prev.filter((item) => item.id !== id));
  }, []);

  /** 多功能参考模式：上传文件（视频/图片/音频） */
  const handleMultiRefChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (multiRefAssets.length >= MULTI_REF_MAX_ASSETS) {
      toast.error(`最多支持上传 ${MULTI_REF_MAX_ASSETS} 个参考素材`);
      return;
    }
    try {
      let assetType: MultiRefAssetType = 'image';
      if (file.type.startsWith('video/')) assetType = 'video';
      else if (file.type.startsWith('audio/')) assetType = 'audio';

      // 音频时长校验
      let audioDuration: number | undefined;
      if (assetType === 'audio') {
        audioDuration = await getAudioDuration(file);
        const existingAudioTotal = multiRefAssets
          .filter((a) => a.assetType === 'audio')
          .reduce((sum, a) => sum + (a.audioDuration ?? 0), 0);
        if (existingAudioTotal + audioDuration > MULTI_REF_AUDIO_MAX_SECONDS) {
          toast.error(
            `音频总时长不能超过 ${MULTI_REF_AUDIO_MAX_SECONDS} 秒（当前已 ${Math.round(existingAudioTotal)}s，新增 ${Math.round(audioDuration)}s）`,
          );
          return;
        }
      }

      const dataUrl = await fileToDataUrl(file);
      setMultiRefAssets((prev) => [
        ...prev,
        {
          id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
          dataUrl,
          fileName: file.name,
          mimeType: file.type,
          assetType,
          audioDuration,
        },
      ]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '读取文件失败';
      toast.error(message);
    }
  }, [multiRefAssets]);

  const removeMultiRefAsset = useCallback((id: string) => {
    setMultiRefAssets((prev) => prev.filter((a) => a.id !== id));
  }, []);

  /** 计算某个素材在同类型中的序号标签，如 @image_file_1 */
  const getMultiRefTag = useCallback((assetId: string): string => {
    const asset = multiRefAssets.find((a) => a.id === assetId);
    if (!asset) return '';
    const prefix = asset.assetType === 'video' ? 'video_file' : asset.assetType === 'audio' ? 'audio_file' : 'image_file';
    const sameTypeIndex = multiRefAssets.filter((a) => a.assetType === asset.assetType).findIndex((a) => a.id === assetId) + 1;
    return `@${prefix}_${sameTypeIndex}`;
  }, [multiRefAssets]);

  /** 右键素材卡片 → 在 prompt 末尾插入引用标签 */
  const insertRefToPrompt = useCallback((assetId: string) => {
    const tag = getMultiRefTag(assetId);
    if (!tag) return;
    const prev = videoPrompt;
    const sep = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
    setVideoPrompt(`${prev}${sep}${tag} `);
    toast.success(`已插入 ${tag}`);
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
  ) => (
    <div className="rounded-md border p-2 space-y-2">
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
          <span className="text-xs">上传图片</span>
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

  const handleGenerate = useCallback(async () => {
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

    setVideoGenerating(true);
    setVideoResult(null);

    try {
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
        }));
      }

      const result = await generateFreedomVideo({
        prompt: videoPrompt,
        model: selectedVideoModel,
        aspectRatio: videoAspectRatio,
        duration: videoDuration,
        resolution: videoResolution || undefined,
        uploadFiles,
      });

      setVideoResult(result.url);

      addHistoryEntry({
        id: `vid_${Date.now()}`,
        prompt: videoPrompt,
        model: selectedVideoModel,
        resultUrl: result.url,
        params: {
          aspectRatio: videoAspectRatio,
          duration: videoDuration,
          resolution: videoResolution,
          featureMode: videoFeatureMode,
          uploadCount: uploadFiles?.length ?? 0,
        },
        createdAt: Date.now(),
        mediaId: result.mediaId,
        type: 'video',
      });

      toast.success('视频生成成功！已保存到素材库');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '未知错误';
      toast.error(`生成失败: ${message}`);
    } finally {
      setVideoGenerating(false);
    }
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
                  )}
                  {videoI2VSubMode === 'first-last-frame' && renderUploadSlot(
                    '尾帧图',
                    lastFrameUpload,
                    () => lastInputRef.current?.click(),
                    () => setLastFrameUpload(null),
                    false,
                  )}
                </div>
              </div>
            )}

            {/* ========== 多功能参考模式 ========== */}
            {videoFeatureMode === 'multi-reference' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">参考素材（视频/图片/音频）</Label>
                  <div className="grid grid-cols-3 gap-2">
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
                    )}

                    {veoCapability.mode === 'first_last' && (
                      <div className="grid grid-cols-2 gap-2">
                        {renderUploadSlot(
                          '首帧图',
                          firstFrameUpload,
                          () => firstInputRef.current?.click(),
                          () => setFirstFrameUpload(null),
                          veoCapability.minFiles > 0,
                        )}
                        {renderUploadSlot(
                          '尾帧图',
                          lastFrameUpload,
                          () => lastInputRef.current?.click(),
                          () => setLastFrameUpload(null),
                          false,
                        )}
                      </div>
                    )}

                    {veoCapability.mode === 'multi' && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
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
              <Textarea
                placeholder="描述你想生成的视频..."
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
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
              className="hidden"
              onChange={handleReferenceChange}
            />
            <input
              ref={multiRefInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={handleMultiRefChange}
            />

            {/* Generate Button */}
            <Button
              className="w-full h-11"
              onClick={handleGenerate}
              disabled={videoGenerating || !videoPrompt.trim()}
            >
              {videoGenerating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> 生成中...</>
              ) : (
                <><Sparkles className="mr-2 h-4 w-4" /> 生成视频</>
              )}
            </Button>
          </div>
        </ScrollArea>
      </div>

      {/* Center: Result */}
      <div className="flex-1 flex items-center justify-center p-8 bg-muted/30">
        {videoGenerating ? (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">视频生成中，请稍候（可能需要 1-4 分钟）...</p>
          </div>
        ) : videoResult ? (
          <div className="max-w-full max-h-full relative group">
            <video
              src={videoResult}
              controls
              autoPlay
              loop
              className="max-w-full max-h-[calc(100vh-200px)] rounded-lg shadow-lg"
            />
            <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <Button size="sm" variant="secondary" asChild>
                <a href={videoResult} download target="_blank" rel="noopener">
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

      {/* Right: History */}
      <div className="w-[240px] border-l">
        <GenerationHistory type="video" onSelect={(entry) => {
          setVideoPrompt(entry.prompt);
          setSelectedVideoModel(entry.model);
          setVideoResult(entry.resultUrl);
        }} />
      </div>
    </div>
  );
}
