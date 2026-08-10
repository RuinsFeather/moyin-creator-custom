// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Shared hook: upload local image files to the Volcengine asset library.
 *
 * Used by blueprint video/image reference nodes (P1-1 MVP-B) so that
 * "一键上传到素材资产" produces a stable `assetId` / `volcAssetUri`
 * which the video generator executor can pass straight to the API.
 *
 * Flow (mirrors `VolcAssetPanel.handleUploadFiles`):
 *   1. read file as data URL
 *   2. save a local thumbnail via `saveImageToLocal`
 *   3. upload to object storage (fallback to image host) → public URL
 *   4. `window.volcAsset.createAsset({ imageUrl, groupId, name })` → assetId
 */

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

export interface AssetUploadResult {
  assetId: string;
  assetUri: string;
  /** Local thumbnail URL for preview. */
  url: string;
  name: string;
  groupId: string;
  groupName: string;
  uploadedAt: number;
}

/** Read a File as a base64 data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/** Load the persisted asset group (same key/logic as VolcAssetPanel). */
export async function loadAssetGroup(): Promise<{
  groupId: string;
  groupName: string;
} | null> {
  try {
    const fs = (window as unknown as { fileStorage?: { getItem: (k: string) => Promise<string | null> } }).fileStorage;
    const raw = fs
      ? await fs.getItem('volc-asset-group')
      : localStorage.getItem('volc-asset-group');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { groupId?: string; groupName?: string };
    return parsed.groupId ? { groupId: parsed.groupId, groupName: parsed.groupName ?? '' } : null;
  } catch {
    return null;
  }
}

/** Sanitize an asset file name for local thumbnail storage. */
function sanitizeAssetFileName(name: string): string {
  const baseName = name.replace(/\.[^.]+$/, '').slice(0, 40);
  return baseName.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_') || 'volc_asset';
}

interface UseAssetUploadOptions {
  /** Auto toast success/error messages. Default true. */
  notify?: boolean;
}

/**
 * Upload one or more image files to the asset library.
 * Returns `null` if the environment (window.volcAsset) is unavailable.
 */
export function useAssetUpload(options: UseAssetUploadOptions = {}) {
  const { notify = true } = options;
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState('');

  const uploadFiles = useCallback(
    async (files: File[]): Promise<AssetUploadResult[]> => {
      if (!window.volcAsset) {
        if (notify) toast.error('当前环境不支持素材上传（需要桌面端）');
        return [];
      }
      const group = await loadAssetGroup();
      if (!group) {
        if (notify) toast.error('请先在素材资产管理中创建或关联一个素材组');
        return [];
      }

      const imageFiles = files.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) {
        if (notify) toast.error('请选择图片文件');
        return [];
      }
      const oversized = imageFiles.filter((f) => f.size > 30 * 1024 * 1024);
      if (oversized.length > 0) {
        if (notify) toast.error(`${oversized.length} 个文件超过 30MB 限制`);
        return [];
      }

      setUploading(true);
      setProgress('准备上传...');
      const results: AssetUploadResult[] = [];
      try {
        const { uploadAssetImage } = await import('@/lib/utils/image-upload');
        const { saveImageToLocal } = await import('@/lib/image-storage');

        for (let i = 0; i < imageFiles.length; i++) {
          const file = imageFiles[i];
          setProgress(`(${i + 1}/${imageFiles.length}) ${file.name}：读取文件...`);
          try {
            const dataUrl = await readFileAsDataUrl(file);

            // Local thumbnail (素材管理面板不依赖火山临时 URL 展示)
            setProgress(`(${i + 1}/${imageFiles.length}) ${file.name}：保存缩略图...`);
            const ext =
              file.name.match(/\.(png|jpe?g|webp|gif|bmp|tiff)$/i)?.[1]?.toLowerCase() || 'png';
            const safeName = `${sanitizeAssetFileName(file.name)}_${Date.now()}.${ext === 'jpg' ? 'jpg' : ext}`;
            const localThumbnailUrl = await saveImageToLocal(dataUrl, 'volc-assets', safeName);

            // Upload to object storage (fallback to image host)
            setProgress(`(${i + 1}/${imageFiles.length}) ${file.name}：上传对象存储...`);
            const localPath = (() => {
              try {
                return window.objectStorage?.getPathForFile(file) || undefined;
              } catch {
                return undefined;
              }
            })();
            const publicUrl = await uploadAssetImage(dataUrl, localPath);

            // Create the asset in the Volcengine asset library
            setProgress(`(${i + 1}/${imageFiles.length}) ${file.name}：提交到素材库...`);
            const result = await window.volcAsset.createAsset({
              imageUrl: publicUrl,
              groupId: group.groupId,
              name: file.name,
            });

            results.push({
              assetId: result.assetId,
              assetUri: `Asset://${result.assetId}`,
              url: localThumbnailUrl,
              name: file.name,
              groupId: group.groupId,
              groupName: group.groupName,
              uploadedAt: Date.now(),
            });
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (notify) toast.error(`上传 ${file.name} 失败: ${msg}`);
          }
        }

        if (results.length > 0 && notify) {
          toast.success(`成功上传 ${results.length} 个素材`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (notify) toast.error(`上传失败: ${msg}`);
      } finally {
        setUploading(false);
        setProgress('');
      }
      return results;
    },
    [notify],
  );

  return { uploadFiles, uploading, progress };
}
