// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * P2 图片上下文纯函数测试（isImageDataUrl / estimateDataUrlBytes）
 * describeImage 依赖 feature 配置与网络，不在此覆盖（UI 层 toast 兜底）。
 */

import { describe, it, expect } from 'vitest';
import {
  isImageDataUrl,
  estimateDataUrlBytes,
  MAX_IMAGE_CONTEXT_COUNT,
  MAX_IMAGE_CONTEXT_BYTES,
} from '../image-context';

describe('isImageDataUrl', () => {
  it('识别标准 data:image/* URL', () => {
    expect(isImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isImageDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe(true);
    expect(isImageDataUrl('data:image/webp;base64,UklGR')).toBe(true);
  });

  it('拒绝非图片 data URL', () => {
    expect(isImageDataUrl('data:text/plain;base64,aGVsbG8=')).toBe(false);
    expect(isImageDataUrl('data:application/pdf;base64,JVBERi0')).toBe(false);
  });

  it('拒绝 http(s) 链接与空串', () => {
    expect(isImageDataUrl('https://example.com/a.png')).toBe(false);
    expect(isImageDataUrl('')).toBe(false);
    expect(isImageDataUrl('base64:iVBORw0KGgo=')).toBe(false);
  });
});

describe('estimateDataUrlBytes', () => {
  it('base64 长度 × 0.75 估算（忽略头）', () => {
    const url = 'data:image/png;base64,' + 'A'.repeat(400);
    expect(estimateDataUrlBytes(url)).toBe(300);
  });

  it('非 data URL 返回 0', () => {
    expect(estimateDataUrlBytes('https://example.com/a.png')).toBe(0);
    expect(estimateDataUrlBytes('')).toBe(0);
  });
});

describe('常量约束', () => {
  it('MAX_IMAGE_CONTEXT_COUNT 为正小整数', () => {
    expect(MAX_IMAGE_CONTEXT_COUNT).toBeGreaterThan(0);
    expect(MAX_IMAGE_CONTEXT_COUNT).toBeLessThanOrEqual(5);
  });

  it('MAX_IMAGE_CONTEXT_BYTES 为 4MB', () => {
    expect(MAX_IMAGE_CONTEXT_BYTES).toBe(4 * 1024 * 1024);
  });
});
