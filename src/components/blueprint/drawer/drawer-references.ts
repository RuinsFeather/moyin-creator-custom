// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// drawer-references — 参考列表构建/写回逻辑 for BoxConfigDrawer (§2.4 ① / P2-4).
//
// 把「连线参考 + 手动参考」汇总为一个有序 ReferenceItem[]：
// - 连线参考：按 edge.data.order（升序）+ edgeId 字典序排序（与
//   input-merge.rankEdges 同规则），缩略图取来源节点的 output/media。
// - 手动参考：图片版 config.referenceImageRefs；视频版
//   config.generation.referenceMediaRefs（带角色）。
// 删除/调序只作用于手动子集（连线参考要删得删连线），调序结果按
// 「手动子集内部相对顺序保持」写回对应 config 字段。

import type {
  BlueprintEdge,
  BlueprintNode,
  BlueprintMediaRef,
  BlueprintVideoReference,
  ImageBoxConfig,
  VideoBoxConfig,
  BlueprintVideoGeneratorConfig,
} from '@/types/blueprint';
import type {
  ReferenceItem,
} from '@/components/panels/freedom/shared/ReferenceList';

/**
 * 计算参考在统一列表中的引用标签（沿用工作室 getMultiRefTag 规则）：
 * `@image_file_N` / `@video_file_N` / `@audio_file_N`，同类型内按列表顺序 1 起编号。
 * 参考增删/调序后实时重算（纯函数，输入即当前列表）。
 */
export function getMultiRefTagForItem(
  key: string,
  items: ReferenceItem[],
): string {
  const item = items.find((i) => i.key === key);
  if (!item) return '';
  const mediaType = item.mediaType ?? 'image';
  const prefix =
    mediaType === 'video' ? 'video_file' : mediaType === 'audio' ? 'audio_file' : 'image_file';
  const sameType = items.filter((i) => (i.mediaType ?? 'image') === mediaType);
  const sameTypeIndex = sameType.findIndex((i) => i.key === key) + 1;
  if (sameTypeIndex <= 0) return '';
  return `@${prefix}_${sameTypeIndex}`;
}

/** 图片版参考上限（对齐 ImageStudio.MAX_REFERENCE_IMAGES）。 */
export const DRAWER_MAX_REFERENCE_IMAGES = 10;

/** 连线参考 + 手动参考的统一构建结果。 */
export interface DrawerReferenceModel {
  items: ReferenceItem[];
  /** edgeId -> source node（连线参考删除=删连线，由上层决定是否提供）。 */
  edgeIds: string[];
  /** 手动参考在 items 中的下标集合（删除/调序仅作用于这些）。 */
  manualIndices: number[];
  /** 手动参考是否已达上限。 */
  manualFull: boolean;
}

function mediaUrl(ref: BlueprintMediaRef | undefined): string {
  return ref?.url || ref?.localPath || '';
}

function inferMediaType(
  ref: BlueprintMediaRef | undefined,
): 'image' | 'video' | 'audio' | undefined {
  const mime = ref?.mimeType;
  if (mime?.startsWith('video/')) return 'video';
  if (mime?.startsWith('audio/')) return 'audio';
  if (ref && 'assetType' in ref) {
    const t = (ref as { assetType?: 'image' | 'video' | 'audio' }).assetType;
    if (t === 'video' || t === 'audio' || t === 'image') return t;
  }
  return 'image';
}

/**
 * 构建统一参考列表。kind 决定读取哪个 handle（reference-images /
 * reference-media）与哪个 config 字段。
 */
export function buildDrawerReferences(
  node: BlueprintNode,
  nodes: BlueprintNode[],
  edges: BlueprintEdge[],
): DrawerReferenceModel {
  const kind: 'image' | 'video' = node.data.nodeType === 'video-box' ? 'video' : 'image';
  const refHandle = kind === 'video' ? 'reference-media' : 'reference-images';
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // ── 1. 连线参考（rankEdges 同规则：order 升序 → edgeId 字典序） ──
  const connected = edges
    .filter((e) => e.target === node.id && e.targetHandle === refHandle)
    .sort(
      (a, b) =>
        (a.data?.order ?? 0) - (b.data?.order ?? 0) || a.id.localeCompare(b.id),
    );

  const items: ReferenceItem[] = [];
  const edgeIds: string[] = [];
  for (const edge of connected) {
    const source = nodeMap.get(edge.source);
    if (!source) continue;
    // 来源窗口的当前内容：output（生成/导入结果）优先，回退 config.media
    const out = source.data.output;
    const media: BlueprintMediaRef[] = Array.isArray(out)
      ? (out as BlueprintMediaRef[])
      : out
        ? [out as BlueprintMediaRef]
        : ((source.data.config as { media?: BlueprintMediaRef[] } | undefined)?.media ?? []);
    if (media.length === 0) continue;
    edgeIds.push(edge.id);
    for (const m of media) {
      items.push({
        key: `edge:${edge.id}:${m.dedupeKey ?? m.url ?? items.length}`,
        url: mediaUrl(m),
        name: m.localPath,
        source: 'edge',
        sourceLabel: source.data.label,
        mediaType: inferMediaType(m),
        removable: false,
      });
    }
  }

  // ── 2. 手动参考（图片：referenceImageRefs；视频：generation.referenceMediaRefs） ──
  const manualIndices: number[] = [];
  if (kind === 'image') {
    const cfg = node.data.config as ImageBoxConfig;
    for (const ref of cfg.referenceImageRefs ?? []) {
      manualIndices.push(items.length);
      items.push({
        key: `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? items.length}`,
        url: mediaUrl(ref),
        name: ref.localPath,
        source: ref.assetId || ref.volcAssetUri ? 'library' : 'manual',
        mediaType: 'image',
        removable: true,
      });
    }
  } else {
    const gen = (node.data.config as VideoBoxConfig).generation;
    for (const ref of gen?.referenceMediaRefs ?? []) {
      manualIndices.push(items.length);
      items.push({
        key: `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? items.length}`,
        url: mediaUrl(ref),
        name: ref.localPath,
        source: ref.assetId || ref.volcAssetUri ? 'library' : 'manual',
        mediaType: inferMediaType(ref),
        role: ref.role === 'first'
          ? '首帧'
          : ref.role === 'last'
            ? '尾帧'
            : ref.role === 'single'
              ? '单图'
              : ref.role
                ? '参考'
                : undefined,
        removable: true,
      });
    }
  }

  const manualFull =
    kind === 'image'
      ? manualIndices.length >= DRAWER_MAX_REFERENCE_IMAGES
      : false; // 视频上限按模型能力校验（P2-9）

  return { items, edgeIds, manualIndices, manualFull };
}

/** 把调序后的 keys 写回手动子集的顺序（仅重排，不增删）。 */
export function reorderManualRefs(
  node: BlueprintNode,
  keys: string[],
): Partial<{ config: ImageBoxConfig | VideoBoxConfig }> | null {
  const kind: 'image' | 'video' = node.data.nodeType === 'video-box' ? 'video' : 'image';
  if (kind === 'image') {
    const cfg = node.data.config as ImageBoxConfig;
    const refs = cfg.referenceImageRefs ?? [];
    const byKey = new Map(
      refs.map((ref, i) => [
        `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? i}`,
        ref,
      ]),
    );
    const next: BlueprintMediaRef[] = [];
    for (const key of keys) {
      const hit = byKey.get(key);
      if (hit) next.push(hit);
    }
    if (next.length !== refs.length) return null;
    return { config: { ...cfg, referenceImageRefs: next } };
  }

  const cfg = node.data.config as VideoBoxConfig;
  const gen: BlueprintVideoGeneratorConfig = cfg.generation ?? ({} as BlueprintVideoGeneratorConfig);
  const refs = gen.referenceMediaRefs ?? [];
  const byKey = new Map(
    refs.map((ref, i) => [
      `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? i}`,
      ref,
    ]),
  );
  const next: BlueprintVideoReference[] = [];
  for (const key of keys) {
    const hit = byKey.get(key);
    if (hit) next.push(hit);
  }
  if (next.length !== refs.length) return null;
  return {
    config: { ...cfg, generation: { ...gen, referenceMediaRefs: next } },
  };
}

/** 删除手动参考后的 config 写回。 */
export function removeManualRef(
  node: BlueprintNode,
  key: string,
): Partial<{ config: ImageBoxConfig | VideoBoxConfig }> | null {
  const kind: 'image' | 'video' = node.data.nodeType === 'video-box' ? 'video' : 'image';
  if (kind === 'image') {
    const cfg = node.data.config as ImageBoxConfig;
    const refs = cfg.referenceImageRefs ?? [];
    const next = refs.filter(
      (ref, i) =>
        `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? i}` !== key,
    );
    if (next.length === refs.length) return null;
    return { config: { ...cfg, referenceImageRefs: next } };
  }

  const cfg = node.data.config as VideoBoxConfig;
  const gen: BlueprintVideoGeneratorConfig = cfg.generation ?? ({} as BlueprintVideoGeneratorConfig);
  const refs = gen.referenceMediaRefs ?? [];
  const next = refs.filter(
    (ref, i) =>
      `manual:${ref.dedupeKey ?? ref.assetId ?? ref.url ?? i}` !== key,
  );
  if (next.length === refs.length) return null;
  return {
    config: { ...cfg, generation: { ...gen, referenceMediaRefs: next } },
  };
}

