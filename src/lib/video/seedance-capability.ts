// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/** Seedance 2.5 官方模型 ID。 */
export const SEEDANCE_2_5_MODEL_ID = 'doubao-seedance-2-5-260628';

export interface VideoReferenceLimits {
  maxTotal: number;
  maxImages: number;
  maxVideos: number;
  maxAudios: number;
  /** 旧模型的音频总时长限制；未设置表示不在客户端额外限制。 */
  maxAudioDurationSeconds?: number;
}

export interface SeedanceCapability {
  version: 'legacy' | '2.0' | '2.5';
  structuredParameters: boolean;
  minDuration: number;
  maxDuration: number;
  referenceLimits: VideoReferenceLimits;
}

const LEGACY_CAPABILITY: SeedanceCapability = {
  version: 'legacy',
  structuredParameters: false,
  minDuration: 4,
  maxDuration: 15,
  referenceLimits: {
    maxTotal: 12,
    maxImages: 9,
    maxVideos: 3,
    maxAudios: 3,
    maxAudioDurationSeconds: 15,
  },
};

const SEEDANCE_2_0_CAPABILITY: SeedanceCapability = {
  ...LEGACY_CAPABILITY,
  version: '2.0',
  structuredParameters: true,
};

export const SEEDANCE_2_5_CAPABILITY: SeedanceCapability = {
  version: '2.5',
  structuredParameters: true,
  minDuration: 4,
  maxDuration: 30,
  referenceLimits: {
    maxTotal: 50,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
  },
};

export function isSeedanceModel(modelId?: string): boolean {
  return /seedance/i.test(modelId || '');
}

export function isSeedance25Model(modelId?: string): boolean {
  return /(?:^|[-_])seedance[-_](?:v?2[._-]?5)(?:[-_]|$)/i.test(modelId || '')
    || (modelId || '').toLowerCase() === SEEDANCE_2_5_MODEL_ID;
}

export function resolveSeedanceCapability(modelId?: string): SeedanceCapability {
  if (isSeedance25Model(modelId)) return SEEDANCE_2_5_CAPABILITY;
  if (/(?:^|[-_])seedance[-_](?:v?2(?:[._-]?0)?)(?:[-_]|$)/i.test(modelId || '')) {
    return SEEDANCE_2_0_CAPABILITY;
  }
  return LEGACY_CAPABILITY;
}

export function validateSeedanceDuration(modelId: string | undefined, duration?: number): string | null {
  if (!isSeedanceModel(modelId) || duration == null) return null;
  const capability = resolveSeedanceCapability(modelId);
  if (!Number.isInteger(duration) || duration < capability.minDuration || duration > capability.maxDuration) {
    return `当前 Seedance 模型支持 ${capability.minDuration}-${capability.maxDuration} 秒整数时长`;
  }
  return null;
}

export function validateSeedanceReferenceCounts(
  modelId: string | undefined,
  counts: { images: number; videos: number; audios: number },
): string | null {
  if (!isSeedanceModel(modelId)) return null;
  const limits = resolveSeedanceCapability(modelId).referenceLimits;
  const total = counts.images + counts.videos + counts.audios;
  if (counts.images > limits.maxImages) return `参考图片最多 ${limits.maxImages} 张`;
  if (counts.videos > limits.maxVideos) return `参考视频最多 ${limits.maxVideos} 个`;
  if (counts.audios > limits.maxAudios) return `参考音频最多 ${limits.maxAudios} 个`;
  if (total > limits.maxTotal) return `参考文件总数最多 ${limits.maxTotal} 个`;
  return null;
}
