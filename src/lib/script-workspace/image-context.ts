// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * P2 图片参考上下文
 *
 * 剧本助手的文本模型（script_analysis）多数不支持图片输入，
 * 图片参考统一走「图片理解」（image_understanding，Gemini 系）
 * 先转成结构化文字描述，再进 agent 上下文 —— 与
 * style-extractor.ts 相同的 OpenAI 兼容 image_url 协议。
 *
 * base64 图片只存在于运行时内存，不写入任何持久化 store。
 */

import { getFeatureConfig } from '@/lib/ai/feature-router';

/** 支持拖入的图片类型（MIME 前缀匹配） */
const IMAGE_MIME_PREFIX = 'data:image/';

/** 单张图片 base64 体积上限（4MB，与主流视觉模型请求体限制对齐） */
export const MAX_IMAGE_CONTEXT_BYTES = 4 * 1024 * 1024;

/** 单次发送最多解析的图片数 */
export const MAX_IMAGE_CONTEXT_COUNT = 3;

/** 判断是否为可用的图片 dataURL（用于拖入校验） */
export function isImageDataUrl(value: string): boolean {
  return value.startsWith(IMAGE_MIME_PREFIX) && value.includes('base64,');
}

/** 估算 dataURL 的字节体积（base64 长度 × 0.75）；非 base64 dataURL 返回 0 */
export function estimateDataUrlBytes(dataUrl: string): number {
  const marker = 'base64,';
  const index = dataUrl.indexOf(marker);
  if (index === -1) return 0;
  return Math.floor(dataUrl.slice(index + marker.length).length * 0.75);
}

function buildEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

function extractErrorMessage(status: number, errorText: string): string {
  let message = `API 请求失败: ${status}`;
  try {
    const errorJson = JSON.parse(errorText);
    message = errorJson.error?.message || errorJson.message || message;
  } catch {
    if (errorText && errorText.length < 200) message = errorText;
  }
  if (status === 401 || status === 403) {
    return 'API Key 无效或已过期，请检查「图片理解」服务的 Key 配置';
  }
  return message;
}

function getMessageContent(data: any): string {
  const rawContent = data?.choices?.[0]?.message?.content;
  if (typeof rawContent === 'string') return rawContent;
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

/**
 * 用 image_understanding 服务把一张图片转成简短中文描述。
 * 失败时抛错（调用方决定降级/提示策略）。
 */
export async function describeImage(
  imageDataUrl: string,
  hint?: string,
): Promise<string> {
  const config = getFeatureConfig('image_understanding');
  if (!config) {
    throw new Error('请先在设置中为「图片理解」功能绑定 API 提供商（图片参考需要该服务转写为文字）');
  }
  const baseUrl = config.baseUrl?.replace(/\/+$/, '');
  const model = config.model || config.models?.[0];
  if (!baseUrl || !model) {
    throw new Error('「图片理解」服务缺少 Base URL 或模型配置');
  }

  const userText = hint?.trim()
    ? `请用中文简要描述这张图片的画面内容（用于剧本创作参考）。用户补充：${hint.trim()}`
    : '请用中文简要描述这张图片的画面内容（用于剧本创作参考）：场景环境、人物外貌与动作、光线与色调氛围。控制在 150 字以内，不要输出 JSON。';

  const endpoint = buildEndpoint(baseUrl, 'chat/completions');
  const requestBody = {
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: 600,
  };

  const currentApiKey = config.keyManager.getCurrentKey() || config.apiKey;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${currentApiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(extractErrorMessage(response.status, errorText));
  }

  const data = await response.json();
  const content = getMessageContent(data).trim();
  if (!content) throw new Error('图片理解服务返回了空内容');
  return content;
}
