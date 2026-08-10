import { describe, expect, it } from 'vitest';
import {
  SEEDANCE_2_5_MODEL_ID,
  isSeedance25Model,
  resolveSeedanceCapability,
  validateSeedanceDuration,
  validateSeedanceReferenceCounts,
} from '../seedance-capability';
import {
  getAspectRatiosForT2VModel,
  getResolutionsForModel,
} from '../../freedom/model-registry';

describe('Seedance 2.5 capability', () => {
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
