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
  const result = await generateFreedomVideo(videoParams);

  throwIfAborted(ctx.signal);

  const mediaRef: BlueprintMediaRef = {
    url: result.url,
    mediaId: result.mediaId,
    mimeType: 'video/mp4',
    dedupeKey: `vid-${ctx.node.id}-${result.taskId ?? Date.now()}`,
    taskId: result.taskId,
  };
  ctx.onProgress?.(100);

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

// ── Executor registry ────────────────────────────────────────────────────

export const NODE_EXECUTORS: Record<string, NodeExecutor> = {
  'text-input': executeTextInput,
  'image-reference': executeImageReference,
  'video-reference': executeVideoReference,
  'script-import': executeScriptImport,
  'image-generator': executeImageGenerator,
  'video-generator': executeVideoGenerator,
  output: executeOutput,
};
