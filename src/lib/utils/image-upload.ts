// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Image Upload Utility
 * Uploads base64 images to the configured image host to get HTTP URLs
 * Required because some APIs only accept URL format
 */

import { uploadToImageHost, isImageHostConfigured } from '@/lib/image-host';
import { readImageAsBase64 } from '@/lib/image-storage';

/**
 * 素材资产图片上传：优先使用对象存储，失败后再降级到图片图床。
 *
 * 对象存储上传本地文件，避免先把图片转成 base64 后再走稳定性较低的图床；
 * imageData 仍作为降级路径保留，兼容浏览器环境或无法取得本地文件路径的场景。
 */
export async function uploadAssetImage(
  imageData: string,
  localPath?: string,
): Promise<string> {
  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return imageData;
  }

  const objectStorage = typeof window !== 'undefined' ? window.objectStorage : undefined;
  if (localPath && objectStorage?.upload) {
    try {
      const configured = await objectStorage.isConfigured?.();
      if (configured) {
        const url = await objectStorage.upload(localPath);
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          return url;
        }
        console.warn('[ImageUpload] 对象存储返回了无效 URL，将降级到图片图床');
      }
    } catch (error) {
      console.warn('[ImageUpload] 对象存储上传失败，将降级到图片图床:', error);
    }
  }

  return uploadBase64Image(imageData);
}

/**
 * Upload base64 image and get HTTP URL
 * Uses the configured image host (imgbb/imgurl/custom)
 * Supports: base64 data URI (image/video/audio), HTTP URL, local-image:// paths
 *
 * Note: 大部分公共图床（imgbb 等）只接受图片，视频/音频会被服务端拒绝。
 * 这里仍允许传入并提交，由图床自行返回错误，方便用户感知。
 */
export async function uploadBase64Image(imageData: string): Promise<string> {
  // Skip if already a valid HTTP URL
  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return imageData;
  }

  let base64Data = imageData;

  // Handle local-image:// paths - convert to base64 first
  if (imageData.startsWith('local-image://')) {
    const converted = await readImageAsBase64(imageData);
    if (!converted) {
      throw new Error(`无法读取本地图片: ${imageData}`);
    }
    base64Data = converted;
  }

  // Validate base64 data: 允许图片 / 视频 / 音频
  if (!/^data:(image|video|audio)\//i.test(base64Data)) {
    throw new Error('Invalid asset data: must be base64 data URI (image/video/audio), HTTP URL, or local-image:// path');
  }

  if (!isImageHostConfigured()) {
    throw new Error('图床未配置');
  }

  const result = await uploadToImageHost(base64Data, {
    // 180 days for hosts that support expiration-style parameters
    expiration: 15552000,
  });

  if (result.success && result.url) {
    return result.url;
  }

  throw new Error(result.error || '素材上传失败（图床可能不支持非图片素材）');
}

/**
 * Upload multiple base64 images in parallel
 * Returns array of URLs (skips failed uploads)
 */
export async function uploadMultipleImages(base64Images: string[]): Promise<string[]> {
  if (base64Images.length === 0) return [];

  if (!isImageHostConfigured()) {
    throw new Error('图床未配置');
  }

  const results = await Promise.allSettled(
    base64Images.map(img => uploadBase64Image(img))
  );

  const urls: string[] = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      urls.push(result.value);
    } else {
      console.warn(`[ImageUpload] Image ${index} upload failed:`, result.reason);
    }
  });

  return urls;
}
