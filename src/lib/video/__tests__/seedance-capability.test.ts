import { describe, expect, it } from 'vitest';
import {
  SEEDANCE_2_5_MODEL_ID,
  isSeedanceModel,
  isSeedance25Model,
  resolveSeedanceCapability,
  resolveSeedanceCapabilityModelId,
  validateSeedanceDuration,
  validateSeedanceReferenceCounts,
} from '../seedance-capability';
import {
  getAspectRatiosForT2VModel,
  getResolutionsForModel,
} from '../../freedom/model-registry';

describe('Seedance 2.5 capability', () => {
  it('recognizes Seedance names without the doubao prefix', () => {
    expect(isSeedanceModel('seedance-2.0')).toBe(true);
    expect(isSeedanceModel('seedance-2.5')).toBe(true);
    expect(isSeedanceModel('seedance-1.5-pro')).toBe(true);
    expect(resolveSeedanceCapability('seedance-2.0').version).toBe('2.0');
    expect(resolveSeedanceCapability('seedance-2.5').version).toBe('2.5');
    expect(resolveSeedanceCapability('seedance-1.5-pro').version).toBe('legacy');
  });

  it('maps prefixed and unprefixed names to registered UI capabilities', () => {
    expect(resolveSeedanceCapabilityModelId('seedance-2.0')).toBe('seedance-pro-t2v');
    expect(resolveSeedanceCapabilityModelId('doubao-seedance-2-0-260128')).toBe('seedance-pro-t2v');
    expect(resolveSeedanceCapabilityModelId('seedance-2.5')).toBe('seedance-2.5');
    expect(resolveSeedanceCapabilityModelId(SEEDANCE_2_5_MODEL_ID)).toBe('seedance-2.5');
    expect(resolveSeedanceCapabilityModelId('seedance-1.5-pro')).toBe('seedance-v1.5-pro-t2v');
    expect(resolveSeedanceCapabilityModelId('doubao-seedance-1-5-pro-251215')).toBe('seedance-v1.5-pro-t2v');
    expect(resolveSeedanceCapabilityModelId('SEEDANCE-1.5-PRO-FAST')).toBe('seedance-v1.5-pro-t2v-fast');
  });

  it('recognizes the official model and structured parameters', () => {
    expect(isSeedance25Model(SEEDANCE_2_5_MODEL_ID)).toBe(true);
    const capability = resolveSeedanceCapability(SEEDANCE_2_5_MODEL_ID);
    expect(capability.structuredParameters).toBe(true);
    expect([capability.minDuration, capability.maxDuration]).toEqual([4, 30]);
    expect(capability.referenceLimits).toMatchObject({
      maxTotal: 50,
      maxImages: 30,
      maxVideos: 10,
      maxAudios: 10,
    });
  });

  it('exposes only the officially supported output options', () => {
    expect(getAspectRatiosForT2VModel('seedance-2.5')).toEqual([
      '21:9', '16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive',
    ]);
    expect(getResolutionsForModel('seedance-2.5')).toEqual(['480p', '720p']);
  });

  it('validates the 4-30 second integer range', () => {
    expect(validateSeedanceDuration(SEEDANCE_2_5_MODEL_ID, 4)).toBeNull();
    expect(validateSeedanceDuration(SEEDANCE_2_5_MODEL_ID, 30)).toBeNull();
    expect(validateSeedanceDuration(SEEDANCE_2_5_MODEL_ID, 3)).not.toBeNull();
    expect(validateSeedanceDuration(SEEDANCE_2_5_MODEL_ID, 31)).not.toBeNull();
    expect(validateSeedanceDuration(SEEDANCE_2_5_MODEL_ID, 4.5)).not.toBeNull();
  });

  it('validates per-type and total reference limits', () => {
    expect(validateSeedanceReferenceCounts(SEEDANCE_2_5_MODEL_ID, {
      images: 30,
      videos: 10,
      audios: 10,
    })).toBeNull();
    expect(validateSeedanceReferenceCounts(SEEDANCE_2_5_MODEL_ID, {
      images: 31,
      videos: 0,
      audios: 0,
    })).toContain('图片');
    expect(validateSeedanceReferenceCounts(SEEDANCE_2_5_MODEL_ID, {
      images: 0,
      videos: 11,
      audios: 0,
    })).toContain('视频');
    expect(validateSeedanceReferenceCounts(SEEDANCE_2_5_MODEL_ID, {
      images: 0,
      videos: 0,
      audios: 11,
    })).toContain('音频');
    expect(validateSeedanceReferenceCounts(SEEDANCE_2_5_MODEL_ID, {
      images: 30,
      videos: 10,
      audios: 11,
    })).not.toBeNull();
  });

  it('keeps Seedance 2.0 limits unchanged', () => {
    const capability = resolveSeedanceCapability('doubao-seedance-2-0-260128');
    expect([capability.minDuration, capability.maxDuration]).toEqual([4, 15]);
    expect(capability.referenceLimits).toMatchObject({
      maxTotal: 12,
      maxImages: 9,
      maxVideos: 3,
      maxAudios: 3,
    });
  });
});
