// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.
//
// 蓝图画布：把用户添加的本地 File 持久化成稳定的媒体引用。
//
// 问题背景：早期实现直接用 `URL.createObjectURL(file)` 生成 `blob:` URL
// 存入节点配置。`blob:` URL 仅在当前页面会话有效，且无法被上传链路
// （uploadBase64Image / toUploadHttpUrl）识别 —— 下游会抛出
// "Invalid asset data: must be base64 data URI (image/video/audio), HTTP
// URL, or local-image:// path"。
//
// 现在统一改为：
//   1. Electron 环境：`imageStorage.saveImage` 落盘，返回
//      `local-image://blueprint-media/xxx` —— 重启后仍有效，可被
//      `readImageAsBase64` 读取并转成 base64 走图床。
//   2. 非 Electron（纯浏览器）降级：`readFileAsDataUrl` 生成 data URL，
//      会话内可预览、可上传，只是体积大（存入 store 时已是如此）。
//
// 同时为存量数据提供 `isRevokedBlobUrl` 判定，展示层遇到失效 blob: 时
// 可回退到占位图，而不是渲染破图。

import type { BlueprintMediaRef } from '@/types/blueprint';
import { generateUUID } from '@/lib/utils';
import { readFileAsDataUrl } from '@/hooks/use-asset-upload';

export type BlueprintDroppedMediaKind = 'image' | 'video';

export interface PersistedBlueprintDroppedMedia {
  file: File;
  kind: BlueprintDroppedMediaKind;
  ref: BlueprintMediaRef;
}

const IMAGE_FILE_EXTENSIONS = new Set([
  'avif', 'bmp', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp',
]);
const VIDEO_FILE_EXTENSIONS = new Set([
  'avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm',
]);

/** 根据 MIME 类型识别文件，并在系统未提供 MIME 时使用扩展名兜底。 */
export function classifyBlueprintMediaFile(file: Pick<File, 'name' | 'type'>): BlueprintDroppedMediaKind | null {
  const mimeType = file.type.toLowerCase();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';

  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_FILE_EXTENSIONS.has(extension)) return 'video';
  return null;
}

/** 媒体在 `local-image://` 下的目录名（对应 getMediaRoot()/blueprint-media）。 */
const BLUEPRINT_MEDIA_CATEGORY = 'blueprint-media';

/**
 * 把本地 File 转成持久化的 URL。
 * 优先 `local-image://blueprint-media/...`（Electron），降级 data URL。
 */
export async function persistFileUrl(file: File): Promise<string> {
  if (window.imageStorage) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await window.imageStorage.saveImage(
        dataUrl,
        BLUEPRINT_MEDIA_CATEGORY,
        file.name,
      );
      if (result.success && result.localPath) {
        return result.localPath;
      }
      console.warn('[blueprint-media] saveImage 未成功，降级 data URL:', result.error);
    } catch (err) {
      console.warn('[blueprint-media] saveImage 异常，降级 data URL:', err);
    }
  }
  return readFileAsDataUrl(file);
}

/**
 * 批量把 File 列表转成 `BlueprintMediaRef[]`（持久化 URL + 元数据）。
 * 任何持久化失败都会降级为 data URL，保证流程不中断。
 */
export async function persistFilesAsRefs(
  files: File[],
  extra?: Partial<Omit<BlueprintMediaRef, 'url' | 'dedupeKey'>>,
): Promise<BlueprintMediaRef[]> {
  return Promise.all(
    files.map(async (file) => ({
      url: await persistFileUrl(file),
      localPath: file.name,
      mimeType: file.type,
      dedupeKey: generateUUID(),
      ...extra,
    })),
  );
}

/** 持久化拖入画布的受支持素材，并保留文件与媒体类型的对应关系。 */
export async function persistDroppedBlueprintFiles(
  files: File[],
): Promise<PersistedBlueprintDroppedMedia[]> {
  const supported = files
    .map((file) => ({ file, kind: classifyBlueprintMediaFile(file) }))
    .filter((item): item is { file: File; kind: BlueprintDroppedMediaKind } => item.kind !== null);
  const refs = await persistFilesAsRefs(supported.map(({ file }) => file));
  return supported.map((item, index) => ({ ...item, ref: refs[index] }));
}

/**
 * 判断 URL 是否为已（可能）失效的 blob: 引用。
 * 存量蓝图数据里可能仍有 blob: URL —— 页面重载后它们全部失效。
 */
export function isRevokedBlobUrl(url?: string | null): boolean {
  return !!url && url.startsWith('blob:');
}
