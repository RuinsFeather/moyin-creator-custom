// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// BoxConfigDrawer — 选中窗口下方的悬浮功能配置抽屉 (§2.4 / §4.3 / P2).
//
// 横向三段式布局：①顶部参考区 → ②中部文本区 → ③底部模型控制区。
// 图片/视频两态（kind）。
//
// 定位（§4.3）：挂在画布 overlay 层（BlueprintView 的 relative 容器内）
// 而非节点内部；使用绝对定位锚定选中节点底部中心，viewport/resize/drag
// 实时跟随，并进行边界修正。

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronsUpDown,
  Film,
  Image as ImageIcon,
  Plus,
  Sparkles,
  SlidersHorizontal,
  Video,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBlueprintStore } from '@/stores/blueprint-store';
import type {
  BlueprintNode,
  BlueprintMediaRef,
  ImageBoxConfig,
  VideoBoxConfig,
  BlueprintVideoGeneratorConfig,
} from '@/types/blueprint';
import { cn, generateUUID } from '@/lib/utils';
import { useAssetUpload, readFileAsDataUrl } from '@/hooks/use-asset-upload';
import { VolcAssetPanel, type VolcAssetItem } from '@/components/panels/freedom/VolcAssetPanel';
import { ReferenceList } from '@/components/panels/freedom/shared/ReferenceList';
import { PromptTextarea, type PromptTextareaRef } from '@/components/panels/freedom/PromptTextarea';
import { ModelSelector } from '@/components/panels/freedom/ModelSelector';
import { GenParamControls } from '@/components/panels/freedom/shared/GenParamControls';
import { executeBlueprintRun, retryNodeExecution } from '@/lib/blueprint/execution-bridge';
import { resolveVeoUploadCapability } from '@/lib/freedom/veo-capability';
import {
  resolveSeedanceCapability,
  validateSeedanceReferenceCounts,
} from '@/lib/video/seedance-capability';
import type { FreedomVideoUploadRole } from '@/lib/freedom/freedom-api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  buildDrawerReferences,
  reorderManualRefs,
  removeManualRef,
  getMultiRefTagForItem,
  DRAWER_MAX_REFERENCE_IMAGES,
} from './drawer/drawer-references';
import {
  getAspectRatiosForT2IModel,
  getAspectRatiosForT2VModel,
  getResolutionsForModel,
  getT2IModelById,
} from '@/lib/freedom/model-registry';
import {
  readModelDraft,
  writeModelDraft,
  makePaidTaskConfirm,
  type DrawerModelDraft,
} from './drawer/drawer-model';

/** Midjourney 默认参数（对齐 ImageStudio）。 */
const DEFAULT_MIDJOURNEY_SPEED = 'relaxed';
const DEFAULT_MIDJOURNEY_STYLIZATION = 100;
const MIDJOURNEY_BOT_TYPES = [
  { value: 'MID_JOURNEY', label: 'Midjourney' },
  { value: 'NIJI_JOURNEY', label: 'Niji Journey' },
];

/** 视频能力模型 id 归一（版本化 → 家族基础 id，对齐 VideoStudio 实现）。 */
function resolveVideoCapabilityModelId(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (/^kling-v/i.test(modelId) || modelId === 'kling-video-o1') {
    return 'kling-video';
  }
  if (/^veo_3_1/i.test(modelId)) return 'veo_3_1';
  if (lower.startsWith('veo3.1')) return 'veo3.1';
  if (/^veo3/i.test(modelId)) return 'veo3';
  if (/^veo2/i.test(modelId)) return 'veo2';
  if (/^vidu/i.test(modelId) || modelId === 'aigc-video-vidu') return 'vidu2.0';
  if (/^doubao-seedance-/i.test(modelId)) {
    if (modelId.includes('2-5')) return 'seedance-2.5';
    if (modelId.includes('pro-fast')) return 'seedance-pro-t2v-fast';
    if (modelId.includes('lite')) return 'seedance-lite-t2v';
    return 'seedance-pro-t2v';
  }
  if (lower.startsWith('minimax/video-01')) return 'minimax-hailuo-02-standard-t2v';
  return modelId;
}

/** Drawer vertical gap below the selected window (px). */
const DRAWER_GAP = 10;
/** Drawer width (px). The wide layout keeps the main controls side by side. */
export const DRAWER_WIDTH = 920;
/** Hard max height; content scrolls internally. */
const DRAWER_MAX_HEIGHT = 440;
/** Estimated drawer height used for vertical flip/clamp calculations (px). */
const DRAWER_ESTIMATED_HEIGHT = DRAWER_MAX_HEIGHT;
/** Padding kept from canvas edges when clamping (px). */
const EDGE_PADDING = 8;

type DrawerGenerationMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'text-to-video'
  | 'image-to-video'
  | 'multi-reference';

const IMAGE_GENERATION_MODES: Array<{
  value: 'text-to-image' | 'image-to-image';
  label: string;
  icon: typeof Sparkles;
}> = [
  { value: 'text-to-image', label: '文生图', icon: Sparkles },
  { value: 'image-to-image', label: '图生图', icon: ImageIcon },
];

const VIDEO_GENERATION_MODES: Array<{
  value: 'text-to-video' | 'image-to-video' | 'multi-reference';
  label: string;
  icon: typeof Sparkles;
}> = [
  { value: 'text-to-video', label: '文生视频', icon: Sparkles },
  { value: 'image-to-video', label: '图生视频', icon: Film },
  { value: 'multi-reference', label: '多参考', icon: Video },
];

export interface BoxConfigDrawerProps {
  /** The selected node (already resolved by the parent). */
  node: BlueprintNode;
  /** Called when the user requests closing (X button / Escape). */
  onClose: () => void;
}

interface AnchorPosition {
  left: number;
  top: number;
  placement: 'below' | 'above';
}

/**
 * Compute the drawer anchor (top-left of the panel) from the selected node's
 * DOM rect relative to the overlay container, with boundary clamping.
 *
 * Horizontal: the returned `left` is already the drawer's final left edge
 * (node center minus half width, clamped into the container).
 *
 * Vertical (§4.3 boundary correction): prefer below the node; when the
 * remaining space below can't fit the drawer, flip above the node; when
 * neither side fits, clamp so the drawer stays inside the container.
 */
function computeAnchor(
  container: HTMLElement,
  nodeEl: HTMLElement,
  drawerWidth: number,
  drawerHeight: number,
): AnchorPosition | null {
  const containerRect = container.getBoundingClientRect();
  const nodeRect = nodeEl.getBoundingClientRect();
  if (nodeRect.width === 0 && nodeRect.height === 0) return null;

  // Bottom-center of the selected window, relative to the overlay container.
  const centerX = nodeRect.left + nodeRect.width / 2 - containerRect.left;

  // Clamp horizontally so the drawer stays inside the canvas container.
  const half = drawerWidth / 2;
  const left = Math.min(
    Math.max(centerX - half, 8),
    Math.max(containerRect.width - drawerWidth - 8, 8),
  );

  const spaceBelow = containerRect.bottom - nodeRect.bottom;
  const spaceAbove = nodeRect.top - containerRect.top;
  if (spaceBelow >= drawerHeight + DRAWER_GAP) {
    return { left, top: nodeRect.bottom - containerRect.top + DRAWER_GAP, placement: 'below' };
  }
  if (spaceAbove >= drawerHeight + DRAWER_GAP) {
    // Flip above the node; clamp so the drawer never leaves the container top.
    return {
      left,
      top: Math.max(nodeRect.top - containerRect.top - drawerHeight - DRAWER_GAP, 8),
      placement: 'above',
    };
  }
  // Neither side fits fully: keep below but clamp into the container
  // (the drawer body scrolls internally via maxHeight).
  return {
    left,
    top: Math.min(
      nodeRect.bottom - containerRect.top + DRAWER_GAP,
      Math.max(containerRect.height - drawerHeight - 8, 8),
    ),
    placement: 'below',
  };
}

/**
 * 悬浮功能配置抽屉。父组件（BlueprintView）在 selectedNodeId 指向
 * image-box / video-box 时渲染本组件；node 类型由父组件保证。
 */
export function BoxConfigDrawer({ node, onClose }: BoxConfigDrawerProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const [anchor, setAnchor] = useState<AnchorPosition | null>(null);

  const nodes = useBlueprintStore((s) =>
    s.blueprints.find((b) => b.id === s.activeBlueprintId)?.nodes ?? [],
  );
  const viewport = useBlueprintStore((s) =>
    s.blueprints.find((b) => b.id === s.activeBlueprintId)?.viewport,
  );
  const edgeCount = useBlueprintStore(
    (s) =>
      (s.blueprints.find((b) => b.id === s.activeBlueprintId)?.edges ?? []).filter(
        (e) => e.target === node.id,
      ).length,
  );

  const kind: 'image' | 'video' = node.data.nodeType === 'video-box' ? 'video' : 'image';

  const updateNode = useBlueprintStore((s) => s.updateNode);
  const edges = useBlueprintStore(
    (s) => s.blueprints.find((b) => b.id === s.activeBlueprintId)?.edges ?? [],
  );
  const { uploadFiles, uploading } = useAssetUpload();
  const [assetDialogOpen, setAssetDialogOpen] = useState(false);

  // ── 参考列表 (P2-4) ─────────────────────────────────────────────
  const referenceModel = useMemo(
    () => buildDrawerReferences(node, nodes, edges),
    [node, nodes, edges],
  );

  const patchConfig = useCallback(
    (patch: Partial<ImageBoxConfig | VideoBoxConfig>) => {
      updateNode(node.id, {
        config: {
          ...node.data.config,
          ...patch,
        } as ImageBoxConfig | VideoBoxConfig,
      });
    },
    [node.id, node.data.config, updateNode],
  );

  const handleRemoveReference = useCallback(
    (key: string) => {
      const patch = removeManualRef(node, key);
      if (patch) updateNode(node.id, patch as { config: ImageBoxConfig });
    },
    [node, updateNode],
  );

  const handleReorderReferences = useCallback(
    (keys: string[]) => {
      const patch = reorderManualRefs(node, keys);
      if (patch) updateNode(node.id, patch as { config: ImageBoxConfig });
    },
    [node, updateNode],
  );

  // 添加本地文件参考（图片版 ≤10，视频版按模型能力校验）
  const handleAddFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      /**
       * 把文件持久化到媒体目录，返回 local-image://blueprint-refs/xxx 路径。
       * 重启后路径仍有效；主进程 protocol.handle('local-image', ...) 负责
       * 将 local-image://category/filename → getMediaRoot()/category/filename 服务。
       *
       * 降级顺序：
       *   1. window.imageStorage.saveImage（Electron 环境，落盘 → 稳定 local-image://）
       *   2. readFileAsDataUrl（非 Electron / saveImage 失败，session 内可预览）
       */
      const toSafeUrl = async (f: File): Promise<string> => {
        if (window.imageStorage) {
          try {
            const dataUrl = await readFileAsDataUrl(f);
            const result = await window.imageStorage.saveImage(dataUrl, 'blueprint-refs', f.name);
            if (result.success && result.localPath) {
              return result.localPath; // local-image://blueprint-refs/timestamp_xxx.png
            }
          } catch {
            // fall through to dataURL
          }
        }
        return readFileAsDataUrl(f);
      };

      if (kind === 'image') {
        const current =
          (node.data.config as ImageBoxConfig).referenceImageRefs?.length ?? 0;
        if (current + files.length > DRAWER_MAX_REFERENCE_IMAGES) {
          toast.warning(`参考图片上限为 ${DRAWER_MAX_REFERENCE_IMAGES} 张`);
          return;
        }
        const newRefs: BlueprintMediaRef[] = await Promise.all(
          files.map(async (f) => ({
            url: await toSafeUrl(f),
            localPath: f.name,
            mimeType: f.type,
            dedupeKey: generateUUID(),
          })),
        );
        patchConfig({
          referenceImageRefs: [
            ...((node.data.config as ImageBoxConfig).referenceImageRefs ?? []),
            ...newRefs,
          ],
        } as Partial<ImageBoxConfig>);
      } else {
        const cfg = node.data.config as VideoBoxConfig;
        const gen: BlueprintVideoGeneratorConfig =
          cfg.generation ?? ({} as BlueprintVideoGeneratorConfig);
        const newRefs = await Promise.all(
          files.map(async (f) => ({
            url: await toSafeUrl(f),
            localPath: f.name,
            mimeType: f.type,
            role: 'reference' as const,
            assetType: f.type.startsWith('video/')
              ? ('video' as const)
              : f.type.startsWith('audio/')
                ? ('audio' as const)
                : ('image' as const),
            dedupeKey: generateUUID(),
          })),
        );
        patchConfig({
          generation: {
            ...gen,
            referenceMediaRefs: [...(gen.referenceMediaRefs ?? []), ...newRefs],
          },
        } as Partial<VideoBoxConfig>);
      }
    },
    [kind, node.data.config, patchConfig],
  );

  const handleFileInput = useCallback(
    (accept: string, multiple: boolean) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.multiple = multiple;
      input.onchange = (e) => {
        const files = Array.from((e.target as HTMLInputElement).files ?? []);
        void handleAddFiles(files);
      };
      input.click();
    },
    [handleAddFiles],
  );

  const handleSelectAsset = useCallback(
    (asset: VolcAssetItem) => {
      const mimeType = asset.name.match(/\.(mp4|mov|webm|avi)$/i)
        ? 'video/mp4'
        : asset.name.match(/\.(mp3|wav|m4a|aac)$/i)
          ? 'audio/mpeg'
          : 'image/png';
      if (kind === 'image') {
        const cfg = node.data.config as ImageBoxConfig;
        const current = cfg.referenceImageRefs?.length ?? 0;
        if (current >= DRAWER_MAX_REFERENCE_IMAGES) {
          toast.warning(`参考图片上限为 ${DRAWER_MAX_REFERENCE_IMAGES} 张`);
          return;
        }
        patchConfig({
          referenceImageRefs: [
            ...(cfg.referenceImageRefs ?? []),
            {
              url: asset.url,
              localPath: asset.name,
              assetId: asset.assetId,
              volcAssetUri: asset.assetUri,
              mediaId: asset.assetId,
              mimeType,
              dedupeKey: generateUUID(),
            },
          ],
        } as Partial<ImageBoxConfig>);
      } else {
        const cfg = node.data.config as VideoBoxConfig;
        const gen: BlueprintVideoGeneratorConfig =
          cfg.generation ?? ({} as BlueprintVideoGeneratorConfig);
        patchConfig({
          generation: {
            ...gen,
            referenceMediaRefs: [
              ...(gen.referenceMediaRefs ?? []),
              {
                url: asset.url,
                localPath: asset.name,
                assetId: asset.assetId,
                volcAssetUri: asset.assetUri,
                role: 'reference' as const,
                assetType: mimeType.startsWith('video/')
                  ? ('video' as const)
                  : mimeType.startsWith('audio/')
                    ? ('audio' as const)
                    : ('image' as const),
                dedupeKey: generateUUID(),
              },
            ],
          },
        } as Partial<VideoBoxConfig>);
      }
      setAssetDialogOpen(false);
    },
    [kind, node.data.config, patchConfig],
  );

  // ── 文本区 (P2-5) ────────────────────────────────────────────────
  const promptRef = useRef<PromptTextareaRef | null>(null);

  /** 上游文本框来源（targetHandle='prompt'，order 升序 → edgeId 字典序）。 */
  const upstreamTextSources = useMemo(() => {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    return edges
      .filter((e) => e.target === node.id && e.targetHandle === 'prompt')
      .sort(
        (a, b) =>
          (a.data?.order ?? 0) - (b.data?.order ?? 0) || a.id.localeCompare(b.id),
      )
      .map((e) => {
        const source = nodeMap.get(e.source);
        const text =
          source?.data.nodeType === 'text-box'
            ? String((source.data.config as { text?: string } | undefined)?.text ?? '')
            : '';
        return { edgeId: e.id, label: source?.data.label ?? '上游', text };
      })
      .filter((s) => s.text.trim().length > 0);
  }, [nodes, edges, node.id]);

  const upstreamPromptPreview = useMemo(
    () => upstreamTextSources.map((s) => s.text.trim()).join('\n\n'),
    [upstreamTextSources],
  );

  const generationConfig = useMemo(() => {
    const cfg = node.data.config as ImageBoxConfig | VideoBoxConfig;
    return cfg.generation ?? null;
  }, [node.data.config]);

  const hasUpstreamText = upstreamTextSources.length > 0;
  const hasCustomPrompt =
    typeof generationConfig?.prompt === 'string' &&
    generationConfig.prompt.length > 0;
  /** 覆盖开关：有上游文本时默认关（用上游），用户显式打开后写 generation.prompt。 */
  const [overrideUpstream, setOverrideUpstream] = useState(!hasUpstreamText && hasCustomPrompt);
  useEffect(() => {
    // 连线变化时重置：无上游时始终可编辑（直接输入），有上游时恢复默认。
    setOverrideUpstream((prev) => (!hasUpstreamText ? true : prev && hasCustomPrompt));
  }, [hasUpstreamText, hasCustomPrompt]);

  const promptValue = hasUpstreamText && !overrideUpstream ? '' : (generationConfig?.prompt ?? '');

  const handlePromptChange = useCallback(
    (value: string) => {
      // 写入 generation.prompt（图片/视频共用同名字段）。
      const cfg = node.data.config as ImageBoxConfig | VideoBoxConfig;
      const gen = (cfg.generation ?? {}) as { prompt?: string } & Record<string, unknown>;
      updateNode(node.id, {
        config: { ...cfg, generation: { ...gen, prompt: value } },
      });
    },
    [node.id, node.data.config, updateNode],
  );

  // ── 视频右键插入引用标签 (P2-6) ──────────────────────────────────
  const handleReferenceContextMenu = useCallback(
    (key: string) => {
      if (kind !== 'video') return;
      const item = referenceModel.items.find((i) => i.key === key);
      if (!item) return;
      const tag = getMultiRefTagForItem(key, referenceModel.items);
      if (!tag) return;
      promptRef.current?.insertAtCursor(tag);
      toast.success(`已在光标位置插入 ${tag}`);
    },
    [kind, referenceModel.items],
  );

  // ── 模型控制区 (P2-7) ────────────────────────────────────────────
  const [modelDraft, setModelDraft] = useState<DrawerModelDraft>(() =>
    readModelDraft(node.data.config as ImageBoxConfig | VideoBoxConfig),
  );

  // 蓝图配置目前没有统一的 generationMode 字段，因此这里仅维护抽屉内
  // 的视觉选择，不改变执行器语义；实际参考内容仍以缩略图列表为准。
  const generationModes = kind === 'image' ? IMAGE_GENERATION_MODES : VIDEO_GENERATION_MODES;
  const defaultGenerationMode: DrawerGenerationMode =
    kind === 'image'
      ? referenceModel.items.length > 0
        ? 'image-to-image'
        : 'text-to-image'
      : referenceModel.items.some((item) => item.mediaType === 'video' || item.mediaType === 'audio')
        ? 'multi-reference'
        : referenceModel.items.length > 0
          ? 'image-to-video'
          : 'text-to-video';
  const [generationMode, setGenerationMode] = useState<DrawerGenerationMode>(defaultGenerationMode);

  // 切换节点时重置草稿（父组件 key 保持挂载，需手动同步）。
  useEffect(() => {
    setModelDraft(readModelDraft(node.data.config as ImageBoxConfig | VideoBoxConfig));
    setGenerationMode(defaultGenerationMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const patchDraft = useCallback((patch: Partial<DrawerModelDraft>) => {
    setModelDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  /** 持久化草稿到 config.generation（保留 prompt / refs）。 */
  const persistDraft = useCallback(() => {
    const cfg = node.data.config as ImageBoxConfig | VideoBoxConfig;
    updateNode(node.id, { config: writeModelDraft(cfg, modelDraft) });
  }, [node.id, node.data.config, modelDraft, updateNode]);

  const isRunning = node.data.execution?.status === 'running';
  const isFailed = node.data.execution?.status === 'failed';

  const handleRetry = useCallback(() => {
    void retryNodeExecution(node.id, { confirmPaidTask: makePaidTaskConfirm() });
  }, [node.id]);

  // 视频版：能力模型 id（版本化 → 家族基础 id，对齐 VideoStudio）。
  const capabilityModelId = useMemo(
    () => (kind === 'video' ? resolveVideoCapabilityModelId(modelDraft.model) : undefined),
    [kind, modelDraft.model],
  );
  const isSeedanceModel = useMemo(
    () => kind === 'video' && modelDraft.model.toLowerCase().includes('seedance'),
    [kind, modelDraft.model],
  );

  // ── 视频角色指派 + 实时校验 (P2-9) ──────────────────────────────
  const veoCapability = useMemo(
    () =>
      kind === 'video' && modelDraft.model
        ? resolveVeoUploadCapability(modelDraft.model, undefined)
        : null,
    [kind, modelDraft.model],
  );
  const seedanceCapability = useMemo(
    () =>
      kind === 'video' && modelDraft.model
        ? resolveSeedanceCapability(modelDraft.model)
        : null,
    [kind, modelDraft.model],
  );
  const isHappyHorse = useMemo(
    () => kind === 'video' && modelDraft.model.toLowerCase().includes('happyhorse'),
    [kind, modelDraft.model],
  );

  /** Seedance 参考数校验（提交前提示；详细校验在 P3 执行器内）。 */
  const validateSeedanceRefs = useCallback((): boolean => {
    if (!seedanceCapability || !isSeedanceModel) return true;
    const cfg = node.data.config as VideoBoxConfig;
    const refs = cfg.generation?.referenceMediaRefs ?? [];
    const images = refs.filter((r) => (r.assetType ?? 'image') === 'image').length;
    const videos = refs.filter((r) => r.assetType === 'video').length;
    const audios = refs.filter((r) => r.assetType === 'audio').length;
    const error = validateSeedanceReferenceCounts(modelDraft.model, { images, videos, audios });
    if (error) {
      toast.warning(error);
      return false;
    }
    return true;
  }, [seedanceCapability, isSeedanceModel, node.data.config, modelDraft.model]);

  const handleGenerate = useCallback(async () => {
    if (!modelDraft.model) {
      toast.error('请先选择模型');
      return;
    }
    if (isRunning) return;
    if (kind === 'video' && !validateSeedanceRefs()) return;
    // 首次点击「生成」即把所选模型与参数落 config.generation（窗口转为生成型）。
    persistDraft();
    await executeBlueprintRun('node', node.id, {
      confirmPaidTask: makePaidTaskConfirm(),
    });
  }, [modelDraft.model, isRunning, kind, validateSeedanceRefs, persistDraft, node.id]);

  const handleSaveOnly = useCallback(() => {
    persistDraft();
    toast.success('配置已保存');
    onClose();
  }, [persistDraft, onClose]);

  /** 关闭前自动持久化草稿（模型/参数选择不丢失）。 */
  const handleClose = useCallback(() => {
    persistDraft();
    onClose();
  }, [persistDraft, onClose]);

  // 图片版：Midjourney / Ideogram 特有参数（折叠）。
  const hasMidjourneyParams = /midjourney|^mj_|^niji-/i.test(modelDraft.model);
  const hasIdeogramParams = modelDraft.model.includes('ideogram');
  const selectedMidjourneyBotType = String(
    (modelDraft.extraParams?.botType as string) ||
      (/^niji-/i.test(modelDraft.model) ? 'NIJI_JOURNEY' : 'MID_JOURNEY'),
  );
  const updateExtraParam = useCallback(
    (key: string, value: unknown) => {
      patchDraft({
        extraParams: { ...(modelDraft.extraParams ?? {}), [key]: value },
      });
    },
    [modelDraft.extraParams, patchDraft],
  );

  /** 角色循环：首帧 → 尾帧 → 参考 → 首帧（仅视频手动参考；校验按模型能力）。 */
  const handleRoleClick = useCallback(
    (key: string) => {
      if (kind !== 'video') return;
      const cfg = node.data.config as VideoBoxConfig;
      const gen = (cfg.generation ?? {}) as BlueprintVideoGeneratorConfig;
      const refs = gen.referenceMediaRefs ?? [];
      const idx = refs.findIndex(
        (ref, i) => `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? i}` === key,
      );
      if (idx < 0) return;
      const current = refs[idx].role;
      const nextRole: FreedomVideoUploadRole =
        current === 'first' ? 'last' : current === 'last' ? 'reference' : 'first';
      const next = refs.map((ref, i) => (i === idx ? { ...ref, role: nextRole } : ref));

      // 实时校验：Veo first_last 模式只允许一个首帧/尾帧；HappyHorse 仅图片。
      if (veoCapability?.mode === 'first_last') {
        if (
          (nextRole === 'first' || nextRole === 'last') &&
          next.filter((r) => r.role === nextRole).length > 1
        ) {
          toast.warning(
            nextRole === 'first' ? '该模型仅支持一张首帧图' : '该模型仅支持一张尾帧图',
          );
          return;
        }
      }
      if (isHappyHorse && refs[idx].assetType && refs[idx].assetType !== 'image') {
        toast.warning('该模型仅支持图片参考');
        return;
      }

      updateNode(node.id, {
        config: { ...cfg, generation: { ...gen, referenceMediaRefs: next } },
      });
    },
    [kind, node.id, node.data.config, veoCapability, isHappyHorse, updateNode],
  );

  // ── Positioning (P2-3) ──────────────────────────────────────────────
  const updateAnchor = useCallback(() => {
    const container = containerRef.current;
    const nodeEl = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${node.id}"]`,
    );
    if (!container || !nodeEl) return;
    const next = computeAnchor(container, nodeEl, DRAWER_WIDTH, DRAWER_ESTIMATED_HEIGHT);
    if (next) setAnchor(next);
  }, [node.id]);

  // Mount: capture container + first measurement (before paint to avoid flash).
  useLayoutEffect(() => {
    containerRef.current = (
      document.querySelector('.react-flow') as HTMLElement | null
    )?.parentElement ?? null;
    updateAnchor();
    let frame = requestAnimationFrame(updateAnchor);
    let retry = 0;
    const retryMeasure = () => {
      updateAnchor();
      retry += 1;
      if (retry < 8) frame = requestAnimationFrame(retryMeasure);
    };
    frame = requestAnimationFrame(retryMeasure);
    const observer = typeof MutationObserver !== 'undefined'
      ? new MutationObserver(updateAnchor)
      : null;
    const flow = document.querySelector('.react-flow');
    if (flow && observer) observer.observe(flow, { childList: true, subtree: true, attributes: true });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [updateAnchor]);

  // Follow viewport pan/zoom (store-driven) and node drag (node position change).
  useEffect(() => {
    updateAnchor();
  }, [updateAnchor, viewport, nodes]);

  // Follow window resize.
  useEffect(() => {
    const handler = () => updateAnchor();
    window.addEventListener('resize', handler);
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(handler)
      : null;
    if (containerRef.current && observer) observer.observe(containerRef.current);
    return () => {
      window.removeEventListener('resize', handler);
      observer?.disconnect();
    };
  }, [updateAnchor]);

  // Escape closes (pane click is handled by the canvas, which clears selection).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't hijack Escape from inputs with open popovers; still close drawer.
      handleClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleClose]);

  // 完成自动关闭 (P2-10)：从 running → completed 的那次运行结束时收起抽屉。
  const prevRunningRef = useRef(false);
  useEffect(() => {
    const status = node.data.execution?.status;
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = status === 'running';
    if (wasRunning && status === 'completed') {
      toast.success(`${node.data.label || '窗口'} 生成完成`);
      handleClose();
    }
  }, [node.data.execution?.status, node.data.label, handleClose]);

  const style = useMemo<React.CSSProperties>(
    () => ({
      position: 'absolute',
      left: anchor?.left ?? -9999,
      top: anchor?.top ?? -9999,
      width: DRAWER_WIDTH,
      maxWidth: `calc(100% - ${EDGE_PADDING * 2}px)`,
      maxHeight: DRAWER_MAX_HEIGHT,
      // `left` is already the final left edge centered on the node.
      // Keep hidden until first measurement to avoid a flash at (0,0).
      visibility: anchor ? 'visible' : 'hidden',
    }),
    [anchor],
  );

  return (
    <div
      style={style}
      className={cn(
        'nodrag nowheel z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-panel/95 shadow-xl backdrop-blur',
      )}
      role="dialog"
      aria-label={`${kind === 'video' ? '视频' : '图片'}窗口配置`}
      data-testid="box-config-drawer"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* 顶部标题 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {kind === 'video' ? <Video className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-foreground">
              {node.data.label || (kind === 'video' ? '视频窗口' : '图片窗口')}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {kind === 'video' ? '视频' : '图片'} · {edgeCount} 个上游
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={handleClose}
            title="关闭"
            aria-label="关闭配置"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 运行状态条 (P2-10)：仅失败重试（运行中的进度/取消已移至窗口正中央覆盖层） */}
        {isFailed && (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-1.5"
            data-testid="drawer-run-status"
          >
            <>
              <span
                className="min-w-0 flex-1 truncate text-[10px] text-destructive"
                title={node.data.execution?.error}
              >
                {node.data.execution?.error || '生成失败'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 shrink-0 px-2 text-[10px]"
                onClick={handleRetry}
                data-testid="drawer-retry"
              >
                重试
              </Button>
            </>
          </div>
        )}

        <div
          className="nowheel flex min-h-0 flex-col"
          data-testid="drawer-horizontal-layout"
        >
          {/* ① 顶部参考缩略图横向条 */}
          <section
            className="shrink-0 border-b border-border px-3 py-2"
            data-drawer-section="references"
            data-testid="drawer-reference-strip"
          >
            <div className="flex items-center gap-2">
              {referenceModel.items.length > 0 ? (
                <ReferenceList
                  items={referenceModel.items}
                  onRemove={handleRemoveReference}
                  onReorder={handleReorderReferences}
                  onItemContextMenu={handleReferenceContextMenu}
                  onRoleClick={handleRoleClick}
                  thumbSize={48}
                  className="flex-1"
                />
              ) : (
                <div className="flex h-[48px] flex-1 items-center gap-1.5 rounded-md border border-dashed border-border/60 px-3 text-[10px] text-muted-foreground/50">
                  暂无参考，可从上游连线或点击右侧添加
                </div>
              )}
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="nodrag flex h-[48px] w-[48px] items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                  onClick={() =>
                    handleFileInput(
                      kind === 'image' ? 'image/*' : 'image/*,video/*,audio/*',
                      true,
                    )
                  }
                  title="添加本地文件参考"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="nodrag flex h-[48px] w-[48px] items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground/60 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                  onClick={() => setAssetDialogOpen(true)}
                  title="从素材库选参考"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>

          {/* ② 中间提示词输入区 */}
          <section
            className="min-h-0 flex-1"
            data-drawer-section="text"
            data-testid="drawer-prompt-section"
          >
            {hasUpstreamText && (
              <div className="flex items-center gap-2 border-b border-border/50 bg-muted/20 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
                  使用上游文本（{upstreamTextSources.length} 个来源，按连线 order 合并）
                </span>
                <label className="nodrag flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-3 w-3 accent-primary"
                    checked={overrideUpstream}
                    onChange={(e) => setOverrideUpstream(e.target.checked)}
                  />
                  自定义覆盖
                </label>
              </div>
            )}
            {hasUpstreamText && !overrideUpstream ? (
              <details className="mx-3 mt-2 rounded border border-border bg-muted/30">
                <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground">
                  预览合并结果
                </summary>
                <p className="max-h-24 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11px] leading-relaxed text-foreground/80">
                  {upstreamPromptPreview || '（上游文本为空）'}
                </p>
              </details>
            ) : (
              <PromptTextarea
                ref={promptRef}
                value={promptValue}
                onChange={handlePromptChange}
                placeholder="在这里输入提示词....."
                className="h-full min-h-[120px] w-full resize-none rounded-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus-visible:ring-0"
              />
            )}
          </section>
        </div>

        {/* 底部操作行：左侧弹出控件 + 右侧操作按钮 */}
        <div
          className="flex shrink-0 items-center gap-2 border-t border-border bg-background/60 px-3 py-2"
          data-testid="drawer-generate-actions"
        >
          {/* 生成模式弹窗 */}
          <div data-testid="drawer-generation-mode">
          <Popover>
            <PopoverTrigger asChild>
              {(() => {
                const currentMode = generationModes.find((m) => m.value === generationMode) ?? generationModes[0];
                const CurrentModeIcon = currentMode.icon;
                return (
                  <button
                    type="button"
                    data-testid="drawer-generation-mode-trigger"
                    className="nodrag inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted"
                  >
                    <CurrentModeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span>{currentMode.label}</span>
                    <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </button>
                );
              })()}
            </PopoverTrigger>
            <PopoverContent forceMount side="top" align="start" className="w-48 p-1.5">
              <div
                className={cn('grid gap-1', kind === 'video' ? 'grid-cols-3' : 'grid-cols-2')}
              >
                {generationModes.map((mode) => {
                  const ModeIcon = mode.icon;
                  return (
                    <button
                      key={mode.value}
                      type="button"
                      className={cn(
                        'nodrag flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-[10px] transition-colors',
                        generationMode === mode.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                      aria-pressed={generationMode === mode.value}
                      aria-label={mode.label}
                      onClick={() => setGenerationMode(mode.value)}
                    >
                      <ModeIcon className="h-3.5 w-3.5" />
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
          </div>

          {/* 生成参数弹窗 */}
          <div data-testid="drawer-parameter-section" data-drawer-section="model">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="nodrag inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs text-foreground transition-colors hover:bg-muted"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="max-w-[80px] truncate">
                  {modelDraft.model ? modelDraft.model.split('-').slice(0, 2).join('-') : '参数'}
                </span>
                <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" align="start" className="w-72 p-3">
              <section
                className="space-y-2.5"
                data-drawer-section="model"
                data-testid="drawer-parameter-section"
              >
                <ModelSelector
                  type={kind}
                  value={modelDraft.model}
                  onChange={(modelId) => {
                    // 切换模型时重置宽高比和分辨率到新模型支持的默认值
                    const newCapId =
                      kind === 'video' ? resolveVideoCapabilityModelId(modelId) : modelId;
                    const newAspectRatios =
                      kind === 'image'
                        ? getAspectRatiosForT2IModel(newCapId)
                        : getAspectRatiosForT2VModel(newCapId);
                    const newResolutions =
                      kind === 'image'
                        ? ((getT2IModelById(newCapId)?.inputs?.resolution?.enum as string[]) ?? [])
                        : getResolutionsForModel(newCapId);
                    patchDraft({
                      model: modelId,
                      aspectRatio: newAspectRatios.length > 0 ? newAspectRatios[0] : '',
                      resolution: newResolutions.length > 0 ? newResolutions[0] : '',
                    });
                  }}
                />

                {modelDraft.model && (
                  <GenParamControls
                    compact
                    kind={kind}
                    model={modelDraft.model}
                    capabilityModelId={capabilityModelId}
                    aspectRatio={modelDraft.aspectRatio ?? ''}
                    onAspectRatioChange={(v) => patchDraft({ aspectRatio: v })}
                    resolution={modelDraft.resolution ?? ''}
                    onResolutionChange={(v) => patchDraft({ resolution: v })}
                    groupClassName="space-y-2"
                    {...(kind === 'video'
                      ? {
                          duration: modelDraft.duration ?? 5,
                          onDurationChange: (v: number) => patchDraft({ duration: v }),
                        }
                      : {})}
                  />
                )}

                {/* Midjourney 特有参数（折叠） */}
                {kind === 'image' && hasMidjourneyParams && (
                  <details className="rounded border border-border bg-muted/30">
                    <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground">
                      Midjourney 参数
                    </summary>
                    <div className="space-y-2 px-2 pb-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Bot 类型</Label>
                        <div className="grid grid-cols-2 gap-1.5">
                          {MIDJOURNEY_BOT_TYPES.map((bot) => (
                            <Button
                              key={bot.value}
                              type="button"
                              variant={selectedMidjourneyBotType === bot.value ? 'default' : 'outline'}
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => updateExtraParam('botType', bot.value)}
                            >
                              {bot.label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">速度</Label>
                        <Select
                          value={(modelDraft.extraParams?.speed as string) || DEFAULT_MIDJOURNEY_SPEED}
                          onValueChange={(v) => updateExtraParam('speed', v)}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="relaxed">Relaxed</SelectItem>
                            <SelectItem value="fast">Fast</SelectItem>
                            <SelectItem value="turbo">Turbo</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <Label className="text-xs">Stylization</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {(modelDraft.extraParams?.stylization as number) || DEFAULT_MIDJOURNEY_STYLIZATION}
                          </span>
                        </div>
                        <Slider
                          min={0}
                          max={1000}
                          step={1}
                          value={[(modelDraft.extraParams?.stylization as number) || DEFAULT_MIDJOURNEY_STYLIZATION]}
                          onValueChange={([v]) => updateExtraParam('stylization', v)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between">
                          <Label className="text-xs">Weirdness</Label>
                          <span className="text-[10px] text-muted-foreground">
                            {(modelDraft.extraParams?.weirdness as number) || 1}
                          </span>
                        </div>
                        <Slider
                          min={0}
                          max={3000}
                          step={1}
                          value={[(modelDraft.extraParams?.weirdness as number) || 1]}
                          onValueChange={([v]) => updateExtraParam('weirdness', v)}
                        />
                      </div>
                    </div>
                  </details>
                )}

                {/* Ideogram 特有参数（折叠） */}
                {kind === 'image' && hasIdeogramParams && (
                  <details className="rounded border border-border bg-muted/30">
                    <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground">
                      Ideogram 参数
                    </summary>
                    <div className="space-y-2 px-2 pb-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">渲染速度</Label>
                        <Select
                          value={(modelDraft.extraParams?.render_speed as string) || 'Balanced'}
                          onValueChange={(v) => updateExtraParam('render_speed', v)}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Turbo">Turbo</SelectItem>
                            <SelectItem value="Balanced">Balanced</SelectItem>
                            <SelectItem value="Quality">Quality</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">风格</Label>
                        <Select
                          value={(modelDraft.extraParams?.style as string) || 'Auto'}
                          onValueChange={(v) => updateExtraParam('style', v)}
                        >
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Auto">Auto</SelectItem>
                            <SelectItem value="General">General</SelectItem>
                            <SelectItem value="Realistic">Realistic</SelectItem>
                            <SelectItem value="Design">Design</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </details>
                )}

                {/* 视频更多参数（折叠） */}
                {kind === 'video' && (
                  <details className="rounded border border-border bg-muted/30">
                    <summary className="cursor-pointer px-2 py-1 text-[10px] text-muted-foreground">
                      更多参数
                    </summary>
                    <div className="space-y-2 px-2 pb-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">生成音频</Label>
                        <Switch
                          checked={modelDraft.generateAudio ?? false}
                          onCheckedChange={(v) => patchDraft({ generateAudio: v })}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">水印</Label>
                        <Switch
                          checked={modelDraft.watermark ?? true}
                          onCheckedChange={(v) => patchDraft({ watermark: v })}
                        />
                      </div>
                      {isSeedanceModel && (
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">联网搜索</Label>
                          <Switch
                            checked={modelDraft.webSearch ?? false}
                            onCheckedChange={(v) => patchDraft({ webSearch: v })}
                          />
                        </div>
                      )}
                    </div>
                  </details>
                )}
              </section>
            </PopoverContent>
          </Popover>
          </div>

          <div className="flex-1" />

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            onClick={handleSaveOnly}
            data-testid="drawer-save-only"
          >
            仅保存配置
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8 min-w-24 gap-1.5 text-xs shadow-sm"
            disabled={!modelDraft.model || isRunning}
            onClick={() => void handleGenerate()}
            data-testid="drawer-generate"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {isRunning ? '生成中…' : '开始生成'}
          </Button>
        </div>
      </div>

      {/* 素材库选参考（图片/视频共用，选中后写入对应 refs） */}
      <VolcAssetPanel
        open={assetDialogOpen}
        onOpenChange={setAssetDialogOpen}
        onSelectAsset={handleSelectAsset}
      />
    </div>
  );
}
