// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { corsFetch } from '@/lib/cors-fetch';
import { readImageAsBase64 } from '@/lib/image-storage';

const EDIT_OPTION_FIELDS = [
  'quality',
  'background',
  'input_fidelity',
  'output_format',
  'output_compression',
] as const;

export interface GptImageEditParams {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  referenceImages: string[];
  size?: string;
  extraParams?: Record<string, unknown>;
  signal?: AbortSignal;
}

export function buildGptImageEditsUrl(baseUrl: string): string {
  const root = baseUrl.replace(/\/+$/, '').replace(/\/v\d+$/, '');
  return `${root}/v1/images/edits`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error('参考图不是有效的 Data URL');
  const mimeType = match[1] || 'image/png';
  const binary = match[2] ? atob(match[3].replace(/\s/g, '')) : decodeURIComponent(match[3]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

async function referenceToBlob(source: string, signal?: AbortSignal): Promise<Blob> {
  let blob: Blob;
  if (/^https?:\/\//i.test(source)) {
    const response = await corsFetch(source, { signal });
    if (!response.ok) throw new Error(`参考图下载失败（HTTP ${response.status}）`);
    blob = await response.blob();
  } else if (source.startsWith('data:')) {
    blob = dataUrlToBlob(source);
  } else {
    const dataUrl = await readImageAsBase64(source);
    if (!dataUrl) throw new Error('无法读取本地参考图');
    blob = dataUrlToBlob(dataUrl);
  }

  if (blob.size === 0) throw new Error('参考图内容为空');
  if (blob.type && !blob.type.startsWith('image/')) throw new Error('参考文件不是有效图片');
  return blob;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('jpeg')) return 'jpg';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('gif')) return 'gif';
  return 'png';
}

function quote(value: string): string {
  return value.replace(/["\r\n]/g, '_');
}

export function buildMultipartBody(
  fields: Record<string, string>,
  images: Array<{ blob: Blob; filename: string }>,
): { body: Blob; contentType: string } {
  const boundary = `----MoyinGptImage${crypto.randomUUID().replace(/-/g, '')}`;
  const chunks: BlobPart[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`,
    );
  }
  const fieldName = images.length === 1 ? 'image' : 'image[]';
  for (const image of images) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${quote(image.filename)}"\r\nContent-Type: ${image.blob.type || 'image/png'}\r\n\r\n`,
      image.blob,
      '\r\n',
    );
  }
  chunks.push(`--${boundary}--\r\n`);
  return {
    body: new Blob(chunks, { type: `multipart/form-data; boundary=${boundary}` }),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function extractEditImage(data: any, outputFormat?: unknown): string | null {
  if (typeof data?.data?.[0]?.url === 'string') return data.data[0].url;
  if (typeof data?.data?.[0]?.b64_json === 'string') {
    const format = outputFormat === 'jpeg' ? 'jpeg' : outputFormat === 'webp' ? 'webp' : 'png';
    return `data:image/${format};base64,${data.data[0].b64_json}`;
  }
  return null;
}

export async function submitGptImageEdit(params: GptImageEditParams): Promise<string> {
  if (params.referenceImages.length === 0) throw new Error('图片编辑至少需要一张参考图');
  const refs = params.referenceImages.slice(0, 16);
  const images = await Promise.all(refs.map(async (source, index) => {
    const blob = await referenceToBlob(source, params.signal);
    return { blob, filename: `reference-${index + 1}.${extensionForMime(blob.type)}` };
  }));

  const fields: Record<string, string> = {
    model: params.model,
    prompt: params.prompt,
    n: String(params.extraParams?.n ?? 1),
  };
  if (params.size) fields.size = params.size;
  for (const key of EDIT_OPTION_FIELDS) {
    const value = params.extraParams?.[key];
    if (value !== undefined && value !== null) fields[key] = String(value);
  }

  const multipart = buildMultipartBody(fields, images);
  const response = await corsFetch(buildGptImageEditsUrl(params.baseUrl), {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${params.apiKey}`,
      'Content-Type': multipart.contentType,
    },
    body: multipart.body,
    signal: params.signal,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = `图片编辑 API 错误: ${response.status}`;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error?.message || parsed.message || message;
    } catch {
      if (text && text.length < 300) message = text;
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const imageUrl = extractEditImage(data, params.extraParams?.output_format);
  if (!imageUrl) throw new Error('图片编辑成功，但响应中没有图片数据');
  return imageUrl;
}