import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cors-fetch', () => ({
  corsFetch: vi.fn(),
}));

vi.mock('@/lib/image-storage', () => ({
  readImageAsBase64: vi.fn(),
}));

import { corsFetch } from '@/lib/cors-fetch';
import {
  buildGptImageEditsUrl,
  buildMultipartBody,
  submitGptImageEdit,
} from './gpt-image-edits';

describe('GPT Image edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds the edits endpoint without duplicating /v1', () => {
    expect(buildGptImageEditsUrl('https://api.example.com')).toBe('https://api.example.com/v1/images/edits');
    expect(buildGptImageEditsUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1/images/edits');
  });

  it('uses image for one file and image[] for multiple files', async () => {
    const one = buildMultipartBody(
      { model: 'gpt-image-2.5-sunburst', prompt: 'edit' },
      [{ blob: new Blob(['one'], { type: 'image/png' }), filename: 'one.png' }],
    );
    expect(await one.body.text()).toContain('name="image"; filename="one.png"');

    const many = buildMultipartBody(
      { model: 'gpt-image-2.5-sunburst', prompt: 'edit' },
      [
        { blob: new Blob(['one'], { type: 'image/png' }), filename: 'one.png' },
        { blob: new Blob(['two'], { type: 'image/jpeg' }), filename: 'two.jpg' },
      ],
    );
    const text = await many.body.text();
    expect(text.match(/name="image\[\]"/g)).toHaveLength(2);
    expect(many.contentType).toMatch(/^multipart\/form-data; boundary=/);
  });

  it('posts a reference image to /v1/images/edits as multipart', async () => {
    vi.mocked(corsFetch).mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://example.com/edited.png' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await submitGptImageEdit({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'gpt-image-2.5-sunburst',
      prompt: 'Keep the subject and change the background',
      referenceImages: ['data:image/png;base64,aGVsbG8='],
      size: '1536x1024',
    });

    expect(result).toBe('https://example.com/edited.png');
    expect(corsFetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(corsFetch).mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/images/edits');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(init?.body).toBeInstanceOf(Blob);
    const bodyText = await (init?.body as Blob).text();
    expect(bodyText).toContain('name="model"');
    expect(bodyText).toContain('gpt-image-2.5-sunburst');
    expect(bodyText).toContain('name="prompt"');
    expect(bodyText).toContain('name="image"');
  });

  it('returns b64_json with the requested output MIME type', async () => {
    vi.mocked(corsFetch).mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'YWJj' }],
    }), { status: 200 }));

    await expect(submitGptImageEdit({
      baseUrl: 'https://api.example.com',
      apiKey: 'secret',
      model: 'gpt-image-2.5-sunburst',
      prompt: 'edit',
      referenceImages: ['data:image/png;base64,aGVsbG8='],
      extraParams: { output_format: 'webp' },
    })).resolves.toBe('data:image/webp;base64,YWJj');
  });
});