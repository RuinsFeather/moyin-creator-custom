// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Streaming chat API client (OpenAI-compatible SSE)
 *
 * 供剧本助手等对首字延迟敏感的对话场景使用：
 * - SSE `stream: true` 请求，逐 chunk 回调 onText
 * - 保留多 key 轮换（与 callChatAPI 一致）
 * - 兼容主进程代理（netProxy）与 Vite 开发代理（流式透传）
 * - 供应商偶发在 stream:true 时返回整体 JSON —— 自动降级解析
 */

import { ApiKeyManager } from '@/lib/api-key-manager';
import { corsFetch } from '@/lib/cors-fetch';
import { retryOperation } from '@/lib/utils/retry';

export interface ChatStreamOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 多 key 轮换管理器（与 callChatAPI 共享同一个实例） */
  keyManager?: ApiKeyManager;
  temperature?: number;
  maxTokens?: number;
  /** 关闭智谱推理模型深度思考（thinking.type=disabled） */
  disableThinking?: boolean;
  /** 中止信号 */
  signal?: AbortSignal;
}

export interface ChatStreamCallbacks {
  /**
   * 增量文本回调。event === 'reasoning' 表示思考过程增量（DeepSeek-R1 等），
   * 'text' 为正文增量。
   */
  onText?: (delta: string, event: { type: 'text' | 'reasoning' }) => void;
  /** 流结束（正常或异常都会触发一次，error 非空表示失败） */
  onDone?: (result: { error?: Error }) => void;
}

/** 解析单条 SSE data 行，返回增量文本。无法解析时返回 null。 */
export function parseSSEDelta(line: string): {
  text: string;
  reasoning: string;
  finishReason: string | null;
} | null {
  const payload = line.replace(/^data:\s*/, '').trim();
  if (!payload || payload === '[DONE]') return null;
  try {
    const chunk = JSON.parse(payload);
    const choice = chunk.choices?.[0];
    if (!choice) return null;
    const delta = choice.delta ?? choice.message ?? {};
    const text =
      typeof delta.content === 'string'
        ? delta.content
        : Array.isArray(delta.content)
          // 多模态分段：仅取 text part
          ? delta.content
              .filter((part: any) => part && typeof part === 'object' && typeof part.text === 'string')
              .map((part: any) => part.text)
              .join('')
          : '';
    const reasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? delta.reasoning
          : '';
    const finishReason =
      typeof choice.finish_reason === 'string' ? choice.finish_reason : null;
    return { text, reasoning, finishReason };
  } catch {
    return null;
  }
}

/** 从非 SSE 的整体 JSON 响应中提取文本（部分供应商忽略 stream:true）。 */
function extractNonStreamText(responseText: string): string | null {
  try {
    const data = JSON.parse(responseText);
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((part: any) => part && typeof part.text === 'string')
        .map((part: any) => part.text)
        .join('');
    }
    return null;
  } catch {
    return null;
  }
}

function buildChatUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized)
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

/**
 * 流式 chat completions 调用。
 * 返回完整正文文本。失败时 throw（带 status）。
 */
export async function callChatAPIStream(
  systemPrompt: string,
  userPrompt: string,
  options: ChatStreamOptions,
  callbacks?: ChatStreamCallbacks,
): Promise<string> {
  const { apiKey, baseUrl, model } = options;
  if (!apiKey) throw new Error('API Key 未配置');
  if (!baseUrl) throw new Error('Base URL 未配置');
  if (!model) throw new Error('模型未配置');

  const keyManager = options.keyManager || new ApiKeyManager(apiKey);
  const totalKeys = keyManager.getTotalKeyCount();
  const url = buildChatUrl(baseUrl);

  console.log(`[callChatAPIStream] ${model} -> ${url} (keys: ${totalKeys}, stream: true)`);

  return retryOperation(async () => {
    const currentKey = keyManager.getCurrentKey();
    if (!currentKey) throw new Error('No API keys available');

    const body: Record<string, any> = {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 4096,
      stream: true,
    };
    if (options.disableThinking) {
      body.thinking = { type: 'disabled' };
    }

    const response = await corsFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (keyManager.handleError(response.status, errorText)) {
        console.warn(
          `[callChatAPIStream] key rotated due to ${response.status}, available: ${keyManager.getAvailableKeyCount()}/${totalKeys}`,
        );
      }
      const error = new Error(`API request failed: ${response.status} - ${errorText.slice(0, 300)}`);
      (error as any).status = response.status;
      throw error;
    }

    // 供应商忽略 stream:true 时返回整体 JSON —— 直接提取
    const contentType = response.headers?.get?.('content-type') ?? '';
    if (!contentType.includes('event-stream')) {
      const whole = await response.text();
      const text = extractNonStreamText(whole);
      if (text == null) throw new Error('无法解析 API 响应（非 SSE 且非 JSON）');
      callbacks?.onText?.(text, { type: 'text' });
      callbacks?.onDone?.({});
      if (totalKeys > 1) keyManager.rotateKey();
      return text;
    }

    // —— SSE 解析 ——
    const reader = response.body?.getReader();
    if (!reader) throw new Error('当前环境不支持流式响应（无 body reader）');

    const signal = options.signal;

    // abort 后部分实现的 reader.read() 不会返回 —— 主动 cancel 流，让 read() 立即以 done 收尾
    const onAbort = () => { try { void reader.cancel(); } catch { /* noop */ } };
    signal?.addEventListener('abort', onAbort);

    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let sawAnyEvent = false;

    const handleLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      const parsed = parseSSEDelta(line);
      if (!parsed) return;
      sawAnyEvent = true;
      if (parsed.reasoning) callbacks?.onText?.(parsed.reasoning, { type: 'reasoning' });
      if (parsed.text) {
        fullText += parsed.text;
        callbacks?.onText?.(parsed.text, { type: 'text' });
      }
    };

    try {
      for (;;) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE 事件以空行分隔；逐行处理，最后一段留在 buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          handleLine(line.replace(/\r$/, ''));
        }
      }
      if (buffer) handleLine(buffer.replace(/\r$/, ''));
    } finally {
      signal?.removeEventListener('abort', onAbort);
      try { reader.releaseLock(); } catch { /* noop */ }
    }

    // 用户主动中止：不算失败，返回已收到的部分内容（可能为空）
    if (signal?.aborted) {
      callbacks?.onDone?.({});
      return fullText;
    }

    if (!fullText && !sawAnyEvent) {
      // 极少数代理把整段 JSON 塞进流里但 content-type 标了 event-stream —— 已在上面
      // 逐行 data: 处理；这里兜底空响应。
      throw new Error('流式响应为空（未收到任何数据块）');
    }

    callbacks?.onDone?.({});
    // 成功后轮换 key 分摊负载（与 callChatAPI 行为一致）
    if (totalKeys > 1) keyManager.rotateKey();
    return fullText;
  }, { maxRetries: 3, baseDelay: 2000 });
}
