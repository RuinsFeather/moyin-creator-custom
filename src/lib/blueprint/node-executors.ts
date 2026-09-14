// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// Node executors for the blueprint execution engine.
//
// Each executor handles the logic for a specific blueprint node type.
// Input nodes (text-input, image-reference, video-reference, script-import)
// simply pass through their config. Generator nodes validate config and
// produce output (actual API calls are integrated in Phase 9).
//
// All executors are async and respect `AbortSignal` for cancellation.
// They receive collected upstream outputs so they can resolve inputs
// from predecessor nodes.
//
// ── Generation Chain Boundary (§9.3) ─────────────────────────────────────
// Blueprint image/video generators MUST use Freedom API exclusively.
// Director, S-Class, and Storyboard-specific capabilities (grid images,
// joint images, scene splitting) must NOT be imported or called here.
// If Director nodes are needed in the future, create a separate adapter
// that reads SplitScene data — do not treat Director API as Freedom API.
//
// Allowed imports: @/lib/freedom/freedom-api (Freedom API only)
// Prohibited imports: director-store, sclass-store, prompt-builder,
//   sclass-prompt-builder, auto-grouping, sclass-calibrator
// ─────────────────────────────────────────────────────────────────────────

import type {
  BlueprintEdge,
  BlueprintNode,
  BlueprintNodeData,
  BlueprintNodeExecution,
  BlueprintMediaRef,
  BlueprintTaskRef,
  TextInputNodeConfig,
  MediaReferenceNodeConfig,
  ScriptImportNodeConfig,
  BlueprintImageGeneratorConfig,
  BlueprintVideoGeneratorConfig,
  OutputNodeConfig,
  TextBoxConfig,
  ImageBoxConfig,
  VideoBoxConfig,
} from '@/types/blueprint';
import {
  collectReferenceImageRefs,
  collectVideoUploadFiles,
  mergePromptText,
} from './input-merge';
import {
  generateFreedomImage,
  generateFreedomVideo,
  type FreedomImageParams,
  type FreedomVideoParams,
  type FreedomVideoUploadFile,
} from '@/lib/freedom/freedom-api';
import { validateSeedanceReferenceCounts } from '@/lib/video/seedance-capability';

/** Context passed to every node executor. */
export interface NodeExecutionContext {
  /** The node being executed. */
  node: BlueprintNode;
  /** Collected outputs from all upstream (predecessor) nodes. */
  upstreamOutputs: Map<string, NodeExecutorOutput>;
  /** Edges in the current execution subgraph, used for port-aware input ordering. */
  edges: BlueprintEdge[];
  /** Node config, already extracted from node.data.config. */
  config: BlueprintNodeData['config'];
  /** Per-node AbortSignal (derived from the run-level signal). */
  signal: AbortSignal;
  /** Monotonic progress callback. `progress` is 0–100. */
  onProgress?: (progress: number) => void;
  /** Project ID for API calls and media persistence. */
  projectId: string;
  /**
   * Incremental node-state update. Lets executors write intermediate
   * execution state (e.g. video task refs) without waiting for the
   * executor to return.
   *
   * The callback merges into the existing execution record, so callers
   * may omit fields they do not want to change.
   */
  onUpdateNode?: (updates: Partial<BlueprintNodeExecution>) => void;
}

/** The result of a single node execution. */
export interface NodeExecutorOutput {
  /** Output data produced by this node. */
  data: BlueprintMediaRef | BlueprintMediaRef[] | string | null;
  /** Human-readable summary for logging (no sensitive info). */
  summary: string;
}

/** Signature every node executor must follow. */
export type NodeExecutor = (
  ctx: NodeExecutionContext,
) => Promise<NodeExecutorOutput>;

// ── Guard ─────────────────────────────────────────────────────────────────

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException('Execution aborted', 'AbortError');
  }
}

/**
 * Video APIs do not consistently expose a server-side percentage. Keep the
 * blueprint progress bar moving while the request is being polled, but leave
 * the final step to the executor after a successful response.
 */
async function generateVideoWithEstimatedProgress<T>(
  ctx: NodeExecutionContext,
  generate: () => Promise<T>,
): Promise<T> {
  let estimatedProgress = 10;
  const timer = setInterval(() => {
    if (estimatedProgress >= 90) return;

    const increment = estimatedProgress < 30 ? 3
      : estimatedProgress < 60 ? 2
      : 1;
    estimatedProgress = Math.min(90, estimatedProgress + increment);
    ctx.onProgress?.(estimatedProgress);
  }, 3000);

  try {
    const result = await generate();
    ctx.onProgress?.(100);
    return result;
  } finally {
    clearInterval(timer);
  }
}

// ── Input node executors ─────────────────────────────────────────────────

async function executeTextInput(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as TextInputNodeConfig;
  const text = cfg.text ?? '';
  ctx.onProgress?.(100);
  return {
    data: text,
    summary: `text (${text.length} chars)`,
  };
}

async function executeImageReference(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as MediaReferenceNodeConfig;
  const media = cfg.media ?? [];
  ctx.onProgress?.(100);
  return {
    data: media,
    summary: `image-reference (${media.length} refs)`,
  };
}

async function executeVideoReference(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as MediaReferenceNodeConfig;
  const media = cfg.media ?? [];
  ctx.onProgress?.(100);
  return {
    data: media,
    summary: `video-reference (${media.length} refs)`,
  };
}

async function executeScriptImport(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as ScriptImportNodeConfig;
  const shotCount = cfg.selectedShotIds?.length ?? 0;
  ctx.onProgress?.(100);
  return {
    data: null,
    summary: `script-import (${shotCount} shots, mode=${cfg.mode})`,
  };
}

// ── Generator executors ──────────────────────────────────────────────────

async function executeImageGenerator(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as BlueprintImageGeneratorConfig;
  const upstreamPrompt = mergePromptText(ctx.node.id, ctx.edges, ctx.upstreamOutputs);
  const prompt = upstreamPrompt || cfg.prompt?.trim() || '';

  if (!prompt) {
    throw new Error('图片生成器缺少 prompt');
  }

  const refImages = collectReferenceImageRefs(
    ctx.node.id,
    ctx.edges,
    ctx.upstreamOutputs,
  );

  // Resolve reference image URLs for the API
  const referenceImageUrls = refImages
    .filter((r) => r.url)
    .map((r) => r.url!);

  ctx.onProgress?.(10);
  throwIfAborted(ctx.signal);

  // Build Freedom API params
  const imageParams: FreedomImageParams = {
    prompt,
    projectId: ctx.projectId,
    model: cfg.model,
    aspectRatio: cfg.aspectRatio,
    resolution: cfg.resolution,
    width: cfg.width,
    height: cfg.height,
    negativePrompt: cfg.negativePrompt,
    referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    extraParams: cfg.extraParams as Record<string, unknown> | undefined,
    signal: ctx.signal,
    onProgress: (info) => {
      // Map Freedom progress phases to 0-100
      const phaseOffset = info.phase === 'submitting' ? 10
        : info.phase === 'processing' ? 30
        : info.phase === 'finalizing' ? 80
        : 95;
      ctx.onProgress?.(Math.min(95, phaseOffset + (info.percent || 0) * 0.2));
    },
  };

  // Call the real Freedom Image API
  const result = await generateFreedomImage(imageParams);

  throwIfAborted(ctx.signal);

  const mediaRef: BlueprintMediaRef = {
    url: result.url,
    mediaId: result.mediaId,
    mimeType: 'image/png',
    dedupeKey: `img-${ctx.node.id}-${result.taskId ?? Date.now()}`,
    taskId: result.taskId,
  };
  ctx.onProgress?.(100);

  return {
    data: mediaRef,
    summary: `image-generator (model=${cfg.model ?? 'default'}, refs=${refImages.length})`,
  };
}

async function executeVideoGenerator(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as BlueprintVideoGeneratorConfig;
  const upstreamPrompt = mergePromptText(ctx.node.id, ctx.edges, ctx.upstreamOutputs);
  const prompt = upstreamPrompt || cfg.prompt?.trim() || '';

  if (!prompt) {
    throw new Error('视频生成器缺少 prompt');
  }

  ctx.onProgress?.(10);
  throwIfAborted(ctx.signal);

  const resolvedUploads = collectVideoUploadFiles(
    ctx.node.id,
    ctx.edges,
    ctx.upstreamOutputs,
    cfg.referenceMediaRefs,
  );
  const uploadFiles: FreedomVideoUploadFile[] = resolvedUploads;

  // Build Freedom API params
  const videoParams: FreedomVideoParams = {
    prompt,
    projectId: ctx.projectId,
    model: cfg.model,
    aspectRatio: cfg.aspectRatio,
    duration: cfg.duration,
    resolution: cfg.resolution,
    generateAudio: cfg.generateAudio,
    watermark: cfg.watermark,
    uploadFiles: uploadFiles.length > 0 ? uploadFiles : undefined,
    signal: ctx.signal,
    onTaskCreated: (info) => {
      // Persist task reference to node execution state immediately.
      // This ensures the task can be recovered if the process dies
      // while the upstream video is still generating.
      const taskRef: BlueprintTaskRef = {
        taskId: info.taskId,
        route: info.route,
        pollUrl: info.pollUrl,
        model: info.model,
        serverTaskId: info.taskId,
      };
      ctx.onUpdateNode?.({ task: taskRef });
    },
  };

  // Call the real Freedom Video API
  const result = await generateVideoWithEstimatedProgress(ctx, () => generateFreedomVideo(videoParams));

  throwIfAborted(ctx.signal);

  const mediaRef: BlueprintMediaRef = {
    url: result.url,
    mediaId: result.mediaId,
    mimeType: 'video/mp4',
    dedupeKey: `vid-${ctx.node.id}-${result.taskId ?? Date.now()}`,
    taskId: result.taskId,
  };
  return {
    data: mediaRef,
    summary: `video-generator (model=${cfg.model ?? 'default'}, refs=${uploadFiles.length})`,
  };
}

// ── Output executor ──────────────────────────────────────────────────────

async function executeOutput(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as OutputNodeConfig;
  const acceptedTypes = new Set(cfg.acceptedTypes ?? ['image', 'video', 'audio']);

  // Collect all upstream media
  const collected: BlueprintMediaRef[] = [];
  for (const output of ctx.upstreamOutputs.values()) {
    if (Array.isArray(output.data)) {
      collected.push(
        ...output.data.filter(
          (item): item is BlueprintMediaRef =>
            typeof item === 'object' && item !== null && 'url' in item,
        ),
      );
    } else if (
      output.data &&
      typeof output.data === 'object' &&
      'url' in output.data
    ) {
      collected.push(output.data as BlueprintMediaRef);
    }
  }

  // Filter by accepted types (basic MIME check)
  const filtered = collected.filter((ref) => {
    if (!ref.mimeType) return true; // include if unknown
    const base = ref.mimeType.split('/')[0];
    return acceptedTypes.has(base as 'image' | 'video' | 'audio');
  });

  ctx.onProgress?.(100);
  return {
    data: filtered,
    summary: `output (${filtered.length} items, accepted=[${[...acceptedTypes].join(',')}])`,
  };
}

// ── v2 Box executor adapters ─────────────────────────────────────────────

/**
 * text-box executor: outputs config.text directly (same as legacy text-input).
 */
async function executeTextBox(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as TextBoxConfig;
  const text = cfg.text ?? '';
  ctx.onProgress?.(100);
  return {
    data: text,
    summary: `text-box (${text.length} chars)`,
  };
}

/**
 * image-box executor: delegates based on generation presence.
 * - no generation: pass through media[] (import/reference window)
 * - has generation: delegate to executeImageGenerator logic
 */
async function executeImageBox(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as ImageBoxConfig;

  if (!cfg.generation) {
    const media = cfg.media ?? [];
    ctx.onProgress?.(100);
    return {
      data: media,
      summary: `image-box/media (${media.length} refs)`,
    };
  }

  // generation window: delegate to shared generator logic.
  // Manual references (ImageBoxConfig.referenceImageRefs) merge after
  // upstream edge references — "connected (by order) → manual".
  return executeImageGeneratorFromConfig(ctx, cfg.generation, cfg.referenceImageRefs);
}

/**
 * video-box executor: delegates based on generation presence.
 * - no generation: pass through media[] (import/reference window)
 * - has generation: delegate to executeVideoGenerator logic
 */
async function executeVideoBox(
  ctx: NodeExecutionContext,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const cfg = ctx.config as VideoBoxConfig;

  if (!cfg.generation) {
    const media = cfg.media ?? [];
    ctx.onProgress?.(100);
    return {
      data: media,
      summary: `video-box/media (${media.length} refs)`,
    };
  }

  // generation window: delegate to shared generator logic
  return executeVideoGeneratorFromConfig(ctx, cfg.generation);
}

// ── Shared generator logic (extracted for adapter reuse) ─────────────────

/**
 * Core image generation logic, shared between legacy image-generator
 * and v2 image-box (generate mode).
 *
 * `configRefs` carries the box-level manual references
 * (`ImageBoxConfig.referenceImageRefs`); they are appended after
 * upstream edge references and capped together at 10.
 */
async function executeImageGeneratorFromConfig(
  ctx: NodeExecutionContext,
  genConfig: BlueprintImageGeneratorConfig,
  configRefs?: BlueprintMediaRef[],
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const upstreamPrompt = mergePromptText(ctx.node.id, ctx.edges, ctx.upstreamOutputs);
  const prompt = upstreamPrompt || genConfig.prompt?.trim() || '';

  if (!prompt) {
    throw new Error('图片生成器缺少 prompt');
  }

  const refImages = collectReferenceImageRefs(
    ctx.node.id,
    ctx.edges,
    ctx.upstreamOutputs,
    10,
    configRefs,
  );

  // 优先使用 volcAssetUri（火山引擎已上传素材直接引用，避免重新上传）；
  // 无 volcAssetUri 时降级为 url（http URL / local-image:// / data URL）。
  const referenceImageUrls = refImages
    .filter((r) => r.volcAssetUri || r.url)
    .map((r) => r.volcAssetUri ?? r.url!);

  ctx.onProgress?.(10);
  throwIfAborted(ctx.signal);

  const imageParams: FreedomImageParams = {
    prompt,
    projectId: ctx.projectId,
    model: genConfig.model,
    aspectRatio: genConfig.aspectRatio,
    resolution: genConfig.resolution,
    width: genConfig.width,
    height: genConfig.height,
    negativePrompt: genConfig.negativePrompt,
    referenceImages: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    extraParams: genConfig.extraParams as Record<string, unknown> | undefined,
    signal: ctx.signal,
    onProgress: (info) => {
      const phaseOffset = info.phase === 'submitting' ? 10
        : info.phase === 'processing' ? 30
        : info.phase === 'finalizing' ? 80
        : 95;
      ctx.onProgress?.(Math.min(95, phaseOffset + (info.percent || 0) * 0.2));
    },
  };

  const result = await generateFreedomImage(imageParams);
  throwIfAborted(ctx.signal);

  const mediaRef: BlueprintMediaRef = {
    url: result.url,
    mediaId: result.mediaId,
    mimeType: 'image/png',
    dedupeKey: `img-${ctx.node.id}-${result.taskId ?? Date.now()}`,
    taskId: result.taskId,
  };
  ctx.onProgress?.(100);

  return {
    data: mediaRef,
    summary: `image-box/generate (model=${genConfig.model ?? 'default'}, refs=${refImages.length})`,
  };
}

/**
 * Core video generation logic, shared between legacy video-generator
 * and v2 video-box (generate mode).
 *
 * Studio-parity parameter mapping (§5.1):
 *   - `genConfig.webSearch` (drawer boolean) → FreedomVideoParams.tools
 *     `[{ type: 'web_search' }]` (mirrors VideoStudio).
 *   - `genConfig.edgeReferenceRoles` (keyed by edge ID) → per-edge role
 *     overrides for upstream references, merged inside
 *     `collectVideoUploadFiles`.
 *   - Seedance reference-count capability check before submit.
 */
async function executeVideoGeneratorFromConfig(
  ctx: NodeExecutionContext,
  genConfig: BlueprintVideoGeneratorConfig,
): Promise<NodeExecutorOutput> {
  throwIfAborted(ctx.signal);
  const upstreamPrompt = mergePromptText(ctx.node.id, ctx.edges, ctx.upstreamOutputs);
  const prompt = upstreamPrompt || genConfig.prompt?.trim() || '';

  if (!prompt) {
    throw new Error('视频生成器缺少 prompt');
  }

  ctx.onProgress?.(10);
  throwIfAborted(ctx.signal);

  const resolvedUploads = collectVideoUploadFiles(
    ctx.node.id,
    ctx.edges,
    ctx.upstreamOutputs,
    genConfig.referenceMediaRefs,
    genConfig.edgeReferenceRoles,
  );
  const uploadFiles: FreedomVideoUploadFile[] = resolvedUploads;

  // Seedance capability check: reference counts (studio parity).
  {
    const images = uploadFiles.filter((f) => f.assetType !== 'video' && f.assetType !== 'audio').length;
    const videos = uploadFiles.filter((f) => f.assetType === 'video').length;
    const audios = uploadFiles.filter((f) => f.assetType === 'audio').length;
    const countError = validateSeedanceReferenceCounts(genConfig.model, { images, videos, audios });
    if (countError) {
      throw new Error(countError);
    }
  }

  const videoParams: FreedomVideoParams = {
    prompt,
    projectId: ctx.projectId,
    model: genConfig.model,
    aspectRatio: genConfig.aspectRatio,
    duration: genConfig.duration,
    resolution: genConfig.resolution,
    generateAudio: genConfig.generateAudio,
    watermark: genConfig.watermark,
    uploadFiles: uploadFiles.length > 0 ? uploadFiles : undefined,
    // Drawer stores a `webSearch` boolean; the API expects a tools array.
    tools: genConfig.webSearch ? [{ type: 'web_search' as const }] : undefined,
    signal: ctx.signal,
    onTaskCreated: (info) => {
      const taskRef: BlueprintTaskRef = {
        taskId: info.taskId,
        route: info.route,
        pollUrl: info.pollUrl,
        model: info.model,
        serverTaskId: info.taskId,
      };
      ctx.onUpdateNode?.({ task: taskRef });
    },
  };

  const result = await generateVideoWithEstimatedProgress(ctx, () => generateFreedomVideo(videoParams));
  throwIfAborted(ctx.signal);

  const mediaRef: BlueprintMediaRef = {
    url: result.url,
    mediaId: result.mediaId,
    mimeType: 'video/mp4',
    dedupeKey: `vid-${ctx.node.id}-${result.taskId ?? Date.now()}`,
    taskId: result.taskId,
  };
  return {
    data: mediaRef,
    summary: `video-box/generate (model=${genConfig.model ?? 'default'}, refs=${uploadFiles.length})`,
  };
}

// ── Executor registry ────────────────────────────────────────────────────

export const NODE_EXECUTORS: Record<string, NodeExecutor> = {
  // v2 box types
  'text-box': executeTextBox,
  'image-box': executeImageBox,
  'video-box': executeVideoBox,
  'script-import': executeScriptImport,
  output: executeOutput,
  // Legacy types retained for migration compatibility
  'text-input': executeTextInput,
  'image-reference': executeImageReference,
  'video-reference': executeVideoReference,
  'image-generator': executeImageGenerator,
  'video-generator': executeVideoGenerator,
};
