import { describe, expect, it } from 'vitest';
import {
  isStrictGptImageGenerationRequest,
  sanitizeImageGenerationJsonBody,
} from './image-request-policy';

describe('image request policy', () => {
  it('recognizes Sunburst on the strict generations endpoint', () => {
    expect(isStrictGptImageGenerationRequest('gpt-image-2.5-sunburst', '/v1/images/generations')).toBe(true);
  });

  it('removes unsupported reference aliases without changing generation fields', () => {
    const body = {
      model: 'gpt-image-2.5-sunburst',
      prompt: 'A sunrise',
      size: '1536x1024',
      image: 'base64',
      images: ['base64'],
      image_urls: ['data:image/png;base64,abc'],
      reference_images: ['base64'],
    };

    sanitizeImageGenerationJsonBody(body, body.model, '/v1/images/generations');

    expect(body).toEqual({
      model: 'gpt-image-2.5-sunburst',
      prompt: 'A sunrise',
      size: '1536x1024',
    });
  });

  it('does not alter custom providers or an edits endpoint', () => {
    const customBody = { model: 'custom-image', image: 'base64' };
    const editBody = { model: 'gpt-image-2.5-sunburst', image: 'base64' };

    expect(sanitizeImageGenerationJsonBody(customBody, customBody.model, '/v1/images/generations')).toBe(customBody);
    expect(sanitizeImageGenerationJsonBody(editBody, editBody.model, '/v1/images/edits')).toBe(editBody);
    expect(customBody.image).toBe('base64');
    expect(editBody.image).toBe('base64');
  });
});