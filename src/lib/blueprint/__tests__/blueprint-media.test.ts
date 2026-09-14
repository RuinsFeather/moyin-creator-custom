// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyBlueprintMediaFile,
  persistDroppedBlueprintFiles,
} from '../blueprint-media';

describe('blueprint media drop helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'imageStorage', {
      configurable: true,
      value: undefined,
    });
  });

  it('classifies images and videos by MIME type', () => {
    expect(classifyBlueprintMediaFile({ name: 'cover.bin', type: 'image/png' })).toBe('image');
    expect(classifyBlueprintMediaFile({ name: 'clip.bin', type: 'video/mp4' })).toBe('video');
  });

  it('falls back to case-insensitive file extensions when MIME is absent', () => {
    expect(classifyBlueprintMediaFile({ name: 'cover.WEBP', type: '' })).toBe('image');
    expect(classifyBlueprintMediaFile({ name: 'clip.MOV', type: '' })).toBe('video');
    expect(classifyBlueprintMediaFile({ name: 'notes.txt', type: '' })).toBeNull();
  });

  it('persists only supported files and preserves their window kinds', async () => {
    const saveImage = vi.fn()
      .mockResolvedValueOnce({ success: true, localPath: 'local-image://blueprint-media/cover.png' })
      .mockResolvedValueOnce({ success: true, localPath: 'local-image://blueprint-media/clip.mp4' });
    Object.defineProperty(window, 'imageStorage', {
      configurable: true,
      value: { saveImage },
    });

    const image = new File(['image'], 'cover.png', { type: 'image/png' });
    const video = new File(['video'], 'clip.mp4', { type: 'video/mp4' });
    const text = new File(['text'], 'notes.txt', { type: 'text/plain' });

    const result = await persistDroppedBlueprintFiles([image, text, video]);

    expect(result).toHaveLength(2);
    expect(result.map(({ kind }) => kind)).toEqual(['image', 'video']);
    expect(result.map(({ ref }) => ref.url)).toEqual([
      'local-image://blueprint-media/cover.png',
      'local-image://blueprint-media/clip.mp4',
    ]);
    expect(saveImage).toHaveBeenCalledTimes(2);
  });
});