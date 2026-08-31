// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Freedom Panel API Client
 * Wraps moyin-creator's existing AI infrastructure for single-shot generation
 * Features: smart endpoint routing, retry with exponential backoff
 */

import {
  getAllFeatureConfigs,
  getFeatureConfig,
  getFeatureNotConfiguredMessage,
  type FeatureConfig,
} from '@/lib/ai/feature-router';
import { resolveImageApiFormat } from '@/lib/api-key-manager';
import { uploadBase64Image } from '@/lib/utils/image-upload';
import { isVeoModel, resolveVeoUploadCapability } from '@/lib/freedom/veo-capability';
import { type AIFeature, useAPIConfigStore } from '@/stores/api-config-store';
import { useMediaStore } from '@/stores/media-store';
import { useProjectStore } from '@/stores/project-store';
import { corsFetch } from '@/lib/cors-fetch';
import { saveVideoToLocal } from '@/lib/image-storage';
import { toast } from 'sonner';
import { sanitizeErrorMessage } from '@/lib/blueprint/error-utils';
import {
  resolveSeedanceCapability,
  validateSeedanceDuration,
  validateSeedanceReferenceCounts,
} from '@/lib/video/seedance-capability';

// ==================== Types ====================

export interface FreedomImageParams {
  prompt: string;
  projectId?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  width?: number;
  height?: number;
  negativePrompt?: string;
  extraParams?: Record<string, any>;
  /** 参考图（dataUrl 或 http URL），最多 10 张。各路由按能力下发 */
  referenceImages?: string[];
  /** 进度回调（提交 / 轮询 / 完成）。phase 0..1，message 用于 UI */
  onProgress?: (info: FreedomProgress) => void;
  /** 用于取消任务的 AbortSignal（可中止提交请求与轮询） */
  signal?: AbortSignal;
}

export interface FreedomProgress {
  /** 阶段：submitting=提交中, processing=排队/生成中, finalizing=收尾, done=完成 */
  phase: 'submitting' | 'processing' | 'finalizing' | 'done';
  /** 0-100 进度百分比（粗略估算） */
  percent: number;
  /** 状态描述，可选 */
  message?: string;
}

export type FreedomVideoUploadRole = 'single' | 'first' | 'last' | 'reference';

export interface FreedomVideoUploadFile {
  role: FreedomVideoUploadRole;
  dataUrl: string;
  fileName?: string;
  mimeType?: string;
  /** 素材类型（多功能参考模式使用），用于区分图片/视频/音频 */
  assetType?: 'image' | 'video' | 'audio';
  /** 本地绝对路径（来自 webUtils.getPathForFile），有则可走对象存储上传 */
  localPath?: string;
  /** 火山引擎素材资产 URI（如 Asset://Asset-xxx），来自素材资产管理面板，直传不需要再上传 */
  volcAssetUri?: string;
}

export interface FreedomVideoParams {
  prompt: string;
  projectId?: string;
  model?: string;
  aspectRatio?: string;
  duration?: number;
  resolution?: string;
  generateAudio?: boolean;
  watermark?: boolean;
  uploadFiles?: FreedomVideoUploadFile[];
  tools?: Array<{ type: 'web_search' }>;
  /** 服务端任务创建成功时立即回调，用于持久化 taskId，避免应用退出后丢失查询入口。 */
  onTaskCreated?: (task: FreedomServerTaskInfo) => void;
  /** 用于取消任务的 AbortSignal */
  signal?: AbortSignal;
}

export interface FreedomServerTaskInfo {
  taskId: string;
  route: 'unified' | 'volc' | 'openai_official';
  pollUrl: string;
  model: string;
}

export interface ResumeFreedomVideoTaskParams extends FreedomServerTaskInfo {
  prompt: string;
  projectId?: string;
  signal?: AbortSignal;
}

export interface GenerationResult {
  url: string;
  taskId?: string;
  mediaId?: string;
  metadata?: Record<string, unknown>;
}

// ==================== Constants ====================

const IMAGE_POLL_INTERVAL = 2000;
const IMAGE_POLL_MAX_ATTEMPTS = 60;
// 视频生成统一采用无限轮询：耗时由模型与队列决定，不再设置客户端超时上限。
// 用户可通过任务卡片的取消按钮主动中断（AbortSignal）。
const VIDEO_POLL_INTERVAL = 2000;

// Retry config
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY = 3000;

// ==================== Retry Logic ====================

/**
 * Check if an error is retryable (rate limit / service unavailable / upstream overload)
 */
function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const err = error as any;
  if (err.retryable === false) return false;
  if (err.status === 429 || err.status === 500 || err.status === 502 || err.status === 503 || err.status === 529) return true;
  if (err.code === 429 || err.code === 500 || err.code === 502 || err.code === 503 || err.code === 529) return true;
  const message = (err.message || '').toLowerCase();
  if (message.includes('requested operation is unsupported') || message.includes('operation is unsupported')) return false;
  return (
    message.includes('429') ||
    message.includes('500') ||
    message.includes('502') ||
    message.includes('503') ||
    message.includes('529') ||
    message.includes('rate') ||
    message.includes('quota') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('internal server error') ||
    message.includes('overloaded') ||
    message.includes('上游负载') ||
    message.includes('上游服务') ||
    message.includes('饱和') ||
    message.includes('负载已满') ||
    message.includes('暂时不可用') ||
    message.includes('服务暂时不可用') ||
    message.includes('无可用渠道') ||
    message.includes('no available channel') ||
    message.includes('server error')
  );
}

/**
 * 判定「网关超时」类错误：504(Gateway Timeout) / 524(Cloudflare Timeout) / 522。
 * 这类错误的语义是：请求已转发给上游、上游正在生成（很可能已扣费），只是网关在
 * 结果返回前超时。对同步生成接口（如 Gemini 原生 generateContent）而言，
 * 自动重试会重新提交请求 → 二次扣费，且若模型生成耗时恒定超过网关窗口则每次都超时，
 * 因此**不应自动重试**，而应把准确原因透传给用户，由用户决定降分辨率或稍后手动重试。
 * 同时基于 HTTP 状态码与响应体文本双重判定，兼容中转站把网关超时包成
 * OpenAI 错误信封（openai_error / bad_response_status_code）或非标准状态码的情形。
 */
function isGatewayTimeout(status?: number, bodyText?: string): boolean {
  if (status === 504 || status === 524 || status === 522) return true;
  const t = (bodyText || '').toLowerCase();
  if (!t) return false;
  return (
    /\b(504|524|522)\b/.test(t) ||
    t.includes('gateway timeout') ||
    t.includes('gateway time-out') ||
    t.includes('结果确认超时') ||
    t.includes('确认超时') ||
    (t.includes('timeout') && t.includes('gateway'))
  );
}

/**
 * Retry an operation with exponential backoff for retryable errors.
 * 支持 keyManager：遇到可重试错误时先触发 key 轮换，下次重试自动使用新 key。
 */
async function freedomRetry<T>(
  operation: () => Promise<T>,
  label: string,
  keyManager?: { handleError: (status: number, errorText?: string) => boolean } | null,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      if (error instanceof FreedomCancelledError) throw error;
      if ((error as any)?.name === 'AbortError') throw new FreedomCancelledError();
      // 已触达上游 / 已扣费的错误：绝不重试整个操作（重试会重新 submit → 二次扣费）
      if (error instanceof FreedomBilledError) throw error;
      // 轮询阶段的网络中断/终止：任务已提交到上游，重试会重新 submit → 二次扣费。
      // 必须原样抛出，交由 UI 转入「可恢复」状态并复用已持久化的 taskId 重新查询。
      if (error instanceof FreedomNetworkInterruptedError) throw error;
      if (error instanceof FreedomPollTerminatedError) throw error;
      if (!isRetryableError(error)) throw error;

      // 触发 key 轮换（如果有 keyManager）
      const errStatus = (error as any)?.status;
      if (keyManager && typeof errStatus === 'number') {
        const rotated = keyManager.handleError(errStatus);
        if (rotated) {
          console.log(`[Freedom] ${label}: key rotated due to ${errStatus}`);
        }
      }

      if (attempt < RETRY_MAX_ATTEMPTS - 1) {
        const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
        console.warn(
          `[Freedom] ${label} hit retryable error, retrying in ${delay}ms... ` +
          `(Attempt ${attempt + 1}/${RETRY_MAX_ATTEMPTS}): ${lastError.message}`
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ==================== Cancellation ====================

/** 自定义取消错误，便于 UI 区分取消与失败 */
export class FreedomCancelledError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'FreedomCancelledError';
  }
}

/**
 * 「已触达上游 / 已扣费」错误。
 * 用于 Gemini 原生接口：当上游返回 2xx（已计费）但后续解析失败时抛出，
 * 外层 **不得** 回退到 chat/completions（否则会造成第二次扣费）。
 */
export class FreedomBilledError extends Error {
  /** 上游返回的 HTTP 状态码（若有） */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FreedomBilledError';
    this.status = status;
  }
}

/** 抛出取消错误（如果 signal 已 abort） */
function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FreedomCancelledError();
  }
}

/** 等待指定毫秒，期间可被 signal 取消（避免轮询间隔阻塞取消） */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new FreedomCancelledError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new FreedomCancelledError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ==================== 轮询容错（断网 / 网络波动） ====================

/**
 * 「网络中断导致查询链断开」错误。
 * 语义：任务**已提交到上游且很可能已扣费/已完成**，只是本地查询链因网络问题断开。
 * UI 收到该错误应把任务标记为 `interrupted`（可恢复），而不是 `error`（终态），
 * 并保留 serverTaskId / pollUrl 供后续重新查询领取结果。
 */
export class FreedomNetworkInterruptedError extends Error {
  /** 上游任务 ID（若已拿到） */
  taskId?: string;
  /** 查询地址，供恢复时复用 */
  pollUrl?: string;
  constructor(message: string, taskId?: string, pollUrl?: string) {
    super(message);
    this.name = 'FreedomNetworkInterruptedError';
    this.taskId = taskId;
    this.pollUrl = pollUrl;
  }
}

/**
 * 「查询终止」错误：鉴权失败 / 任务不存在等，重试没有意义。
 * 与网络中断区分开，避免把 401/404 也当成可恢复状态无限接续。
 */
export class FreedomPollTerminatedError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'FreedomPollTerminatedError';
    this.status = status;
  }
}

/** 连续网络失败的最大容忍次数（配合指数退避，约覆盖 5 分钟以上的断网窗口） */
const POLL_MAX_NETWORK_FAILURES = 30;
/** 连续 HTTP 非 2xx（可重试类）的最大容忍次数，避免 `!ok → continue` 无限静默循环 */
const POLL_MAX_HTTP_FAILURES = 15;
/** 网络失败后的退避上限 */
const POLL_BACKOFF_MAX = 15000;

/** 轮询过程中的失败计数状态，由每个轮询循环各自持有 */
interface PollFailureState {
  networkFailures: number;
  httpFailures: number;
  taskId?: string;
  pollUrl?: string;
}

function createPollState(taskId?: string, pollUrl?: string): PollFailureState {
  return { networkFailures: 0, httpFailures: 0, taskId, pollUrl };
}

/** 判定是否为「网络层」错误（断网、连接被重置、DNS 失败、代理不可达等） */
function isNetworkError(error: unknown): boolean {
  if (!error) return false;
  const err = error as any;
  const name = String(err.name || '');
  if (name === 'TypeError') return true;
  const message = String(err.message || err || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('econnaborted') ||
    message.includes('enotfound') ||
    message.includes('etimedout') ||
    message.includes('ehostunreach') ||
    message.includes('enetunreach') ||
    message.includes('epipe') ||
    message.includes('socket hang up') ||
    message.includes('net::err_') ||
    message.includes('proxy fetch failed') ||
    message.includes('fetch failed')
  );
}

/** 浏览器/Electron 报告当前离线（保守：拿不到该信息时视为在线） */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * 带容错的单次轮询请求。
 *
 * 返回值语义：
 * - `Response`：本轮请求成功（2xx），调用方正常解析
 * - `null`：本轮失败但可继续（已内部退避等待），调用方应 `continue`
 *
 * 抛出：
 * - `FreedomCancelledError`：用户取消
 * - `FreedomPollTerminatedError`：鉴权/任务不存在等无意义重试的情形
 * - `FreedomNetworkInterruptedError`：连续网络失败超限，任务需转入可恢复状态
 */
async function pollFetchWithRetry(
  url: string,
  init: RequestInit,
  state: PollFailureState,
  signal?: AbortSignal,
): Promise<Response | null> {
  state.pollUrl = state.pollUrl || url;
  try {
    const resp = await corsFetch(url, init);
    if (resp.ok) {
      state.networkFailures = 0;
      state.httpFailures = 0;
      return resp;
    }

    // 鉴权失败 / 任务不存在：重试没有意义，立即终止
    if (resp.status === 401 || resp.status === 403 || resp.status === 404) {
      throw new FreedomPollTerminatedError(
        `查询被拒绝：HTTP ${resp.status}（请检查 API Key 与任务 ID 是否有效）`,
        resp.status,
      );
    }

    state.httpFailures += 1;
    if (state.httpFailures > POLL_MAX_HTTP_FAILURES) {
      throw new FreedomNetworkInterruptedError(
        `查询持续返回 HTTP ${resp.status}，已暂停查询。上游任务可能仍在进行，可稍后重新查询领取结果。`,
        state.taskId,
        state.pollUrl,
      );
    }
    return null;
  } catch (error) {
    // 取消与终止类错误原样抛出
    if (error instanceof FreedomCancelledError) throw error;
    if ((error as any)?.name === 'AbortError') throw new FreedomCancelledError();
    if (error instanceof FreedomPollTerminatedError) throw error;
    if (error instanceof FreedomNetworkInterruptedError) throw error;
    if (!isNetworkError(error)) throw error;

    // 网络类错误：不终止任务，退避后重试。
    // 明确离线时不消耗重试配额——等网络回来即可无感继续。
    const offline = isOffline();
    if (!offline) {
      state.networkFailures += 1;
      if (state.networkFailures > POLL_MAX_NETWORK_FAILURES) {
        throw new FreedomNetworkInterruptedError(
          '网络中断导致查询链断开。上游任务可能已完成，可在任务卡片上「重新查询」领取结果。',
          state.taskId,
          state.pollUrl,
        );
      }
    }

    const delay = offline
      ? POLL_BACKOFF_MAX
      : Math.min(POLL_BACKOFF_MAX, VIDEO_POLL_INTERVAL * Math.pow(2, Math.min(state.networkFailures, 3)));
    console.warn(
      `[Freedom] 轮询请求失败（${offline ? '当前离线' : `连续 ${state.networkFailures} 次`}），` +
      `${delay}ms 后重试：${(error as Error)?.message || error}`,
    );
    await abortableSleep(delay, signal);
    return null;
  }
}

// ==================== Helpers: Endpoint Building ====================

function buildEndpoint(baseUrl: string, path: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return /\/v\d+$/.test(normalized) ? `${normalized}/${path}` : `${normalized}/v1/${path}`;
}

function getRootBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return normalized.replace(/\/v\d+$/, '');
}

function buildVolcVideoSubmitPath(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (/\/contents\/generations\/tasks$/i.test(normalized)) {
    return normalized;
  }
  if (/\/api\/v3$/i.test(normalized)) {
    return `${normalized}/contents/generations/tasks`;
  }
  // 火山方舟原生域名，或本地/自建的方舟兼容服务，应使用 /api/v3/contents/generations/tasks。
  if (/\.volces\.com|ark\.cn-beijing|localhost|127\.0\.0\.1|^https?:\/\/(?:10|172\.(?:1[6-9]|2\d|3[0-1])|192\.168)\./i.test(normalized)) {
    return `${normalized}/api/v3/contents/generations/tasks`;
  }
  // MemeFast 等中转使用 /volc/v1/contents/generations/tasks。
  return `${getRootBaseUrl(normalized)}/volc/v1/contents/generations/tasks`;
}

async function readJsonResponse<T = any>(response: Response, label: string): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 160).replace(/\s+/g, ' ').trim();
    throw new Error(`${label} 返回的不是 JSON，可能请求到了错误地址或被网页服务接管：${preview || '空响应'}`);
  }
}

function pickFeatureConfig(feature: AIFeature, requestedModel?: string): FeatureConfig | null {
  const all = getAllFeatureConfigs(feature);
  if (all.length === 0) return null;
  if (requestedModel) {
    const exact = all.find((c) => c.model === requestedModel);
    if (exact) return exact;
    // UI 展开的变体模型（如 gemini-3.1-pro 从绑定的 gemini-3-pro 展开而来）不会
    // 精确匹配到任何 config.model，此时回退到轮询配置而非返回 null，
    // 避免用户选了可用变体却报"未配置"错误
  }
  return getFeatureConfig(feature) ?? all[0];
}

function resolveFreedomFeatureConfig(
  feature: 'freedom_image' | 'freedom_video',
  fallback: 'character_generation' | 'video_generation',
  requestedModel?: string,
): { config: FeatureConfig | null; source: string } {
  const primary = pickFeatureConfig(feature, requestedModel);
  if (primary) return { config: primary, source: feature };

  const fb = pickFeatureConfig(fallback, requestedModel);
  if (fb) return { config: fb, source: `${fallback} (fallback)` };

  return { config: null, source: feature };
}

export type FreedomImageRoute = 'midjourney' | 'ideogram' | 'kling_image' | 'gemini_native' | 'openai_chat' | 'openai_images' | 'replicate';
function detectFreedomImageRoute(model: string, endpointTypes?: string[]): FreedomImageRoute {
  const lower = model.toLowerCase();
  const hasEndpoint = (re: RegExp) => (endpointTypes || []).some((t) => re.test(t));
  const hasExactEndpoint = (name: string) => (endpointTypes || []).includes(name);

  if (/^mj_/i.test(model) || /midjourney/i.test(model) || /^niji-/i.test(model) || hasEndpoint(/midjourney/i)) {
    return 'midjourney';
  }
  if (/^ideogram_/i.test(model)) {
    return 'ideogram';
  }
  // Kling image: 模型名检测 + 端点元数据检测
  if (/^kling-(image|omni-image)/i.test(model) || hasExactEndpoint('kling生图') || hasExactEndpoint('omni-image') || hasExactEndpoint('文生图')) {
    return 'kling_image';
  }

  // Replicate: endpoint type uses '{org}/{model}异步' pattern (contains '/' before '异步')
  if ((endpointTypes || []).some(t => t.includes('/') && t.endsWith('异步'))) {
    return 'replicate';
  }

  // Gemini Nano Banana 系列：使用 Gemini 原生 REST API（非 OpenAI 兼容）
  // 这样才能正确传递 imageConfig.aspectRatio / image_size
  if (lower.includes('gemini') && (lower.includes('image') || lower.includes('imagen'))) {
    return 'gemini_native';
  }

  const baseRoute = resolveImageApiFormat(endpointTypes, model);
  return baseRoute === 'openai_chat' ? 'openai_chat' : 'openai_images';
}

type FreedomVideoRoute = 'openai_official' | 'unified' | 'volc' | 'wan' | 'kling' | 'replicate';

const FREEDOM_VIDEO_ROUTE_MAP: Record<string, FreedomVideoRoute> = {
  'openAI官方视频格式': 'openai_official',
  'openAI视频格式': 'openai_official',
  '豆包视频异步': 'volc',  // doubao-seedance uses /volc/v1/contents/generations/tasks
  '异步': 'wan',
  '文生视频': 'kling',
  '图生视频': 'kling',
  '视频延长': 'kling',
  'omni-video': 'kling',
  '动作控制': 'kling',
  '多模态视频编辑': 'kling',
  '数字人': 'kling',
  '对口型': 'kling',
  '视频特效': 'kling',
  'openai': 'unified', // 某些自定义供应商把视频模型标为通用 openai
  '视频统一格式': 'unified',
  'grok视频': 'unified',
  'openai-response': 'unified',
  '海螺视频生成': 'unified',
  'luma视频生成': 'unified',
  'luma视频扩展': 'unified',
  'runway图生视频': 'unified',
  'aigc-video': 'unified',
  'wan视频生成': 'unified',  // wan2.6 models use memefast /v1/video/generations
  // Vidu endpoint types (all route to unified /v1/video/generations)
  'vidu文生视频': 'unified',
  'vidu图生视频': 'unified',
  'vidu参考生视频': 'unified',
  'vidu首尾帧': 'unified',
  'luma视频延长': 'unified',  // luma extend uses 延长 (file 04 naming)
};

/**
 * 统一格式端点路径映射（端点类型 → 提交/轮询 URL 路径）
 * 每种端点类型直接对应确定的 URL，不再靠 fallback 猜测
 */
const UNIFIED_ENDPOINT_PATHS: Record<string, { submit: string; poll: (id: string) => string }> = {
  // 路径均为域名根起的绝对路径（不依赖 /v1/ 前缀拼接）
  'grok视频':     { submit: '/v1/video/create',      poll: (id) => `/v1/video/query?id=${id}` },
  '视频统一格式': { submit: '/v1/video/create',      poll: (id) => `/v1/video/query?id=${id}` },
  '海螺视频生成': { submit: '/minimax/v1/video_generation', poll: (id) => `/minimax/v1/query/video_generation?task_id=${id}` },
  'luma视频生成': { submit: '/luma/generations',            poll: (id) => `/luma/generations/${id}` },
  'luma视频扩展': { submit: '/luma/generations',            poll: (id) => `/luma/generations/${id}` },
  'luma视频延长': { submit: '/luma/generations',            poll: (id) => `/luma/generations/${id}` },
  'runway图生视频': { submit: '/runwayml/v1/image_to_video', poll: (id) => `/runwayml/v1/tasks/${id}` },
  'wan视频生成':    { submit: '/alibailian/api/v1/services/aigc/video-generation/video-synthesis', poll: (id) => `/alibailian/api/v1/tasks/${id}` },
  'aigc-video':    { submit: '/tencent-vod/v1/aigc-video', poll: (id) => `/tencent-vod/v1/aigc-video/${id}` },
  // Vidu 企业版端点 (/ent/v2/)
  'vidu文生视频':   { submit: '/ent/v2/text2video',       poll: (id) => `/ent/v2/task?task_id=${id}` },
  'vidu图生视频':   { submit: '/ent/v2/img2video',        poll: (id) => `/ent/v2/task?task_id=${id}` },
  'vidu参考生视频': { submit: '/ent/v2/reference2video',  poll: (id) => `/ent/v2/task?task_id=${id}` },
  'vidu首尾帧':     { submit: '/ent/v2/start-end2video',  poll: (id) => `/ent/v2/task?task_id=${id}` },
};
const DEFAULT_UNIFIED_ENDPOINT = { submit: '/v1/video/generations', poll: (id: string) => `/v1/video/generations/${id}` };

/**
 * 图片端点路径映射（端点类型 → 提交/轮询 URL 路径）
 * 仅用于需要自定义路径的端点类型，其余走默认 /v1/images/generations
 */
const IMAGE_ENDPOINT_PATHS: Record<string, { submit: string; poll: (id: string) => string }> = {
  'aigc-image': { submit: '/tencent-vod/v1/aigc-image', poll: (id) => `/tencent-vod/v1/aigc-image/${id}` },
  'vidu生图':   { submit: '/ent/v2/reference2image',    poll: (id) => `/ent/v2/task?task_id=${id}` },
};
const DEFAULT_IMAGE_ENDPOINT = { submit: '/v1/images/generations', poll: (id: string) => `/v1/images/generations/${id}` };

function getImageEndpointPaths(endpointTypes: string[]): { submit: string; poll: (id: string) => string } {
  for (const t of endpointTypes) {
    if (IMAGE_ENDPOINT_PATHS[t]) return IMAGE_ENDPOINT_PATHS[t];
  }
  return DEFAULT_IMAGE_ENDPOINT;
}

function getUnifiedEndpointPaths(endpointTypes: string[]): { submit: string; poll: (id: string) => string } {
  for (const t of endpointTypes) {
    if (UNIFIED_ENDPOINT_PATHS[t]) return UNIFIED_ENDPOINT_PATHS[t];
  }
  return DEFAULT_UNIFIED_ENDPOINT;
}

function detectFreedomVideoRoute(model: string, endpointTypes?: string[]): FreedomVideoRoute {
  const m = model.toLowerCase();

  // Seedance/Doubao 必须优先按模型名走火山/方舟任务接口。
  // 这类模型如果被未验证 key 同步出的 endpointTypes 污染成“视频统一格式”，
  // 会误走 /v1/video/generations 并返回 404。缓存文件清理后恢复正常，
  // 说明这里不能让全局 endpointTypes 覆盖 Seedance 的确定路由。
  if (m.includes('seedance') || m.includes('doubao')) return 'volc';

  if (endpointTypes && endpointTypes.length > 0) {
    // 优先级：官方 Sora -> Kling -> Volc -> Wan -> Replicate -> Unified
    for (const t of endpointTypes) {
      if (FREEDOM_VIDEO_ROUTE_MAP[t] === 'openai_official') return 'openai_official';
    }
    for (const t of endpointTypes) {
      if (FREEDOM_VIDEO_ROUTE_MAP[t] === 'kling') return 'kling';
    }
    for (const t of endpointTypes) {
      if (FREEDOM_VIDEO_ROUTE_MAP[t] === 'volc') return 'volc';
    }
    for (const t of endpointTypes) {
      if (FREEDOM_VIDEO_ROUTE_MAP[t] === 'wan') return 'wan';
    }
    // Replicate: endpoint type uses '{org}/{model}异步' pattern (contains '/' before '异步')
    if (endpointTypes.some(t => t.includes('/') && t.endsWith('异步'))) return 'replicate';
    for (const t of endpointTypes) {
      if (FREEDOM_VIDEO_ROUTE_MAP[t] === 'unified') return 'unified';
    }
  }

  if (m.includes('sora-2')) return 'openai_official';
  if (m.includes('kling')) return 'kling';
  if (m.includes('wan') || m.includes('happyhorse')) return 'wan';
  return 'unified';
}

// ==================== Image Generation ====================

/**
 * 判断模型是否为 Gemini 图片生成模型（Nano Banana 系列）
 * - gemini-3-pro-image-preview        → 支持 1K/2K/4K
 * - gemini-3.1-flash-image-preview    → 支持 512/1K/2K/4K
 * - gemini-2.5-flash-image            → 固定 1K（不支持 image_size）
 */
function isGeminiImageModel(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('gemini') && (m.includes('image') || m.includes('imagen'));
}

/** gemini-2.5-flash-image 不支持 image_size；3.x 系列支持 */
function geminiSupportsImageSize(model: string): boolean {
  const m = model.toLowerCase();
  return m.includes('gemini-3') && m.includes('image');
}

/**
 * Gemini 官方 image_size 参数：仅接受 '1K' | '2K' | '4K'（大写），
 * gemini-3.1-flash-image-preview 还支持 '512'。
 */
function normalizeGeminiImageSize(resolution?: string): string {
  if (!resolution) return '2K';
  const upper = resolution.toUpperCase();
  // 上游（12ai NanoBanana）严格大小写：512 档需写成 '512px'，其余为 '1K'/'2K'/'4K'。
  if (upper === '512' || upper === '512PX') return '512px';
  if (['1K', '2K', '4K'].includes(upper)) return upper;
  return '2K';
}

/**
 * GPT-IMG / GPT Image 系列 size 白名单。
 * gpt-image-2 这类接口不接受 '2k' / '4k' 档位，也不接受任意 WxH；
 * 需要下发固定像素字符串：
 * 1024x1024 / 1536x1024 / 1024x1536 / 2048x2048 / 2048x1152 / 3840x2160 / 2160x3840 / auto。
 */
function normalizeGptImageSize(aspectRatio?: string, resolution?: string): string {
  const r = (resolution || '').trim().toLowerCase();
  const ar = (aspectRatio || '').trim().toLowerCase();
  if (r === 'auto' || ar === 'auto') return 'auto';

  const match = aspectRatio?.match(/^(\d+)\s*[:xX]\s*(\d+)$/);
  const arW = match ? parseInt(match[1], 10) : 1;
  const arH = match ? parseInt(match[2], 10) : 1;
  const orientation: 'square' | 'landscape' | 'portrait' = arW === arH
    ? 'square'
    : arW > arH
      ? 'landscape'
      : 'portrait';

  if (r === '4k' || r === '2160p' || r === '4096' || r === '3840') {
    if (orientation === 'portrait') return '2160x3840';
    if (orientation === 'landscape') return '3840x2160';
    // 接口未列出 4K 正方形，使用支持的最高正方形尺寸。
    return '2048x2048';
  }

  if (r === '2k' || r === 'qhd' || r === '2048' || r === '2560') {
    if (orientation === 'landscape') return '2048x1152';
    if (orientation === 'portrait') return '1024x1536';
    return '2048x2048';
  }

  if (orientation === 'landscape') return '1536x1024';
  if (orientation === 'portrait') return '1024x1536';
  return '1024x1024';
}

function isGptImageModelId(model: string): boolean {
  return /^gpt[-_]?image/i.test(model) || /^gpt[-_]?img/i.test(model);
}

/**
 * 将"宽高比 + 分辨率档位"换算成像素尺寸。
 * resolution 支持: '1K' | '2K' | '4K' | 'HD' | 'FHD' | '720p' | '1080p' | '2160p' | '512' | '1024' | '2048'
 * 返回 { width, height, size: 'WxH' }。无法解析时返回 null。
 */
function aspectRatioToSize(
  aspectRatio?: string,
  resolution?: string,
): { width: number; height: number; size: string } | null {
  if (!aspectRatio) return null;
  const m = aspectRatio.match(/^(\d+)\s*[:xX]\s*(\d+)$/);
  if (!m) return null;
  const arW = parseInt(m[1], 10);
  const arH = parseInt(m[2], 10);
  if (!arW || !arH) return null;

  // 长边像素映射（短边按 ratio 推导，向偶数 8 对齐）
  const longSide = ((): number => {
    const r = (resolution || '').toLowerCase();
    if (!r) return 1024;
    if (r === '4k' || r === '2160p') return 3840;
    if (r === '2k' || r === 'qhd') return 2560;
    if (r === 'fhd' || r === '1080p' || r === 'hd+') return 1920;
    if (r === 'hd' || r === '720p') return 1280;
    const n = parseInt(r, 10);
    if (!Number.isNaN(n) && n > 0) return n;
    return 1024;
  })();

  const ratio = arW / arH;
  let width: number;
  let height: number;
  if (ratio >= 1) {
    width = longSide;
    height = Math.round(longSide / ratio);
  } else {
    height = longSide;
    width = Math.round(longSide * ratio);
  }
  // 对齐到 8 像素（多数模型要求）
  width = Math.max(64, Math.round(width / 8) * 8);
  height = Math.max(64, Math.round(height / 8) * 8);

  return { width, height, size: `${width}x${height}` };
}

/**
 * 生成「宽高比强约束」的 prompt 兜底文本。
 *
 * 背景：Gemini 原生 generateContent 用 generationConfig.imageConfig.aspectRatio 控制比例，
 * 但很多中转站/代理并不透传该结构化字段——此时 Gemini 官方默认行为会触发：
 *   「有参考图 → 匹配参考图尺寸；无参考图 → 回落 1:1」
 * 导致用户选 16:9 却拿到 9:16（匹配了竖版参考图）或方图。
 * 因此在 prompt 里再用自然语言强调一次比例，作为结构化参数被丢弃时的兜底引导。
 *
 * 特别地：当存在参考图时，额外明确「只参考内容/风格，不要沿用其画幅比例」，
 * 避免模型把参考图的竖版比例带到输出上。
 */
function buildAspectRatioHint(
  aspectRatio: string | undefined,
  hasReferenceImages: boolean,
  sized?: { width: number; height: number } | null,
): string {
  const ar = (aspectRatio || '').trim();
  if (!ar || ar.toLowerCase() === 'auto') return '';

  const m = ar.match(/^(\d+)\s*[:xX]\s*(\d+)$/);
  const orientation = m
    ? (parseInt(m[1], 10) > parseInt(m[2], 10)
        ? 'landscape (wider than tall)'
        : parseInt(m[1], 10) < parseInt(m[2], 10)
          ? 'portrait (taller than wide)'
          : 'square')
    : '';

  let hint = `IMPORTANT — OUTPUT CANVAS ASPECT RATIO: The generated image MUST be exactly ${ar}`;
  if (orientation) hint += ` (${orientation})`;
  if (sized) hint += `, sized ${sized.width}×${sized.height} pixels`;
  hint += '.';
  if (hasReferenceImages) {
    // 参考图场景是「输出沿用参考图画幅」的重灾区，用最强措辞明确：
    // 参考图仅供内容/风格，输出画布比例必须以上面指定的 aspectRatio 为准。
    hint += ` The reference image(s) may have a DIFFERENT aspect ratio — IGNORE their dimensions and canvas shape completely. `
      + `Do NOT match, crop to, or letterbox the reference image size. `
      + `The final output canvas MUST be ${ar}${orientation ? ` (${orientation})` : ''}, regardless of the reference image proportions.`;
  }
  return hint;
}

export async function generateFreedomImage(
  params: FreedomImageParams
): Promise<GenerationResult> {
  const { config } = resolveFreedomFeatureConfig('freedom_image', 'character_generation', params.model);
  return freedomRetry(() => _generateFreedomImageInner(params), 'Image generation', config?.keyManager);
}

async function _generateFreedomImageInner(
  params: FreedomImageParams
): Promise<GenerationResult> {
  const { config, source: configSource } = resolveFreedomFeatureConfig(
    'freedom_image',
    'character_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('character_generation');
    toast.error('自由板块图片生成未配置：请在设置中配置「自由板块-图片」或「图片生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Image config source: ${configSource}`);

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;
  const normalizedBase = baseUrl.replace(/\/+$/, '');

  // ── Smart Routing: choose endpoint based on model metadata ──
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomImageRoute(model, endpointTypes);
  const isGptImageModel = isGptImageModelId(model);

  console.log('[Freedom] Generating image:', {
    model,
    route,
    isGptImageModel,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });

  if (route === 'midjourney') {
    return await generateViaMidjourneyEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'ideogram') {
    return await generateViaIdeogramEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'openai_chat') {
    return await generateViaChatCompletions(params, model, apiKey, normalizedBase);
  }
  if (route === 'kling_image') {
    return await generateViaKlingImagesEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'replicate') {
    return await generateViaReplicateImageEndpoint(params, model, apiKey, normalizedBase);
  }
  if (route === 'gemini_native') {
    try {
      return await generateViaGeminiNative(params, model, apiKey, normalizedBase);
    } catch (err: any) {
      if (err instanceof FreedomCancelledError) throw err;
      // 已触达上游 / 已扣费：绝不回退到 chat/completions（否则二次扣费）
      if (err instanceof FreedomBilledError) throw err;
      // 仅当原生 /v1beta 端点「不存在 / 不支持」或「根本没触达上游」时才回退：
      //   - status 缺失：网络/CORS 层错误，请求未被上游受理（未扣费）
      //   - 404 / 405 / 501：中转站不提供 /v1beta 路径（未扣费）
      const status: number | undefined = typeof err?.status === 'number' ? err.status : undefined;
      const canFallback = status === undefined || status === 404 || status === 405 || status === 501;
      if (!canFallback) {
        // 4xx/5xx 等业务错误（如 400/401/402/429/500）：上游已受理请求，可能已扣费，
        // 不回退，直接抛出，避免对同一次生成产生两次计费。
        console.warn('[Freedom] Gemini native failed with billable status, NOT falling back:', status, err?.message);
        throw err;
      }
      console.warn('[Freedom] Gemini native endpoint unavailable, falling back to chat completions:', status ?? '(no status)', err?.message);
      return await generateViaChatCompletions(params, model, apiKey, normalizedBase);
    }
  }

  // 注意：GPT Image + 参考图不再改道 chat/completions。
  // images/generations 端点本身支持多模态编辑（body.image 传参考图），
  // 且 size 白名单在该端点生效；改道 chat 会导致 size 被中转站丢弃
  // （自动回落 auto/沿用参考图画幅），并因中转站通常只给 gpt-image 注册
  // images 通道而出现「无可用渠道」的间歇性连接失败。
  return await generateViaImagesEndpoint(params, model, apiKey, normalizedBase, endpointTypes);
}

/**
 * 把参考图（http(s)/dataURL）转换为 Gemini inlineData：{ mimeType, data: base64 }
 */
async function urlToGeminiInlineData(
  src: string,
): Promise<{ mimeType: string; data: string } | null> {
  try {
    if (src.startsWith('data:')) {
      const m = src.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return null;
      return { mimeType: m[1], data: m[2] };
    }
    const resp = await corsFetch(src);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    const data = btoa(binary);
    return { mimeType: blob.type || 'image/png', data };
  } catch (e) {
    console.warn('[Freedom] Failed to fetch reference image:', e);
    return null;
  }
}

/**
 * 从 Gemini generateContent 响应中提取图片
 * 返回 dataURL（inlineData）或 http(s) URL
 */
/**
 * 从字符串里尽力抓图（markdown 图片、裸 http(s) URL、data:base64、无前缀 base64）。
 * 模块级共享，供 Gemini 原生与 chat/completions 两条提取路径复用。
 */
function imageFromText(text: unknown): string | null {
  if (typeof text !== 'string' || !text) return null;
  // markdown 图片: ![alt](url)
  const mdMatch = text.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i);
  if (mdMatch) return mdMatch[1];
  // data:image;base64
  const dataUrlMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/);
  if (dataUrlMatch) return dataUrlMatch[0].replace(/\s+/g, '');
  // 裸 http(s) 图片链接（含常见图片后缀或图床/oss 域名）
  const urlMatch = text.match(/https?:\/\/[^\s"')\]]+/i);
  if (urlMatch) {
    const u = urlMatch[0];
    if (/\.(png|jpe?g|webp|gif|bmp|avif)(\?|$)/i.test(u) || /(image|img|oss|cdn|cos|obs|aliyun|bce|s3|storage|file|media)/i.test(u)) {
      return u;
    }
    // 兜底：内容里只有一个 URL 时也认为它就是图片
    if (text.trim() === u) return u;
  }
  // 无前缀的超长 base64（>256 视为图片数据）
  const rawB64 = text.match(/[A-Za-z0-9+/]{256,}={0,2}/);
  if (rawB64) return `data:image/png;base64,${rawB64[0]}`;
  return null;
}

/**
 * 在任意 part / 对象里找图片字段（含 Gemini 原生 inlineData/fileData 与各类中转站字段）。
 * 模块级共享，供 Gemini 原生与 chat/completions 两条提取路径复用。
 */
function imageFromPart(part: any): string | null {
  if (!part || typeof part !== 'object') return null;
  if (part.image_url?.url) return part.image_url.url;
  if (typeof part.image_url === 'string') return part.image_url;
  if (part.image?.url) return part.image.url;
  if (typeof part.image === 'string' && part.image) {
    return /^https?:\/\//i.test(part.image) || part.image.startsWith('data:')
      ? part.image
      : `data:image/png;base64,${part.image}`;
  }
  if (part.url && /^https?:\/\//i.test(part.url)) return part.url;
  if (part.b64_json) return `data:image/png;base64,${part.b64_json}`;
  // Gemini 原生结构 camelCase
  if (part.inlineData?.data) {
    return `data:${part.inlineData.mimeType || 'image/png'};base64,${part.inlineData.data}`;
  }
  // snake_case 兜底
  if (part.inline_data?.data) {
    return `data:${part.inline_data.mime_type || part.inline_data.mimeType || 'image/png'};base64,${part.inline_data.data}`;
  }
  // 文件 URI（Gemini fileData）
  if (part.fileData?.fileUri) return part.fileData.fileUri;
  if (part.file_data?.file_uri) return part.file_data.file_uri;
  if (part.data && typeof part.data === 'string' && (part.type === 'image' || part.type === 'image_url')) {
    return part.data.startsWith('data:') ? part.data : `data:image/png;base64,${part.data}`;
  }
  return null;
}

/**
 * 从 Gemini 原生 generateContent 响应中提取图片。
 *
 * 注意：gemini-3.1-flash-image 等模型经不同中转站返回时，图片可能出现在：
 *   - candidates[i].content.parts[].inlineData / fileData（官方标准）
 *   - parts[].text 里的 markdown 图 / 裸 URL / base64（中转站常见）
 *   - 非首个 candidate（candidates[1..]）
 *   - parts[].image_url / b64_json 等被归一化的字段
 *   - 顶层 images / data / output / artifacts 数组（中转站归一化）
 * 因此这里遍历「全部 candidates 的全部 parts」并复用共享提取器，最后兜底扫顶层数组，
 * 避免上游已生成（已扣费）却因结构差异被误判为「未能提取图片」。
 */
function extractGeminiImage(data: any): string | null {
  const candidates = data?.candidates;
  if (Array.isArray(candidates)) {
    for (const candidate of candidates) {
      const parts = candidate?.content?.parts ?? candidate?.content?.[0]?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const hit = imageFromPart(part) || imageFromText(part?.text);
          if (hit) return hit;
        }
      }
    }
  }

  // 兜底：顶层 images / data / output / artifacts 数组（部分中转站归一化到此）
  for (const arrKey of ['images', 'data', 'output', 'artifacts'] as const) {
    const arr = (data as any)?.[arrKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const hit = imageFromPart(item) || (typeof item === 'string' ? imageFromText(item) : null);
        if (hit) return hit;
      }
    }
  }

  return null;
}

const GEMINI_SAFETY_FINISH_REASONS = new Set([
  'SAFETY',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'RECITATION',
]);

/**
 * 从「HTTP 200 但 body 实际携带错误/安全拦截信息」的 Gemini 响应中提取真实原因。
 * 很多中转站会把上游的 403/4xx 错误包在 200 响应体里返回，
 * 或者 Gemini 官方在触发安全策略时仍返回 200 但 candidates 为空/finishReason=SAFETY。
 * 命中时返回可读的错误信息；未命中返回 null（表示不是错误，继续走正常提取逻辑）。
 */
function extractGeminiErrorReason(data: any): string | null {
  // Case 1: 顶层显式 error 对象（部分中转站用 200 状态码包裹上游错误）
  const topError = data?.error;
  if (topError && (topError.message || topError.status || topError.code)) {
    const parts = [topError.message, topError.status ? `status=${topError.status}` : null, topError.code ? `code=${topError.code}` : null]
      .filter(Boolean);
    return parts.join(' ') || 'Gemini 返回了错误响应';
  }

  // Case 2: promptFeedback.blockReason（请求整体被安全策略拦截，通常没有 candidates）
  const blockReason = data?.promptFeedback?.blockReason || data?.prompt_feedback?.block_reason;
  if (blockReason) {
    const msg = data?.promptFeedback?.blockReasonMessage || data?.prompt_feedback?.block_reason_message;
    return `请求被安全策略拦截: ${blockReason}${msg ? ` (${msg})` : ''}`;
  }

  // Case 3: candidates 存在但因安全原因未产出内容
  const candidate = data?.candidates?.[0];
  const finishReason = candidate?.finishReason || candidate?.finish_reason;
  if (finishReason && GEMINI_SAFETY_FINISH_REASONS.has(String(finishReason).toUpperCase())) {
    const ratings = candidate?.safetyRatings || candidate?.safety_ratings;
    const ratingMsg = Array.isArray(ratings) && ratings.length > 0
      ? ` (${ratings.map((r: any) => `${r.category}:${r.probability}`).join(', ')})`
      : '';
    return `生成的图片被判定为不安全内容 (finishReason=${finishReason})${ratingMsg}`;
  }

  return null;
}

/**
 * Generate image via Gemini native REST API
 *   POST {base}/v1beta/models/{model}:generateContent
 *
 * 严格遵循官方 SDK 请求体结构：
 *   { contents: [{ parts: [{ text }, { inlineData }] }],
 *     generationConfig: { responseModalities: ['IMAGE'],
 *                         imageConfig: { aspectRatio, imageSize } } }
 */
async function generateViaGeminiNative(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const aspectRatio = params.aspectRatio || '1:1';
  const supportsImageSize = geminiSupportsImageSize(model);
  const imageSize = supportsImageSize ? normalizeGeminiImageSize(params.resolution) : undefined;

  const hasReferenceImages = !!(params.referenceImages && params.referenceImages.length > 0);
  // Prompt 级宽高比兜底：中转站若忽略 imageConfig.aspectRatio，则靠这段自然语言约束。
  // 尤其是有参考图时，Gemini 默认会「匹配参考图尺寸」，导致目标比例被参考图的画幅覆盖。
  // 附带目标像素尺寸（sized），让「多参考图沿用多数派画幅」的场景有明确数字锚点。
  const sized = aspectRatioToSize(aspectRatio, params.resolution);
  const aspectHint = buildAspectRatioHint(aspectRatio, hasReferenceImages, sized);

  // 构造 parts：参考图在前，文本指令在后（对齐官方多图示例 [Image, Image, "指令"]）。
  // Gemini 对「最后出现的指令」注意力更高——把比例约束放在参考图之后，
  // 可显著降低「输出沿用参考图画幅（如竖版 9:16）」的概率。
  const parts: any[] = [];
  if (params.referenceImages && params.referenceImages.length > 0) {
    params.onProgress?.({ phase: 'submitting', percent: 5, message: '编码参考图…' });
    // 文档：flash/pro 系列最多支持 14 张参考图
    for (const refUrl of params.referenceImages.slice(0, 14)) {
      throwIfAborted(params.signal);
      const inline = await urlToGeminiInlineData(refUrl);
      if (inline) parts.push({ inlineData: inline });
    }
  }
  const promptWithHint = aspectHint ? `${params.prompt}\n\n${aspectHint}` : params.prompt;
  parts.push({ text: promptWithHint });

  // 严格对齐上游（12ai NanoBanana）Gemini 原生格式：仅下发标准 camelCase 字段。
  // 注意：上游严格校验 imageConfig，塞入非标准 snake_case（aspect_ratio/image_size）
  // 反而可能触发字段校验拒绝、令整个 imageConfig 失效，导致 aspectRatio 不生效。
  const imageConfig: Record<string, any> = { aspectRatio };
  if (imageSize) imageConfig.imageSize = imageSize;

  // contents 不带 role：与上游文档示例一致（`contents: [{ parts: [...] }]`）。
  const requestBody: Record<string, any> = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig,
    },
  };

  // Gemini 原生路径：{base}/v1beta/models/{model}:generateContent
  // 中转站普遍兼容此路径（与 Google AI Studio 一致）
  const endpoint = `${rootBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  console.log('[Freedom] Submitting via Gemini native:', {
    model,
    endpoint,
    aspectRatio,
    imageSize: imageSize ?? '(n/a)',
    refCount: params.referenceImages?.length ?? 0,
    aspectHintApplied: !!aspectHint,
  });
  params.onProgress?.({ phase: 'submitting', percent: 15, message: '提交 Gemini 请求…' });
  throwIfAborted(params.signal);

  // 同时支持两种鉴权方式：x-goog-api-key（官方）与 Bearer（多数中转站）
  const response = await corsFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(requestBody),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // 504(网关超时)/524(Cloudflare 边缘超时)：上游同步生成接口耗时超过网关等待窗口。
    // gemini-3-pro-image 等高质量模型在 2K/4K 下生成较慢，中转站到 Google 的连接常触发
    // 网关超时——此时「上游其实已在生成甚至已完成（已扣费）」，只是结果未能在超时前送达。
    // 绝不能自动重试整个操作（会重新提交、二次扣费，且大概率同样超时），
    // 因此抛 FreedomBilledError 让外层直接终止，并给出可操作的中文指引。
    if (isGatewayTimeout(response.status, errorText)) {
      console.warn('[Freedom] Gemini native gateway timeout:', response.status, errorText.slice(0, 300));
      throw new FreedomBilledError(
        `生图请求网关超时（HTTP ${response.status}）。所选模型（如 gemini-3-pro-image）生成较慢，` +
        `上游可能已完成生成（并已计费）但结果未能在超时前返回。建议：` +
        `①降低分辨率（如从 4K/2K 改为 1K）以缩短生成时间；②稍后重试；` +
        `③若上游已扣费成功，可在「调试面板→任务查询」用任务 ID 找回结果，避免重复生成。`,
        response.status,
      );
    }
    let msg = `Gemini native API 错误: ${response.status}`;
    try { const j = JSON.parse(errorText); msg = j.error?.message || msg; } catch {}
    throw toHttpError(msg, response.status, errorText);
  }

  params.onProgress?.({ phase: 'finalizing', percent: 90, message: '解析结果…' });
  const data = await response.json();

  // 关键：很多中转站会把上游 4xx（尤其 403 内容安全拦截）包在 HTTP 200 响应体里返回，
  // 或 Gemini 官方触发安全策略时返回 200 但无图片。先检测真实错误原因并透传给用户，
  // 避免误报为「未能从 Gemini 响应中提取图片」。
  const errorReason = extractGeminiErrorReason(data);
  if (errorReason) {
    console.warn('[Freedom] Gemini native returned error/safety reason in body:', errorReason);
    // 内容安全 / 上游错误：不回退到 chat/completions（重试或换端点通常同样被拦截）。
    // 用 FreedomBilledError 让外层直接终止而不重试，并把真实原因透传给用户。
    throw new FreedomBilledError(`Gemini 生图失败: ${errorReason}`, response.status);
  }

  const imageUrl = extractGeminiImage(data);
  if (!imageUrl) {
    // 提取失败：打印真实响应结构（长字符串截断），便于定位新的返回格式——
    // 这是「上游已扣费却提取不到图」的关键排查信息。
    try {
      const preview = JSON.stringify(data, (_k, v) =>
        typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…(len=${v.length})` : v,
      );
      console.error('[Freedom] 未能从 Gemini 响应中提取图片，原始响应结构:', preview?.slice(0, 4000));
    } catch {
      console.error('[Freedom] 未能从 Gemini 响应中提取图片，且响应无法序列化');
    }
    // 上游已返回 2xx（已扣费），仅是解析未拿到图片；标记为「已扣费」错误，
    // 外层禁止回退到 chat/completions，避免二次扣费。
    throw new FreedomBilledError('未能从 Gemini 响应中提取图片（上游已返回结果，请检查该模型是否为图片生成模型或稍后重试）', response.status);
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
  params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
  return { url: imageUrl, mediaId };
}

/**
 * Generate image via /v1/chat/completions (for Gemini, GPT-image, etc.)
 */
async function generateViaChatCompletions(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'chat/completions');
  const aspectRatio = params.aspectRatio || '1:1';
  const sized = aspectRatioToSize(aspectRatio, params.resolution);

  const isGemini = isGeminiImageModel(model);
  const isGptImage = isGptImageModelId(model);
  const geminiHasImageSize = isGemini && geminiSupportsImageSize(model);
  const geminiImageSize = geminiHasImageSize ? normalizeGeminiImageSize(params.resolution) : undefined;
  const gptImageSize = isGptImage ? normalizeGptImageSize(aspectRatio, params.resolution) : undefined;

  // Prompt 文本里强调宽高比和精确像素，作为参数被丢弃时的兜底引导。
  // 统一复用 buildAspectRatioHint，附带「参考图不要沿用画幅比例」的约束。
  const hasReferenceImages = !!(params.referenceImages && params.referenceImages.length > 0);
  const dimsHint = buildAspectRatioHint(aspectRatio, hasReferenceImages, sized);

  const userContent: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: dimsHint ? `${params.prompt}\n\n${dimsHint}` : params.prompt },
  ];

  // 参考图作为多模态 image_url 注入（chat completions 通用格式）
  if (params.referenceImages && params.referenceImages.length > 0) {
    for (const url of params.referenceImages.slice(0, 10)) {
      userContent.push({ type: 'image_url', image_url: { url } });
    }
  }

  const requestBody: Record<string, any> = {
    model,
    messages: [{ role: 'user', content: userContent }],
    max_tokens: 4096,
    stream: false,
  };

  if (isGemini) {
    // ── Gemini Nano Banana 中转站规范 ──
    // 接口仅识别顶层 camelCase: aspectRatio / imageSize
    // 不要再下发 size/width/height/aspect_ratio 等，否则中转站可能优先命中
    // 这些字段并把 aspectRatio 丢弃，导致输出回落到默认 1:1。
    requestBody.aspectRatio = aspectRatio;
    if (geminiImageSize) {
      requestBody.imageSize = geminiImageSize;
    }
  } else if (isGptImage) {
    // GPT-IMG 系列：size 必须是接口白名单里的像素字符串。
    requestBody.size = gptImageSize;
    // 部分中转站 chat 通道不识别 size，附带 aspect_ratio 作为兜底，
    // 避免 size 被丢弃后自动回落 auto / 沿用参考图画幅。
    if (aspectRatio && aspectRatio !== 'auto') {
      requestBody.aspect_ratio = aspectRatio;
    }
  } else {
    // 非 Gemini：附带 size / aspect_ratio / 宽高，兼容各家代理
    if (sized) {
      requestBody.size = sized.size;
      requestBody.width = sized.width;
      requestBody.height = sized.height;
    }
    requestBody.aspect_ratio = aspectRatio;
  }

  console.log('[Freedom] Submitting via chat completions:', {
    model,
    endpoint,
    isGemini,
    isGptImage,
    aspectRatio,
    imageSize: geminiImageSize ?? gptImageSize ?? '(n/a)',
    bodyKeys: Object.keys(requestBody),
  });
  params.onProgress?.({ phase: 'submitting', percent: 10, message: '提交请求…' });
  throwIfAborted(params.signal);

  const response = await corsFetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal: params.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    // 网关超时（504/524）：上游生成较慢导致确认超时，可能已扣费。
    // 禁止自动重试/回退（避免二次扣费），透传可操作提示。
    if (isGatewayTimeout(response.status, errorText)) {
      console.warn('[Freedom] chat/completions gateway timeout:', response.status, errorText.slice(0, 300));
      throw new FreedomBilledError(
        `生图请求网关超时（HTTP ${response.status}）。所选模型生成较慢，` +
        `上游可能已完成生成（并已计费）但结果未能在超时前返回。建议：` +
        `①降低分辨率以缩短生成时间；②稍后重试；` +
        `③若上游已扣费成功，可在「调试面板→任务查询」用任务 ID 找回结果，避免重复生成。`,
        response.status,
      );
    }
    let msg = `图片生成 API 错误: ${response.status}`;
    try { const j = JSON.parse(errorText); msg = j.error?.message || msg; } catch {}
    throw toHttpError(msg, response.status, errorText);
  }
  const data = await response.json();
  const imageUrl = extractChatCompletionsImage(data);

  if (!imageUrl) {
    // 优先识别「上游内嵌失败文案」（HTTP 200 但内容是"生图失败/负载过高/已重试N次"等）。
    // 这类是上游自身重试后仍失败，并非本地提取问题——透传真实失败原因，避免误导。
    const failureReason = extractChatCompletionsFailureReason(data);
    if (failureReason) {
      console.warn('[Freedom] chat/completions 上游返回内嵌失败文案:', failureReason);
      // 这类通常为上游重试失败（多数不计费成功），用普通 Error 抛出真实原因。
      // 若原因文本已含"失败"字样则不再重复加前缀，避免"生图失败: 生图失败…"。
      const message = /失败|failed/i.test(failureReason) ? failureReason : `生图失败: ${failureReason}`;
      throw new Error(message);
    }
    // 上游已返回 2xx（通常已扣费）但未能解析出图片：抛 Billed 错误，禁止外层回退再次付费请求。
    // 具体的原始响应结构已由 extractChatCompletionsImage 打印到 console，便于定位新格式。
    throw new FreedomBilledError('未能从聊天响应中提取图片 URL（上游已返回成功，请查看控制台日志确认返回格式）', response.status);
  }

  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
  params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
  return { url: imageUrl, mediaId };
}

/**
 * 检测「聊天端点」返回体里的**上游内嵌失败文案**。
 *
 * 背景：大量 gpt-image 系列中转站在生图失败时，仍然返回 HTTP 200 + 正常的
 * chat.completion 结构，但把失败信息塞进 `message.content` 文本里，例如：
 *   "\n\n> 🎨 生成中...\n\n\n\n> ❌ 生图失败（已重试 3 次）: 当前模型负载较高，请稍候重试，或者切换其他模型\n"
 * 此时既没有图片，也不是真正的「成功」。若仍按「未能提取图片 URL（上游已返回成功）」
 * 报错，会误导用户以为是本地提取逻辑问题。这里把这类文案识别为**明确的上游失败**，
 * 抽取出可读的失败原因透传给用户。
 *
 * @returns 命中失败文案时返回清洗后的失败原因；否则返回 null（可能是真的有图/其它格式）
 */
function extractChatCompletionsFailureReason(data: any): string | null {
  // 汇总所有可能承载文本的位置
  const choice = data?.choices?.[0];
  const message = choice?.message ?? choice?.delta;
  const texts: string[] = [];
  const pushText = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) texts.push(v);
  };
  if (message) {
    if (typeof message.content === 'string') pushText(message.content);
    else if (Array.isArray(message.content)) {
      for (const part of message.content) pushText(part?.text);
    }
    pushText(message.reasoning_content);
    pushText(message.reasoning);
  }
  pushText(data?.content);
  if (texts.length === 0) return null;

  const combined = texts.join('\n');

  // 若文本里其实**包含图片/URL/base64**，则不当作失败（交给正常提取逻辑）
  if (imageFromText(combined)) return null;

  // 失败关键字（中英文）：命中即视为上游明确失败
  const FAILURE_PATTERNS: RegExp[] = [
    /生图失败/, /生成失败/, /图片生成失败/, /绘图失败/,
    /失败[（(]已重试/, /已重试\s*\d+\s*次/,
    /模型负载(较高)?/, /负载过高/, /请稍[候后]重试/, /稍后重试/,
    /切换其?他模型/, /当前不可用/, /暂不可用/, /服务繁忙/,
    /generation\s+failed/i, /failed\s+to\s+generate/i, /image\s+generation\s+failed/i,
    /model\s+(is\s+)?overloaded/i, /overloaded/i, /rate\s*limit/i,
    /please\s+(try|retry)\s+again/i, /try\s+again\s+later/i,
    /❌/, /⚠️\s*(失败|error|failed)/i,
  ];
  const isFailure = FAILURE_PATTERNS.some((re) => re.test(combined));
  if (!isFailure) return null;

  // 提炼可读原因：优先取带有 ❌ / 失败 / failed 的那一行，去掉 markdown 引用符号与表情
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*>+\s*/, '').trim()) // 去掉 markdown 引用前缀
    .filter(Boolean);
  const failureLine =
    lines.find((l) => /❌|生图失败|生成失败|failed|overloaded|负载|重试/i.test(l)) ||
    lines[lines.length - 1] ||
    combined.trim();

  // 清洗：去掉前导 emoji/符号
  const reason = failureLine.replace(/^[❌⚠️🎨✅\s:：]+/, '').trim() || failureLine.trim();
  return reason || '上游生图失败';
}

/**
 * Extract image URL from chat completions response (multiple formats)
 */
function extractChatCompletionsImage(data: any): string | null {
  // 复用模块级共享提取器（与 Gemini 原生路径保持一致的解析能力）
  const fromText = imageFromText;
  const fromPart = imageFromPart;

  const choice = data?.choices?.[0];
  const message = choice?.message ?? choice?.delta;

  if (message) {
    // Format 1: content 是数组（OpenAI 多模态）
    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        const hit = fromPart(part) || fromText(part?.text);
        if (hit) return hit;
      }
    }

    // Format 2: message.images[]（OpenRouter / 大量 Gemini 图片中转站）
    if (Array.isArray(message.images)) {
      for (const img of message.images) {
        const hit = fromPart(img) || (typeof img === 'string' ? fromText(img) : null);
        if (hit) return hit;
      }
    }

    // Format 3: content 是字符串（markdown / 裸 URL / base64）
    if (typeof message.content === 'string') {
      const hit = fromText(message.content);
      if (hit) return hit;
    }

    // Format 4: 部分中转把图塞进 reasoning_content
    const reasoningHit = fromText(message.reasoning_content) || fromText(message.reasoning);
    if (reasoningHit) return reasoningHit;
  }

  // Format 5: Gemini 原生 candidates 结构透传到 chat 响应
  const geminiParts = data?.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    for (const part of geminiParts) {
      const hit = fromPart(part) || fromText(part?.text);
      if (hit) return hit;
    }
  }

  // Format 6: 顶层 images / data 数组（部分中转把图放这里）
  for (const arrKey of ['images', 'data', 'output', 'artifacts'] as const) {
    const arr = (data as any)?.[arrKey];
    if (Array.isArray(arr)) {
      for (const item of arr) {
        const hit = fromPart(item) || (typeof item === 'string' ? fromText(item) : null);
        if (hit) return hit;
      }
    }
  }

  // Format 7: 标准 images 结构兜底（gpt-image 系列常把 data:[{url|b64_json}] 直接混入 chat 端点响应）
  //   例如 { data: [{ b64_json: '...' }] } 或 { data: [{ url: '...' }] } 或顶层 url/output。
  //   复用 extractImageUrl 覆盖 data[0].url / data[0].b64_json / url / output 等 OpenAI 官方形态。
  const imagesEndpointHit = extractImageUrl(data);
  if (imagesEndpointHit) return imagesEndpointHit;

  // 提取失败：打印真实响应结构，便于定位新的返回格式（上游已扣费的关键排查信息）
  try {
    const preview = JSON.stringify(data, (_k, v) =>
      typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…(len=${v.length})` : v,
    );
    console.error('[Freedom] 未能从聊天响应中提取图片 URL，原始响应结构:', preview?.slice(0, 4000));
  } catch {
    console.error('[Freedom] 未能从聊天响应中提取图片 URL，且响应无法序列化');
  }

  return null;
}

/**
 * Generate image via standard /v1/images/generations endpoint
 */
async function generateViaImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
  endpointTypes?: string[],
): Promise<GenerationResult> {
  const body: Record<string, any> = {
    prompt: params.prompt,
    model,
  };
  const isGptImage = isGptImageModelId(model);

  // 尺寸下发：同时附带 aspect_ratio / size / width / height，
  // 各供应商按各自识别字段自行匹配（未识别字段会被忽略）
  const sized = aspectRatioToSize(params.aspectRatio, params.resolution);
  if (params.aspectRatio && params.aspectRatio !== 'auto') body.aspect_ratio = params.aspectRatio;
  if (isGptImage) {
    // GPT-IMG 系列的 size 要传接口白名单里的像素字符串。
    body.size = normalizeGptImageSize(params.aspectRatio, params.resolution);
  } else {
    if (params.resolution) body.resolution = params.resolution;
    if (sized) {
      body.size = sized.size;
      if (!params.width) body.width = sized.width;
      if (!params.height) body.height = sized.height;
    }
  }
  if (!isGptImage && params.width) body.width = params.width;
  if (!isGptImage && params.height) body.height = params.height;
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.extraParams) {
    Object.assign(body, params.extraParams);
  }
  // 参考图：GPT-image 系列使用 image 字段（支持单张字符串或数组）
  // 将 dataURL 转为纯 base64（去掉 data:xxx;base64, 前缀），兼容各类代理
  if (params.referenceImages && params.referenceImages.length > 0) {
    const refs = params.referenceImages.slice(0, 16);
    const toImageValue = (dataUrl: string): string => {
      // 如果已经是 http(s) URL，直接使用
      if (/^https?:\/\//i.test(dataUrl)) return dataUrl;
      // dataURL → 去掉前缀，保留纯 base64
      const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
      return match ? match[1] : dataUrl;
    };
    if (refs.length === 1) {
      body.image = toImageValue(refs[0]);
    } else {
      body.image = refs.map(toImageValue);
    }
  }

  const imagePaths = getImageEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${imagePaths.submit}`;
  console.log('[Freedom] Submitting via images endpoint:', {
    model,
    submitUrl,
    isGptImage,
    aspectRatio: body.aspect_ratio,
    size: body.size,
    resolution: body.resolution,
    width: body.width,
    height: body.height,
    bodyKeys: Object.keys(body),
  });
  params.onProgress?.({ phase: 'submitting', percent: 10, message: '提交请求…' });
  throwIfAborted(params.signal);
  const response = await corsFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw toHttpError('Image generation failed', response.status, errText);
  }

  const data = await response.json();

  // Try to get image URL directly
  let imageUrl = extractImageUrl(data);

  // If async task, poll for result
  if (!imageUrl && data.task_id) {
    params.onProgress?.({ phase: 'processing', percent: 25, message: '排队 / 生成中…' });
    const pollUrl = `${rootBase}${imagePaths.poll(String(data.task_id))}`;
    imageUrl = await pollForResult(
      pollUrl,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
      params.onProgress,
      params.signal,
    );
  }

  if (!imageUrl) {
    throw new Error('No image URL in response');
  }

  params.onProgress?.({ phase: 'finalizing', percent: 95, message: '保存到素材库…' });
  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
  params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
  return { url: imageUrl, taskId: data.task_id, mediaId };
}

/**
 * Resolve kling model name for API requests.
 * Composite IDs like 'kling-image-v1-5' → 'kling-v1-5' (MemeFast version ID).
 * Video version IDs (kling-v2-6) pass through unchanged.
 */
function resolveKlingModelName(model: string): string {
  const match = model.match(/^kling-image-(v.+)$/);
  return match ? `kling-${match[1]}` : model;
}

/**
 * Generate image via Kling's native /kling/v1/images/* endpoints
 * Falls back to standard /v1/images/generations if native endpoint fails
 */
async function generateViaKlingImagesEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const nativePath = model === 'kling-omni-image'
    ? 'kling/v1/images/omni-image'
    : 'kling/v1/images/generations';

  const body: Record<string, any> = { prompt: params.prompt, model: resolveKlingModelName(model) };
  if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
  const sized = aspectRatioToSize(params.aspectRatio, params.resolution);
  if (sized) {
    body.size = sized.size;
    body.width = sized.width;
    body.height = sized.height;
  }
  if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(body, params.extraParams);
  // Kling 参考图字段：image_list（多张）/ image（单张）
  if (params.referenceImages && params.referenceImages.length > 0) {
    const refs = params.referenceImages.slice(0, 10);
    body.image = refs[0];
    if (refs.length > 1) body.image_list = refs;
  }

  params.onProgress?.({ phase: 'submitting', percent: 10, message: '提交 Kling 任务…' });
  throwIfAborted(params.signal);
  let response: Response;
  try {
    response = await corsFetch(`${rootBase}/${nativePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: params.signal,
    });
  } catch (err: any) {
    if (params.signal?.aborted || err?.name === 'AbortError') throw new FreedomCancelledError();
    // 网络/CORS 层错误：请求未被上游受理（未扣费），可安全回退到标准 images 端点
    return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
  }

  if (!response.ok) {
    // 仅当 Kling 原生端点「不存在 / 不支持」（404/405/501）时才回退（未扣费）；
    // 其它状态码（400/401/402/429/500 等）上游可能已受理请求、可能已扣费，
    // 不回退，直接抛错，避免二次扣费。
    if (response.status === 404 || response.status === 405 || response.status === 501) {
      return generateViaImagesEndpoint(params, model, apiKey, baseUrl);
    }
    const errText = await response.text();
    throw toHttpError('Kling image failed', response.status, errText);
  }

  const data = await response.json();
  let imageUrl = extractImageUrl(data);

  if (!imageUrl && data.task_id) {
    params.onProgress?.({ phase: 'processing', percent: 25, message: '排队 / 生成中…' });
    imageUrl = await pollForResult(
      `${rootBase}/${nativePath}/${data.task_id}`,
      apiKey,
      IMAGE_POLL_INTERVAL,
      IMAGE_POLL_MAX_ATTEMPTS,
      params.onProgress,
      params.signal,
    );
  }

  if (!imageUrl) {
    // Kling 原生端点已返回 2xx（已扣费）。此时若拿不到图片（轮询超时/失败），
    // 绝不回退到标准 images 端点重新提交（否则会造成第二次扣费）。
    throw new FreedomBilledError('Kling 已受理请求但未返回图片（上游已计费，请稍后在历史记录中查看或重试）', response.status);
  }

  params.onProgress?.({ phase: 'finalizing', percent: 95, message: '保存到素材库…' });
  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
  params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
  return { url: imageUrl, taskId: data.task_id, mediaId };
}

function toHttpError(prefix: string, status: number, body: string): Error & { status: number; retryable?: boolean } {
  const friendly = mapFriendlyErrorMessage(body, status);
  const rawMessage = friendly
    ? `${prefix}: ${status} ${friendly}`
    : `${prefix}: ${status} ${body}`;
  // §11.3 — Sanitize to prevent API key leakage in error messages
  const message = sanitizeErrorMessage(rawMessage);
  const err = new Error(message) as Error & { status: number; retryable?: boolean };
  err.status = status;
  if (isKnownNonRetryableApiError(body, status)) {
    err.retryable = false;
  }
  return err;
}

/**
 * 将供应商返回的业务错误码翻译成中文友好提示。
 * 命中已知错误码返回中文文案；未命中返回 null（外层会保留原始 body）。
 */
function mapFriendlyErrorMessage(body: string, status?: number): string | null {
  if (!body) return null;
  const parsed = parseApiErrorBody(body);
  const code = parsed.code.toLowerCase();
  const type = parsed.type.toLowerCase();
  const message = parsed.message.toLowerCase();
  const raw = body.toLowerCase();

  // 中转 / 上游：当前模型或当前端点不支持本次操作。
  // 典型原始错误：429 {"error":{"message":"The requested operation is unsupported.","type":"upstream_error"}}
  // 这里虽然 HTTP 状态码是 429，但语义不是“限流”，而是“操作/端点不支持”，不应反复重试。
  if (/requested operation is unsupported/i.test(body)
      || message.includes('operation is unsupported')
      || code === 'unsupported_operation'
      || code === 'operation_not_supported') {
    return '当前供应商或所选模型不支持这次图片生成操作。请检查“自由板块-图片”的模型绑定是否选择了图片生成模型，或在模型列表中同步/修正该模型的端点类型后重试';
  }

  // OpenAI / 中转常见错误码
  if (code === 'model_not_found' || message.includes('model not found') || message.includes('does not exist')) {
    return '未找到所选模型，可能是模型 ID 填写错误、供应商未开放该模型，或模型列表未同步。请重新选择可用模型后重试';
  }
  if (type === 'authentication_error' || code === 'invalid_api_key' || message.includes('invalid api key') || message.includes('incorrect api key')) {
    return 'API Key 无效或已失效，请在“设置 → API 管理”中检查并更新 Key';
  }
  if (type === 'permission_error' || code === 'permission_denied' || message.includes('permission denied')) {
    return '当前 API Key 没有调用该模型或该功能的权限，请检查供应商账号权限、模型权限或更换 Key';
  }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached' || message.includes('insufficient quota')) {
    return '账户额度不足或余额已用尽，请充值或更换有额度的 API Key 后重试';
  }
  if (type === 'rate_limit_error' || code === 'rate_limit_exceeded' || message.includes('too many requests') || message.includes('rate limit')) {
    return '请求过于频繁或上游限流，请稍后重试；如果配置了多个 Key，系统会尝试自动切换可用 Key';
  }
  if (code === 'content_policy_violation' || code === 'content_filter' || message.includes('content policy')) {
    return '请求内容触发了内容安全策略，请调整提示词或参考图后重试';
  }
  if (code === 'context_length_exceeded' || message.includes('context length')) {
    return '输入内容过长，请缩短描述文字或减少参考图后重试';
  }
  if (type === 'upstream_error' || code === 'upstream_error') {
    return status === 429
      ? '上游服务暂时拒绝请求，可能是模型繁忙、额度受限或供应商限流。请稍后重试，或切换模型/供应商'
      : '上游服务返回错误，请稍后重试，或切换模型/供应商';
  }

  // 火山方舟：输入图片疑似包含真实人物，隐私保护拦截
  if (/InputImageSensitiveContentDetected\.PrivacyInformation/i.test(body)
      || /input image may contain real person/i.test(body)) {
    return '疑似包含真实人物，因隐私保护策略拒绝处理';
  }
  // 火山引擎：账户欠费
  if (/AccountOverdueError/i.test(body) || /account has an overdue balance/i.test(body)) {
    return '服务端拒绝请求，可能因为火山引擎（Volc）账户余额不足或已欠费，或者是网络环境问题导致无法验证账户状态。请检查火山引擎账户余额和网络连接，确保账户正常且网络畅通后重试';
  }
  // 火山引擎：输出视频版权限制
  if (/output video may be related to copyright restrictions/i.test(body)) {
    const reqIdMatch = body.match(/[Rr]equest\s*id[:\s]*([0-9a-fA-Fx]+)/);
    const reqId = reqIdMatch ? reqIdMatch[1] : '未知';
    return `该请求未能成功，因为输出的视频可能受到版权限制的约束。该请求id如下：${reqId}`;
  }
  if (status === 400) return '请求参数被退回，请检查提示词、参考图、分辨率等参数是否符合要求，或是判定有真人或版权限制';
  if (status === 401) return '认证失败，请检查 API Key 是否正确或是否已过期';
  if (status === 403) return '当前账号或 API Key 没有调用权限，请检查供应商权限配置';
  if (status === 404) return '接口或模型不存在，请检查 Base URL、模型 ID 与端点类型配置';
  if (status === 408) return '请求超时，请稍后重试或切换网络/供应商';
  if (status === 429) return '请求过于频繁或上游限流，请稍后重试；也可以切换模型、供应商或增加备用 Key';
  if (status === 500) return '供应商服务器内部错误，请稍后重试';
  if (status === 502) return '供应商网关错误，请稍后重试或切换供应商';
  if (status === 503) return '供应商服务暂时不可用，请稍后重试';
  if (status === 504) return '供应商响应超时，请稍后重试或切换供应商';
  if (raw.includes('overloaded') || raw.includes('temporarily unavailable')) {
    return '上游模型负载较高或暂时不可用，请稍后重试';
  }
  return null;
}

function parseApiErrorBody(body: string): { message: string; type: string; code: string } {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? parsed;
    return {
      message: String(err?.message ?? parsed?.message ?? body),
      type: String(err?.type ?? parsed?.type ?? ''),
      code: String(err?.code ?? parsed?.code ?? ''),
    };
  } catch {
    return { message: body, type: '', code: '' };
  }
}

function isKnownNonRetryableApiError(body: string, status?: number): boolean {
  const parsed = parseApiErrorBody(body);
  const text = `${parsed.message}\n${parsed.type}\n${parsed.code}\n${body}`.toLowerCase();
  return (
    text.includes('requested operation is unsupported') ||
    text.includes('operation is unsupported') ||
    text.includes('unsupported_operation') ||
    text.includes('operation_not_supported') ||
    text.includes('model_not_found') ||
    text.includes('invalid_api_key') ||
    text.includes('authentication_error') ||
    text.includes('permission_denied') ||
    text.includes('content_policy_violation') ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 404
  );
}

function buildMidjourneyPrompt(params: FreedomImageParams): string {
  let prompt = params.prompt;
  const extra = params.extraParams || {};
  const aspect = params.aspectRatio;
  const stylization = typeof extra.stylization === 'number' ? extra.stylization : undefined;
  const weirdness = typeof extra.weirdness === 'number' ? extra.weirdness : undefined;

  if (aspect && aspect !== 'auto' && !/\s--ar\s+\S+/i.test(prompt)) {
    prompt += ` --ar ${aspect}`;
  }
  if (stylization !== undefined && !/\s--s(tylize)?\s+\S+/i.test(prompt)) {
    prompt += ` --s ${stylization}`;
  }
  if (weirdness !== undefined && !/\s--weird\s+\S+/i.test(prompt)) {
    prompt += ` --weird ${weirdness}`;
  }
  return prompt;
}

function mapMidjourneyMode(speed: unknown): string[] | undefined {
  if (typeof speed !== 'string') return undefined;
  const normalized = speed.toLowerCase();
  if (normalized === 'relaxed') return ['RELAX'];
  if (normalized === 'fast') return ['FAST'];
  if (normalized === 'turbo') return ['TURBO'];
  return undefined;
}

function getMidjourneyBotType(extra: Record<string, unknown>, model: string): 'MID_JOURNEY' | 'NIJI_JOURNEY' {
  if (extra.botType === 'NIJI_JOURNEY' || extra.botType === 'niji') return 'NIJI_JOURNEY';
  if (extra.botType === 'MID_JOURNEY' || extra.botType === 'mj') return 'MID_JOURNEY';
  return /niji/i.test(model) ? 'NIJI_JOURNEY' : 'MID_JOURNEY';
}

type MidjourneyExtraParams = Record<string, unknown>;

function isMidjourneyActionRequest(extra: MidjourneyExtraParams): boolean {
  return !!(
    (extra.taskId || extra.mjTaskId) &&
    (extra.customId || extra.mjCustomId || extra.actionCustomId)
  );
}

function getMidjourneyActionBody(extra: MidjourneyExtraParams): Record<string, unknown> {
  return {
    chooseSameChannel: extra.chooseSameChannel ?? true,
    customId: extra.customId || extra.mjCustomId || extra.actionCustomId,
    taskId: String(extra.taskId || extra.mjTaskId),
    notifyHook: extra.notifyHook || '',
    state: extra.state || '',
  };
}

function normalizeMidjourneyBase64Image(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed) return null;
  if (/^data:image\//i.test(trimmed)) return trimmed;
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) && trimmed.length > 100) {
    return `data:image/png;base64,${trimmed}`;
  }
  return null;
}

async function urlToDataUrl(src: string, signal?: AbortSignal): Promise<string | null> {
  try {
    if (src.startsWith('data:')) return src;
    if (!/^https?:\/\//i.test(src)) return null;
    const resp = await corsFetch(src, { signal });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
  } catch (e) {
    console.warn('[Freedom] Failed to convert MJ reference image:', e);
    return null;
  }
}

async function collectMidjourneyReferenceImages(
  params: FreedomImageParams,
  extra: MidjourneyExtraParams,
): Promise<string[]> {
  const refs: string[] = [];
  const push = (value: unknown) => {
    const normalized = normalizeMidjourneyBase64Image(value);
    if (normalized) refs.push(normalized);
  };

  if (Array.isArray(extra.base64Array)) {
    extra.base64Array.forEach(push);
  }
  if (params.referenceImages && params.referenceImages.length > 0) {
    params.onProgress?.({ phase: 'submitting', percent: 6, message: '处理 Midjourney 参考图…' });
    for (const ref of params.referenceImages.slice(0, 10)) {
      throwIfAborted(params.signal);
      const dataUrl = await urlToDataUrl(ref, params.signal);
      push(dataUrl);
    }
  }
  return refs.slice(0, 10);
}

function getRecordValue(data: unknown, key: string): unknown {
  return data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
}

function getStringValue(data: unknown, key: string): string | null {
  const value = getRecordValue(data, key);
  return typeof value === 'string' && value ? value : null;
}

function isImageUrlLike(value: string | null): value is string {
  return !!value && (/^https?:\/\//i.test(value) || /^data:image\//i.test(value));
}

function extractMidjourneyImageUrl(data: unknown): string | null {
  const nestedData = getRecordValue(data, 'data');
  const nestedOutput = getRecordValue(data, 'output');
  const firstDataItem = Array.isArray(nestedData) ? nestedData[0] : null;
  const firstOutputItem = Array.isArray(nestedOutput) ? nestedOutput[0] : null;
  const candidate = (
    getStringValue(data, 'imageUrl') ||
    getStringValue(data, 'image_url') ||
    getStringValue(data, 'url') ||
    getStringValue(data, 'resultUrl') ||
    getStringValue(nestedData, 'imageUrl') ||
    getStringValue(nestedData, 'image_url') ||
    getStringValue(nestedData, 'url') ||
    getStringValue(firstDataItem, 'url') ||
    getStringValue(nestedOutput, 'imageUrl') ||
    getStringValue(nestedOutput, 'image_url') ||
    getStringValue(nestedOutput, 'url') ||
    getStringValue(firstOutputItem, 'url') ||
    null
  );
  return isImageUrlLike(candidate) ? candidate : null;
}

async function submitMidjourneyRequest(
  submitUrl: string,
  apiKey: string,
  requestBody: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const submitResp = await corsFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });
  if (!submitResp.ok) {
    throw toHttpError('Midjourney submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json() as Record<string, unknown>;
  if (submitData.code !== undefined && submitData.code !== 1) {
    throw new Error(
      getStringValue(submitData, 'description') ||
      getStringValue(submitData, 'error') ||
      `Midjourney 提交失败 (code=${String(submitData.code)})`,
    );
  }
  return submitData;
}

async function generateViaMidjourneyEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const extra = params.extraParams || {};
  const isAction = isMidjourneyActionRequest(extra);
  const submitUrl = isAction ? `${rootBase}/mj/submit/action` : `${rootBase}/mj/submit/imagine`;
  const requestBody: Record<string, unknown> = {
    ...(isAction ? getMidjourneyActionBody(extra) : {
      botType: getMidjourneyBotType(extra, model),
      prompt: buildMidjourneyPrompt(params),
      notifyHook: extra.notifyHook || '',
      state: extra.state || '',
    }),
  };
  const modes = mapMidjourneyMode(extra.speed);
  if (!isAction && modes) requestBody.accountFilter = { modes };
  if (!isAction) {
    const mjRefs = await collectMidjourneyReferenceImages(params, extra);
    if (mjRefs.length > 0) {
      requestBody.base64Array = mjRefs;
    }
  }

  params.onProgress?.({ phase: 'submitting', percent: 10, message: isAction ? '提交 Midjourney 动作…' : '提交 Midjourney 任务…' });
  throwIfAborted(params.signal);
  const submitData = await submitMidjourneyRequest(submitUrl, apiKey, requestBody, params.signal);
  const directUrl = extractMidjourneyImageUrl(submitData);
  if (directUrl) {
    const mediaId = saveToMediaLibrary(directUrl, params.prompt, 'ai-image', params.projectId);
    params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
    return {
      url: directUrl,
      mediaId,
      metadata: {
        mjGrid: !isAction,
        mjBotType: requestBody.botType,
      },
    };
  }
  const taskId = getStringValue(submitData, 'result') || getStringValue(submitData, 'task_id') || getStringValue(submitData, 'id');
  if (!taskId) throw new Error('Midjourney 返回空任务 ID');

  const pollUrl = `${rootBase}/mj/task/${taskId}/fetch`;
  const pollState = createPollState(String(taskId), pollUrl);
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await abortableSleep(2500, params.signal);
    const pollResp = await pollFetchWithRetry(
      pollUrl,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: params.signal },
      pollState,
      params.signal,
    );
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    // MJ 服务端会返回字符串如 "50%"，提取数字
    let serverPct: number | undefined;
    if (typeof pollData.progress === 'string') {
      const m = pollData.progress.match(/(\d+)/);
      if (m) serverPct = parseInt(m[1], 10);
    } else if (typeof pollData.progress === 'number') {
      serverPct = pollData.progress > 1 ? pollData.progress : pollData.progress * 100;
    }
    if (status === 'success' || status === 'succeeded' || status === 'completed') {
      const imageUrl = extractMidjourneyImageUrl(pollData);
      if (!imageUrl) throw new Error('Midjourney 成功但未返回图片 URL');
      params.onProgress?.({ phase: 'finalizing', percent: 95, message: '保存到素材库…' });
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
      params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
      return {
        url: imageUrl,
        taskId: String(taskId),
        mediaId,
        metadata: {
          mjGrid: !isAction,
          mjTaskId: String(taskId),
          mjButtons: Array.isArray(pollData.buttons) ? pollData.buttons : undefined,
          mjBotType: requestBody.botType,
        },
      };
    }
    if (status === 'failure' || status === 'failed' || status === 'error') {
      throw new Error(sanitizeErrorMessage(pollData.failReason || pollData.message || 'Midjourney 生成失败'));
    }
    const estimated = 25 + Math.min(55, Math.round((i / IMAGE_POLL_MAX_ATTEMPTS) * 60));
    const percent = Math.min(85, Math.max(estimated, Math.round(serverPct ?? 0)));
    params.onProgress?.({
      phase: 'processing',
      percent,
      message: serverPct !== undefined ? `Midjourney 进度 ${serverPct}%` : (status ? `状态：${status}` : '生成中…'),
    });
  }

  throw new Error('Midjourney 生成超时');
}

function toIdeogramAspectRatio(model: string, aspectRatio?: string): string | undefined {
  if (!aspectRatio) return undefined;

  // V1/V2 使用 ASPECT_16_9；V3 使用 16x9
  if (/_V_[12](_|$)/i.test(model)) {
    return `ASPECT_${aspectRatio.replace(':', '_')}`;
  }
  return aspectRatio.replace(':', 'x');
}

function toIdeogramRenderSpeed(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const normalized = input.toLowerCase();
  if (normalized === 'turbo') return 'TURBO';
  if (normalized === 'quality') return 'QUALITY';
  if (normalized === 'balanced') return 'DEFAULT';
  return input.toUpperCase();
}

/**
 * 从 model 名后缀自动提取 rendering_speed
 * e.g. ideogram_generate_V_3_TURBO → 'TURBO'
 */
function toIdeogramRenderSpeedFromModel(model: string): string | undefined {
  const match = model.match(/_(TURBO|DEFAULT|QUALITY|FLASH)$/i);
  return match ? match[1].toUpperCase() : undefined;
}

async function generateViaIdeogramEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  // Ideogram 原生路径：/ideogram/v1/ideogram-v3/generate（不是 /v1/ideogram-v3/generate）
  const rootBase = getRootBaseUrl(baseUrl);
  const endpoint = `${rootBase}/ideogram/v1/ideogram-v3/generate`;
  const extra = params.extraParams || {};
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);

  const aspect = toIdeogramAspectRatio(model, params.aspectRatio);
  if (aspect) form.append('aspect_ratio', aspect);

  // extraParams 优先；无则从 model 名后缀推断（e.g. ideogram_generate_V_3_TURBO）
  const speed = toIdeogramRenderSpeed(extra.render_speed || extra.rendering_speed)
    ?? toIdeogramRenderSpeedFromModel(model);
  if (speed) form.append('rendering_speed', speed);

  if (typeof extra.style === 'string') form.append('style_type', extra.style.toUpperCase());
  if (typeof params.negativePrompt === 'string' && params.negativePrompt.trim()) {
    form.append('negative_prompt', params.negativePrompt);
  }
  if (typeof extra.num_images === 'number') form.append('num_images', String(extra.num_images));

  params.onProgress?.({ phase: 'submitting', percent: 15, message: '提交 Ideogram 任务…' });
  throwIfAborted(params.signal);
  const response = await corsFetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: form,
    signal: params.signal,
  });

  if (!response.ok) {
    throw toHttpError('Ideogram generate failed', response.status, await response.text());
  }

  params.onProgress?.({ phase: 'finalizing', percent: 90, message: '解析结果…' });
  const data = await response.json();
  const imageUrl = extractImageUrl(data);
  if (!imageUrl) throw new Error('Ideogram 响应未包含图片 URL');
  const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
  params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
  return { url: imageUrl, mediaId };
}

/**
 * Generate image via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateViaReplicateImageEndpoint(
  params: FreedomImageParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.resolution) input.resolution = params.resolution;
  const sized = aspectRatioToSize(params.aspectRatio, params.resolution);
  if (sized) {
    input.size = sized.size;
    if (!params.width) input.width = sized.width;
    if (!params.height) input.height = sized.height;
  }
  if (params.width) input.width = params.width;
  if (params.height) input.height = params.height;
  if (params.negativePrompt) input.negative_prompt = params.negativePrompt;
  if (params.extraParams) Object.assign(input, params.extraParams);
  // Replicate 参考图字段：image / image_input
  if (params.referenceImages && params.referenceImages.length > 0) {
    const refs = params.referenceImages.slice(0, 10);
    input.image = refs[0];
    if (refs.length > 1) input.image_input = refs;
  }

  params.onProgress?.({ phase: 'submitting', percent: 10, message: '提交 Replicate 任务…' });
  throwIfAborted(params.signal);
  const submitResp = await corsFetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
    signal: params.signal,
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractImageUrl(submitData);
  if (directUrl) {
    params.onProgress?.({ phase: 'finalizing', percent: 95, message: '保存到素材库…' });
    const mediaId = saveToMediaLibrary(directUrl, params.prompt, 'ai-image', params.projectId);
    params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
    return { url: directUrl, mediaId };
  }

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  params.onProgress?.({ phase: 'processing', percent: 25, message: '排队 / 生成中…' });
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    await abortableSleep(IMAGE_POLL_INTERVAL, params.signal);
    const pollResp = await corsFetch(pollUrl, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: params.signal,
    });
    if (!pollResp.ok) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const imageUrl = extractImageUrl(pollData);
      if (!imageUrl) throw new Error('Replicate 成功但未返回图片 URL');
      params.onProgress?.({ phase: 'finalizing', percent: 95, message: '保存到素材库…' });
      const mediaId = saveToMediaLibrary(imageUrl, params.prompt, 'ai-image', params.projectId);
      params.onProgress?.({ phase: 'done', percent: 100, message: '完成' });
      return { url: imageUrl, taskId: String(predictionId), mediaId };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(sanitizeErrorMessage(pollData.error || 'Replicate 图片生成失败'));
    }
    const estimated = 25 + Math.min(55, Math.round((i / IMAGE_POLL_MAX_ATTEMPTS) * 60));
    params.onProgress?.({
      phase: 'processing',
      percent: Math.min(85, estimated),
      message: status ? `状态：${status}` : '生成中…',
    });
  }
  throw new Error('Replicate 图片生成超时');
}

// ==================== Video Generation ====================

/**
 * 已完成落库的视频结果缓存（key = 上游任务 ID 或结果 URL）。
 * 用于保证同一个视频任务只写一次本地文件、只插一条素材记录。
 */
const finalizedVideoResults = new Map<string, Promise<GenerationResult>>();

export async function generateFreedomVideo(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  const { config } = resolveFreedomFeatureConfig('freedom_video', 'video_generation', params.model);
  return freedomRetry(() => _generateFreedomVideoInner(params), 'Video generation', config?.keyManager);
}

async function _generateFreedomVideoInner(
  params: FreedomVideoParams
): Promise<GenerationResult> {
  throwIfAborted(params.signal);

  const { config, source: configSource } = resolveFreedomFeatureConfig(
    'freedom_video',
    'video_generation',
    params.model,
  );
  if (!config) {
    const msg = getFeatureNotConfiguredMessage('video_generation');
    toast.error('自由板块视频生成未配置：请在设置中配置「自由板块-视频」或「视频生成」服务映射');
    throw new Error(msg);
  }
  console.log(`[Freedom] Video config source: ${configSource}`);

  const { baseUrl, model: defaultModel } = config;
  // 每次重试动态取当前 key（利用 keyManager rotate 后的新 key）
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey;
  // 模型 ID 直接透传：UI 选的就是供应商原始 ID，无需转换
  const model = params.model || defaultModel;

  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = detectFreedomVideoRoute(model, endpointTypes);
  console.log('[Freedom] Generating video:', {
    model,
    route,
    endpointTypes,
    prompt: params.prompt.slice(0, 50),
  });

  // 记录上游任务 ID：与恢复链（resumeFreedomVideoTask）共用同一个去重键，
  // 确保同一个上游任务无论被几条链条完成，都只落库一次。
  let upstreamTaskId: string | undefined;
  const innerParams: FreedomVideoParams = {
    ...params,
    onTaskCreated: (info) => {
      upstreamTaskId = info.taskId;
      params.onTaskCreated?.(info);
    },
  };

  let result: GenerationResult;
  switch (route) {
    case 'openai_official':
      result = await generateVideoViaOpenAIOfficial(innerParams, model, apiKey, baseUrl);
      break;
    case 'volc':
      result = await generateVideoViaVolc(innerParams, model, apiKey, baseUrl);
      break;
    case 'wan':
      result = await generateVideoViaWan(innerParams, model, apiKey, baseUrl);
      break;
    case 'kling':
      result = await generateVideoViaKling(innerParams, model, apiKey, baseUrl);
      break;
    case 'replicate':
      result = await generateVideoViaReplicate(innerParams, model, apiKey, baseUrl);
      break;
    default:
      result = await generateVideoViaUnified(innerParams, model, apiKey, baseUrl);
      break;
  }

  return finalizeFreedomVideoResult(result, params.prompt, params.projectId, upstreamTaskId);
}

async function finalizeFreedomVideoResult(
  result: GenerationResult,
  prompt: string,
  projectId?: string | null,
  dedupeKey?: string,
): Promise<GenerationResult> {
  // 幂等保护：同一任务可能被多条链条完成（例如切换 Tab 导致 VideoStudio 卸载重挂载后
  // 恢复逻辑又起了一条轮询链，而原始链条仍在后台运行）。若不去重，每条链都会
  // 各自写一个 mp4（文件名带 Date.now()）并各自往素材库插一条记录。
  const key = dedupeKey || result.url;
  if (key) {
    const existing = finalizedVideoResults.get(key);
    if (existing) {
      console.log('[Freedom] Reusing finalized video result (dedupe):', key);
      return existing;
    }
  }

  const task = (async () => {
    const persistentUrl = await persistFreedomVideoResult(result.url, prompt);
    const mediaId = saveToMediaLibrary(persistentUrl, prompt, 'ai-video', projectId);
    return { ...result, url: persistentUrl, mediaId };
  })();

  if (key) {
    finalizedVideoResults.set(key, task);
    // 失败则允许后续重试，不要把错误结果永久缓存
    task.catch(() => finalizedVideoResults.delete(key));
  }

  return task;
}

export async function resumeFreedomVideoTask(
  params: ResumeFreedomVideoTaskParams,
): Promise<GenerationResult> {
  let result: GenerationResult;
  if (params.route === 'volc') {
    result = await pollVolcVideoTask(params.pollUrl, params.signal, params.model);
  } else if (params.route === 'openai_official') {
    result = await pollOpenAIOfficialVideoTask(params.pollUrl, params.taskId, params.model, params.signal);
  } else {
    result = await pollUnifiedVideoTask(params.pollUrl, params.taskId, params.model, params.signal);
  }
  return finalizeFreedomVideoResult(result, params.prompt, params.projectId, params.taskId);
}

// ==================== Task Query (Debug) ====================

export type FreedomTaskQueryRoute = 'auto' | 'volc' | 'unified' | 'openai_official';

export interface FreedomTaskQueryResult {
  /** 规范化后的任务状态 */
  status: 'succeeded' | 'processing' | 'failed' | 'unknown';
  /** 实际用于查询的地址 */
  pollUrl: string;
  /** 命中的路由 */
  route: FreedomVideoRoute;
  /** 提取到的结果链接（视频优先，其次图片） */
  resultUrl?: string;
  /** 结果媒体类型 */
  mediaType?: 'video' | 'image';
  /** 服务端返回的原始响应（已解析或原始文本） */
  raw: unknown;
  /** HTTP 状态码 */
  httpStatus: number;
  /** 失败/异常时的说明 */
  error?: string;
}

/**
 * 用任务 ID 查询一次生成任务的状态与结果（单次查询，不做无限轮询）。
 *
 * 供「调试」面板使用：根据当前「自由板块-视频」绑定的 API 配置（baseUrl + key）
 * 自动拼出查询地址；也可以直接传入完整 pollUrl 覆盖自动拼装。
 */
export async function queryFreedomTaskById(options: {
  taskId: string;
  /** 路由类型，默认 auto（按模型/端点类型自动判断） */
  route?: FreedomTaskQueryRoute;
  /** 模型 ID，用于解析对应的 API 配置与端点类型 */
  model?: string;
  /** 显式的完整查询地址；提供后忽略自动拼装 */
  pollUrl?: string;
  signal?: AbortSignal;
}): Promise<FreedomTaskQueryResult> {
  const taskId = (options.taskId || '').trim();
  const explicitPollUrl = (options.pollUrl || '').trim();
  if (!taskId && !explicitPollUrl) {
    throw new Error('请填写任务 ID（或完整查询地址）');
  }

  const { config } = resolveFreedomFeatureConfig('freedom_video', 'video_generation', options.model);
  if (!config && !explicitPollUrl) {
    throw new Error('未找到「自由板块-视频」的 API 配置。请先在设置中配置视频服务映射，或直接填写完整查询地址');
  }

  const model = options.model || config?.model || '';
  const baseUrl = config?.baseUrl || '';
  const apiKey = config?.keyManager?.getCurrentKey?.() || config?.apiKey || '';
  const endpointTypes = model
    ? useAPIConfigStore.getState().modelEndpointTypes[model]
    : undefined;

  // 决定路由
  const route: FreedomVideoRoute = options.route && options.route !== 'auto'
    ? options.route
    : detectFreedomVideoRoute(model, endpointTypes);

  // 拼查询地址
  let pollUrl = explicitPollUrl;
  if (!pollUrl) {
    if (route === 'volc') {
      pollUrl = `${buildVolcVideoSubmitPath(baseUrl)}/${taskId}`;
    } else if (route === 'openai_official') {
      pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
    } else {
      // unified 及其它：使用端点类型对应的查询路径
      const rootBase = getRootBaseUrl(baseUrl);
      const paths = getUnifiedEndpointPaths(endpointTypes || []);
      pollUrl = `${rootBase}${paths.poll(taskId)}`;
    }
  }

  const authHeaders: Record<string, string> = apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
  const resp = await corsFetch(pollUrl, { headers: authHeaders, signal: options.signal });
  const httpStatus = resp.status;

  // 读取响应（尽量解析 JSON，失败则保留原始文本）
  const text = await resp.text();
  let raw: unknown = text;
  try { raw = JSON.parse(text); } catch { /* 保留原始文本 */ }

  if (!resp.ok) {
    return {
      status: 'failed',
      pollUrl,
      route,
      raw,
      httpStatus,
      error: `查询失败：HTTP ${httpStatus}`,
    };
  }

  const data = raw as any;
  const rawStatus = String(data?.status || data?.state || data?.data?.status || '').toLowerCase();
  const videoUrl = data?.content?.video_url || extractVideoUrl(data);
  const imageUrl = !videoUrl ? extractImageUrl(data) : undefined;
  const resultUrl = videoUrl || imageUrl || undefined;
  const mediaType: 'video' | 'image' | undefined = videoUrl ? 'video' : imageUrl ? 'image' : undefined;

  let status: FreedomTaskQueryResult['status'];
  if (rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'success') {
    status = 'succeeded';
  } else if (rawStatus === 'failed' || rawStatus === 'error' || rawStatus === 'cancelled') {
    status = 'failed';
  } else if (rawStatus) {
    status = 'processing';
  } else {
    status = resultUrl ? 'succeeded' : 'unknown';
  }

  return { status, pollUrl, route, resultUrl, mediaType, raw, httpStatus };
}

// ==================== 图片同步生成探针（Debug） ====================

export interface FreedomImageProbeResult {
  /** 命中的图片路由 */
  route: FreedomImageRoute;
  /** 实际请求地址 */
  endpoint: string;
  /** 发送的请求体（用于核对下发字段） */
  requestBody: unknown;
  /** HTTP 状态码 */
  httpStatus: number;
  /** 服务端原始响应（已解析或原始文本） */
  raw: unknown;
  /** 用当前提取逻辑尝试提取到的图片链接（成功=已能正确解析） */
  extractedUrl?: string;
  /** 命中提取的提取器名称，便于定位是哪种格式 */
  matchedExtractor?: string;
  /** 失败/异常时的说明 */
  error?: string;
}

/**
 * 图片「手动查询结果」探针：用真实的「自由板块-图片」配置与路由，
 * 对同步生图模型（gpt-image / gemini / chat 多模态等）发起一次真实生成请求，
 * 返回**未经提取的完整原始响应** + 各提取器诊断。
 *
 * 用途：当出现「未能从聊天/Gemini 响应中提取图片」但上游已扣费成功时，
 * 借此看到该模型经中转站返回的真实结构，从而定位/修复提取逻辑。
 *
 * 注意：这会真实发起一次生成（可能扣费）。仅供调试使用。
 */
export async function probeFreedomImageResponse(options: {
  /** 模型 ID（如 gpt-image-2）。留空则用「自由板块-图片」默认模型 */
  model?: string;
  /** 提示词，默认一段安全的通用提示 */
  prompt?: string;
  /** 宽高比，默认 1:1 */
  aspectRatio?: string;
  /** 分辨率档位（如 1k/2k），默认 1k */
  resolution?: string;
  /** 强制指定路由（留空则自动检测） */
  forceRoute?: FreedomImageRoute;
  signal?: AbortSignal;
}): Promise<FreedomImageProbeResult> {
  const { config } = resolveFreedomFeatureConfig('freedom_image', 'character_generation', options.model);
  if (!config) {
    throw new Error('未找到「自由板块-图片」的 API 配置。请先在设置中配置图片服务映射');
  }

  const model = options.model || config.model;
  if (!model) throw new Error('请填写模型 ID');
  const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
  const apiKey = config.keyManager?.getCurrentKey?.() || config.apiKey || '';
  const prompt = options.prompt?.trim() || 'A cute corgi puppy sitting on green grass, soft daylight, high detail';
  const aspectRatio = options.aspectRatio || '1:1';
  const resolution = options.resolution || '1k';

  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const route = options.forceRoute || detectFreedomImageRoute(model, endpointTypes);

  // 依路由构造与真实生图一致的请求体与地址
  let endpoint = '';
  let requestBody: Record<string, any> = {};
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  if (route === 'gemini_native') {
    const rootBase = getRootBaseUrl(baseUrl);
    const supportsImageSize = geminiSupportsImageSize(model);
    const imageConfig: Record<string, any> = { aspectRatio };
    if (supportsImageSize) imageConfig.imageSize = normalizeGeminiImageSize(resolution);
    requestBody = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig },
    };
    endpoint = `${rootBase}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    authHeaders['x-goog-api-key'] = apiKey;
  } else if (route === 'openai_chat') {
    endpoint = buildEndpoint(baseUrl, 'chat/completions');
    const isGemini = isGeminiImageModel(model);
    const isGptImage = isGptImageModelId(model);
    requestBody = {
      model,
      messages: [{ role: 'user', content: prompt }],
    };
    if (isGemini) {
      requestBody.aspectRatio = aspectRatio;
      if (geminiSupportsImageSize(model)) requestBody.imageSize = normalizeGeminiImageSize(resolution);
    } else if (isGptImage) {
      requestBody.size = normalizeGptImageSize(aspectRatio, resolution);
    } else {
      const sized = aspectRatioToSize(aspectRatio, resolution);
      if (sized) requestBody.size = sized.size;
      requestBody.aspect_ratio = aspectRatio;
    }
  } else {
    // openai_images 及其它默认走标准 images 端点
    const imagePaths = getImageEndpointPaths(endpointTypes || []);
    const rootBase = getRootBaseUrl(baseUrl);
    endpoint = `${rootBase}${imagePaths.submit}`;
    const isGptImage = isGptImageModelId(model);
    requestBody = { prompt, model };
    if (aspectRatio && aspectRatio !== 'auto') requestBody.aspect_ratio = aspectRatio;
    if (isGptImage) {
      requestBody.size = normalizeGptImageSize(aspectRatio, resolution);
    } else {
      requestBody.resolution = resolution;
      const sized = aspectRatioToSize(aspectRatio, resolution);
      if (sized) { requestBody.size = sized.size; requestBody.width = sized.width; requestBody.height = sized.height; }
    }
  }

  console.log('[Freedom][Probe] Sending probe request:', { model, route, endpoint });
  const response = await corsFetch(endpoint, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(requestBody),
    signal: options.signal,
  });
  const httpStatus = response.status;
  const text = await response.text();
  let raw: unknown = text;
  try { raw = JSON.parse(text); } catch { /* 保留原始文本 */ }

  if (!response.ok) {
    return {
      route, endpoint, requestBody, httpStatus, raw,
      error: `请求失败：HTTP ${httpStatus}`,
    };
  }

  // 依路由用对应提取器诊断（同时给出「能否提取到图片」的结论）
  const data = raw as any;
  let extractedUrl: string | null = null;
  let matchedExtractor: string | undefined;
  if (route === 'gemini_native') {
    extractedUrl = extractGeminiImage(data);
    if (extractedUrl) matchedExtractor = 'extractGeminiImage';
  } else {
    extractedUrl = extractChatCompletionsImage(data);
    if (extractedUrl) matchedExtractor = 'extractChatCompletionsImage';
    if (!extractedUrl) {
      extractedUrl = extractImageUrl(data);
      if (extractedUrl) matchedExtractor = 'extractImageUrl(images 端点格式)';
    }
  }

  // 未提取到图片时，区分「上游内嵌失败文案」与「提取规则缺失」，给出更准确的诊断
  let diagnosisError: string | undefined;
  if (!extractedUrl) {
    const failureReason = route === 'gemini_native'
      ? extractGeminiErrorReason(data)
      : (extractChatCompletionsFailureReason(data) ?? extractGeminiErrorReason(data));
    diagnosisError = failureReason
      ? `上游返回 HTTP ${httpStatus}，但内容是失败信息（并非真正生成了图片）：${failureReason}`
      : '当前提取逻辑未能从响应中解析出图片（请把上面的原始响应结构反馈给开发者以补充解析规则）';
  }

  return {
    route, endpoint, requestBody, httpStatus, raw,
    extractedUrl: extractedUrl || undefined,
    matchedExtractor,
    error: diagnosisError,
  };
}

/**
 * 把查询到的结果链接保存到素材库（供调试面板一键入库）。
 * 视频会先下载到本地再入库，图片直接入库。返回 mediaId。
 */
export async function saveFreedomTaskResultToMedia(options: {
  url: string;
  prompt?: string;
  mediaType: 'video' | 'image';
  projectId?: string | null;
}): Promise<string | undefined> {
  const prompt = options.prompt || '调试任务查询';
  if (options.mediaType === 'video') {
    const persistentUrl = await persistFreedomVideoResult(options.url, prompt);
    return saveToMediaLibrary(persistentUrl, prompt, 'ai-video', options.projectId);
  }
  return saveToMediaLibrary(options.url, prompt, 'ai-image', options.projectId);
}

async function persistFreedomVideoResult(url: string, prompt: string): Promise<string> {
  if (!url || url.startsWith('local-image://')) return url;
  const safeName = prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') || 'freedom_video';
  const filename = `${safeName}_${Date.now()}.mp4`;
  return saveVideoToLocal(url, filename);
}

/**
 * Convert aspect ratio string to Runway pixel-format ratio (e.g. '16:9' → '1280:720')
 */
function toRunwayRatio(aspectRatio: string): string {
  const map: Record<string, string> = {
    '16:9': '1280:720',
    '9:16': '720:1280',
    '1:1':  '720:720',
    '4:3':  '960:720',
    '3:4':  '720:960',
    '21:9': '2048:880',
  };
  return map[aspectRatio] ?? aspectRatio;
}

function toSoraSize(aspectRatio?: string, resolution?: string): string {
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
  const is1080 = (resolution || '').toLowerCase().includes('1080');
  if (is1080) return isPortrait ? '1080x1920' : '1920x1080';
  return isPortrait ? '720x1280' : '1280x720';
}

function toVeoOpenAIVideoSize(aspectRatio?: string): string {
  const isPortrait = aspectRatio === '9:16' || aspectRatio === '3:4';
  return isPortrait ? '1080x1920' : '1920x1080';
}

function groupVideoUploadFiles(uploadFiles?: FreedomVideoUploadFile[]) {
  const grouped: {
    single?: FreedomVideoUploadFile;
    first?: FreedomVideoUploadFile;
    last?: FreedomVideoUploadFile;
    references: FreedomVideoUploadFile[];
  } = { references: [] };

  for (const file of uploadFiles || []) {
    if (file.role === 'single' && !grouped.single) grouped.single = file;
    if (file.role === 'first' && !grouped.first) grouped.first = file;
    if (file.role === 'last' && !grouped.last) grouped.last = file;
    if (file.role === 'reference') grouped.references.push(file);
  }

  return grouped;
}

function countVideoUploadFiles(grouped: ReturnType<typeof groupVideoUploadFiles>): number {
  return (
    (grouped.single ? 1 : 0) +
    (grouped.first ? 1 : 0) +
    (grouped.last ? 1 : 0) +
    grouped.references.length
  );
}

function validateSeedanceVideoParams(
  model: string,
  params: FreedomVideoParams,
  grouped: ReturnType<typeof groupVideoUploadFiles>,
): void {
  const durationError = validateSeedanceDuration(model, params.duration);
  if (durationError) throw new Error(durationError);

  const counts = { images: 0, videos: 0, audios: 0 };
  for (const file of grouped.references) {
    const type = file.assetType || inferAssetType(file);
    if (type === 'video') counts.videos += 1;
    else if (type === 'audio') counts.audios += 1;
    else counts.images += 1;
  }
  const referenceError = validateSeedanceReferenceCounts(model, counts);
  if (referenceError) throw new Error(referenceError);
}

function validateVeoVideoUploads(
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
): ReturnType<typeof groupVideoUploadFiles> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = groupVideoUploadFiles(uploadFiles);
  const total = countVideoUploadFiles(grouped);

  if (!capability.isVeo) return grouped;

  if (capability.mode === 'none') {
    if (total > 0) throw new Error(`模型 ${model} 不支持上传文件输入`);
    return grouped;
  }

  if (capability.mode === 'single') {
    const file = grouped.single || grouped.first;
    if (capability.minFiles > 0 && !file) {
      throw new Error(`模型 ${model} 需要上传 1 张图片`);
    }
    if (grouped.references.length > 0 || !!grouped.last || (!!grouped.single && !!grouped.first)) {
      throw new Error(`模型 ${model} 仅支持 1 张图片输入`);
    }
    return grouped;
  }

  if (capability.mode === 'first_last') {
    if (grouped.references.length > 0 || !!grouped.single) {
      throw new Error(`模型 ${model} 仅支持首帧/尾帧输入`);
    }
    if (capability.minFiles > 0 && !grouped.first) {
      throw new Error(`模型 ${model} 需要上传首帧图片`);
    }
    if (!grouped.first && grouped.last) {
      throw new Error(`模型 ${model} 仅上传尾帧无效，请先上传首帧`);
    }
    if (total > capability.maxFiles) {
      throw new Error(`模型 ${model} 最多支持 2 张图片（首帧/尾帧）`);
    }
    return grouped;
  }

  if (capability.mode === 'multi') {
    if (!!grouped.single || !!grouped.first || !!grouped.last) {
      throw new Error(`模型 ${model} 仅支持多参考图输入`);
    }
    if (grouped.references.length < capability.minFiles) {
      throw new Error(`模型 ${model} 至少需要上传 1 张参考图`);
    }
    if (grouped.references.length > capability.maxFiles) {
      throw new Error(`模型 ${model} 最多支持 ${capability.maxFiles} 张参考图`);
    }
    return grouped;
  }

  return grouped;
}

function buildResumeAuthHeaders(model?: string): Record<string, string> {
  const { config } = resolveFreedomFeatureConfig('freedom_video', 'video_generation', model);
  const apiKey = config?.keyManager?.getCurrentKey?.() || config?.apiKey;
  return apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {};
}

async function toUploadHttpUrl(file: FreedomVideoUploadFile): Promise<string> {
  // 0) 火山引擎素材资产 URI（Asset://xxx），直接透传给方舟 API
  if (file.volcAssetUri) return file.volcAssetUri;

  // 1) 已经是 http(s) URL，直接复用
  if (file.dataUrl && /^https?:\/\//i.test(file.dataUrl)) return file.dataUrl;

  // 2) 有本地路径 + 配置了对象存储（R2/S3） → 走主进程上传，拿回 HTTP URL
  //    这是视频/音频等大文件的主路径；图片若也配置了 R2，同样走这条路（更稳定）
  const w = (typeof window !== 'undefined' ? (window as any) : null);
  const objectStorage = w?.objectStorage;
  if (file.localPath && objectStorage?.upload) {
    try {
      const isCfg = await objectStorage.isConfigured?.();
      if (isCfg) {
        const url = await objectStorage.upload(file.localPath);
        if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
          return url;
        }
      }
    } catch (err) {
      // 上传失败，根据资源类型决定是否降级
      const assetType = file.assetType || inferAssetType(file);
      if (assetType !== 'image') {
        // 视频/音频体积大，无法降级到图床
        throw new Error(`上传到对象存储失败：${(err as Error)?.message || err}`);
      }
      console.warn('[freedom-api] R2 上传图片失败，降级到图床:', err);
    }
  }

  // 3) 视频/音频但 dataUrl 不是 http URL 又没有 localPath / 未配置 R2 → 给出明确提示
  const assetType = file.assetType || inferAssetType(file);
  if (assetType !== 'image' && (!file.dataUrl || !/^data:(image|video|audio)\//i.test(file.dataUrl))) {
    throw new Error('视频/音频参考素材需要先配置「对象存储（R2/S3）」才能上传，请前往「设置 → 图床配置 → 对象存储」配置。');
  }

  // 4) 兜底：图片 base64 → 图床
  return uploadBase64Image(file.dataUrl);
}

function dataUrlToBlob(dataUrl: string, mimeHint?: string): Blob {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('上传文件格式无效，必须是 data URL 或 http(s) URL');
  const mime = match[1] || mimeHint || 'image/png';
  const b64 = match[2];
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function toUploadBlob(file: FreedomVideoUploadFile): Promise<Blob> {
  if (/^https?:\/\//i.test(file.dataUrl)) {
    const resp = await corsFetch(file.dataUrl);
    if (!resp.ok) throw new Error(`无法下载上传素材：${resp.status}`);
    return resp.blob();
  }
  return dataUrlToBlob(file.dataUrl, file.mimeType);
}

async function appendVeoMultipartReferences(
  form: FormData,
  model: string,
  endpointTypes: string[] | undefined,
  uploadFiles?: FreedomVideoUploadFile[],
) {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  if (!capability.isVeo) return;

  const grouped = validateVeoVideoUploads(model, endpointTypes, uploadFiles);
  const ordered: FreedomVideoUploadFile[] = [];

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) ordered.push(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) ordered.push(grouped.first);
    if (grouped.last) ordered.push(grouped.last);
  } else if (capability.mode === 'multi') {
    ordered.push(...grouped.references.slice(0, capability.maxFiles));
  }

  for (let i = 0; i < ordered.length; i++) {
    const file = ordered[i];
    const blob = await toUploadBlob(file);
    const fileName = file.fileName || `veo-reference-${i + 1}.png`;
    form.append('input_reference', blob, fileName);
  }
}

async function buildVeoUnifiedVideoBody(
  params: FreedomVideoParams,
  model: string,
  endpointTypes: string[] | undefined,
): Promise<Record<string, any>> {
  const capability = resolveVeoUploadCapability(model, endpointTypes);
  const grouped = validateVeoVideoUploads(model, endpointTypes, params.uploadFiles);
  const body: Record<string, any> = {
    model,
    prompt: params.prompt,
  };
  const metadata: Record<string, any> = {};

  if (params.duration) body.duration = params.duration;
  if (params.aspectRatio) metadata.aspectRatio = params.aspectRatio;
  if (params.resolution) metadata.resolution = params.resolution.toLowerCase();

  if (capability.mode === 'single') {
    const single = grouped.single || grouped.first;
    if (single) body.image = await toUploadHttpUrl(single);
  } else if (capability.mode === 'first_last') {
    if (grouped.first) body.image = await toUploadHttpUrl(grouped.first);
    if (grouped.last) {
      metadata.lastFrame = { url: await toUploadHttpUrl(grouped.last) };
    }
  } else if (capability.mode === 'multi') {
    const refs = grouped.references.slice(0, capability.maxFiles);
    metadata.referenceImages = await Promise.all(
      refs.map(async (f) => ({ url: await toUploadHttpUrl(f) })),
    );
  }

  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  return body;
}

async function generateVideoViaOpenAIOfficial(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpoint = buildEndpoint(baseUrl, 'videos');
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];
  const isVeo = isVeoModel(model);
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', params.prompt);
  form.append('size', isVeo ? toVeoOpenAIVideoSize(params.aspectRatio) : toSoraSize(params.aspectRatio, params.resolution));
  form.append('seconds', String(params.duration || (isVeo ? 8 : 10)));
  if (isVeo) {
    await appendVeoMultipartReferences(form, model, endpointTypes, params.uploadFiles);
  }

  const submitResp = await corsFetch(endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });
  if (!submitResp.ok) {
    throw toHttpError('Sora submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.id || submitData.video_id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('Sora 返回空任务 ID');

  const pollUrl = buildEndpoint(baseUrl, `videos/${taskId}`);
  params.onTaskCreated?.({ taskId: String(taskId), route: 'openai_official', pollUrl, model });
  return pollOpenAIOfficialVideoTask(pollUrl, String(taskId), model, params.signal);
}

async function pollOpenAIOfficialVideoTask(
  pollUrl: string,
  taskId: string,
  model?: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const authHeaders = buildResumeAuthHeaders(model);
  const pollState = createPollState(taskId, pollUrl);
  // 无限轮询：视频生成耗时不定，由用户手动取消或服务端返回失败状态
  while (true) {
    await abortableSleep(VIDEO_POLL_INTERVAL, signal);
    const pollResp = await pollFetchWithRetry(pollUrl, { headers: authHeaders, signal }, pollState, signal);
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData) || `${pollUrl.replace(/\/+$/, '')}/content`;
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(sanitizeErrorMessage(pollData.error?.message || pollData.error || pollData.message || 'Sora 生成失败'));
    }
  }
}

async function generateVideoViaUnified(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const endpointTypes = useAPIConfigStore.getState().modelEndpointTypes[model];

  let body: Record<string, any>;
  if (isVeoModel(model)) {
    body = await buildVeoUnifiedVideoBody(params, model, endpointTypes);
  } else {
    const isLuma = (endpointTypes || []).some(t => /luma/i.test(t));
    const isRunway = (endpointTypes || []).some(t => /runway/i.test(t));
    const isGrok = (endpointTypes || []).some(t => /grok/i.test(t)) || /grok/i.test(model);
    const isSeedance = /seedance|doubao-seedance/i.test(model);
    const usesStructuredSeedanceParams = resolveSeedanceCapability(model).structuredParameters;

    body = { model, prompt: params.prompt };
    const metadata: Record<string, any> = {};

    // Duration: Luma requires string with unit ("5s"), other models use number
    if (params.duration) {
      body.duration = isLuma ? `${params.duration}s` : params.duration;
    }

    // AspectRatio 处理策略（各模型格式不同，按模型分别处理）：
    // - Runway: metadata.ratio（像素格式 1280:720）
    // - Seedance: metadata.ratio（官方格式，如 "16:9"）
    // - Grok: 顶层 aspect_ratio（xAI 官方格式，支持 16:9/9:16/4:3/3:4/3:2/2:3/1:1）
    // - 其他统一格式模型: metadata.aspect_ratio
    if (params.aspectRatio) {
      if (isRunway) {
        metadata.ratio = toRunwayRatio(params.aspectRatio);
      } else if (isSeedance) {
        metadata.ratio = params.aspectRatio;
        if (usesStructuredSeedanceParams || params.aspectRatio === 'adaptive') {
          body.ratio = params.aspectRatio;
        }
      } else if (isGrok) {
        body.aspect_ratio = params.aspectRatio;
      } else {
        metadata.aspect_ratio = params.aspectRatio;
      }
    }

    // Resolution: Grok uses top-level "720p"/"480p"; others via metadata
    if (params.resolution) {
      if (isRunway) {
        // Runway doesn't use resolution field
      } else if (isGrok) {
        body.resolution = params.resolution;
      } else {
        metadata.resolution = params.resolution;
        if (usesStructuredSeedanceParams || params.resolution.toLowerCase() === '4k') {
          body.resolution = params.resolution.toLowerCase();
        }
      }
    }

    if (isSeedance && (usesStructuredSeedanceParams || params.resolution?.toLowerCase() === '4k' || params.aspectRatio === 'adaptive')) {
      body.generate_audio = params.generateAudio ?? true;
      body.watermark = params.watermark ?? false;
    }

    // Image inputs (wan2.6, doubao, luma, vidu, minimax, runway, etc.)
    const grouped = groupVideoUploadFiles(params.uploadFiles);
    if (isSeedance) validateSeedanceVideoParams(model, params, grouped);

    if (isSeedance && grouped.references.length > 0) {
      // Seedance 多功能参考模式（官方格式）：
      // - 图片 → 顶层 images 数组
      // - 视频 → metadata.video_urls 数组
      // - 音频 → metadata.audio_urls 数组
      const imageUrls: string[] = [];
      const videoUrls: string[] = [];
      const audioUrls: string[] = [];
      for (const ref of grouped.references) {
        const url = await toUploadHttpUrl(ref);
        const assetType = ref.assetType || inferAssetType(ref);
        if (assetType === 'video') {
          videoUrls.push(url);
        } else if (assetType === 'audio') {
          audioUrls.push(url);
        } else {
          imageUrls.push(url);
        }
      }
      if (imageUrls.length > 0) body.images = imageUrls;
      if (videoUrls.length > 0) metadata.video_urls = videoUrls;
      if (audioUrls.length > 0) metadata.audio_urls = audioUrls;
    } else if (isSeedance) {
      // Seedance 图生视频模式：首帧/尾帧 → images 数组
      const imageUrls: string[] = [];
      if (grouped.single || grouped.first) {
        imageUrls.push(await toUploadHttpUrl((grouped.single || grouped.first)!));
      }
      if (grouped.last) {
        imageUrls.push(await toUploadHttpUrl(grouped.last));
      }
      if (imageUrls.length > 0) body.images = imageUrls;
    } else {
      // 非 Seedance 模型：原有逻辑
      if (grouped.single || grouped.first) {
        body.image = await toUploadHttpUrl((grouped.single || grouped.first)!);
      }
      if (grouped.last) {
        metadata.image_end = await toUploadHttpUrl(grouped.last);
      }
      // Reference images: vidu参考生视频 and similar models
      if (grouped.references.length > 0) {
        metadata.reference_images = await Promise.all(
          grouped.references.map(async (f) => ({ url: await toUploadHttpUrl(f) }))
        );
      }
    }

    if (Object.keys(metadata).length > 0) body.metadata = metadata;

    if (isSeedance && params.tools?.length) {
      body.tools = params.tools;
    }
  }

  // 直接使用端点类型对应的 URL（绝对路径，从域名根拼接）
  const endpointPaths = getUnifiedEndpointPaths(endpointTypes || []);
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}${endpointPaths.submit}`;

  const resp = await corsFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw toHttpError('Unified video submit failed', resp.status, text);
  }
  const submitData = await resp.json();

  const taskId =
    submitData.task_id ||
    submitData.id ||
    submitData.request_id ||
    submitData.data?.task_id ||
    submitData.data?.id ||
    submitData.response?.task_id ||
    submitData.response?.id ||
    submitData.result?.task_id ||
    submitData.result?.id ||
    submitData.output?.task_id ||
    submitData.output?.id;
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl, taskId: taskId ? String(taskId) : undefined };
  if (!taskId) throw new Error('统一视频接口返回空任务 ID');

  // 轮询：直接使用端点类型对应的 URL（无限轮询，由用户手动取消或服务端返回失败）
  const pollUrl = `${rootBase}${endpointPaths.poll(String(taskId))}`;
  params.onTaskCreated?.({ taskId: String(taskId), route: 'unified', pollUrl, model });
  return pollUnifiedVideoTask(pollUrl, String(taskId), model, params.signal);
}

async function pollUnifiedVideoTask(
  pollUrl: string,
  taskId: string,
  model?: string,
  signal?: AbortSignal,
): Promise<GenerationResult> {
  const authHeaders = buildResumeAuthHeaders(model);
  const pollState = createPollState(taskId, pollUrl);
  while (true) {
    await abortableSleep(VIDEO_POLL_INTERVAL, signal);
    const pollResp = await pollFetchWithRetry(pollUrl, { headers: authHeaders, signal }, pollState, signal);
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || pollData.state || pollData.data?.status || '').toLowerCase();
    if (status === 'completed' || status === 'succeeded' || status === 'success') {
      const videoUrl = extractVideoUrl(pollData);
      if (videoUrl) return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(sanitizeErrorMessage(pollData.error?.message || pollData.error || pollData.message || '视频生成失败'));
    }
  }
}

/**
 * 从文件 MIME 类型或文件名推断素材类型（图片/视频/音频）
 */
function inferAssetType(file: FreedomVideoUploadFile): 'image' | 'video' | 'audio' {
  const mime = (file.mimeType || '').toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  // 根据文件名后缀推断
  const ext = (file.fileName || '').split('.').pop()?.toLowerCase() || '';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac', 'wma'].includes(ext)) return 'audio';
  return 'image';
}

async function generateVideoViaVolc(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const submitPath = buildVolcVideoSubmitPath(baseUrl);
  const resolution = params.resolution?.toLowerCase();
  const ratio = params.aspectRatio;
  const usesSeedanceV2Params = resolveSeedanceCapability(model).structuredParameters
    || resolution === '4k'
    || ratio === 'adaptive';
  const promptParts = [params.prompt];
  if (!usesSeedanceV2Params) {
    if (resolution) promptParts.push(`--rs ${resolution}`);
    if (ratio) promptParts.push(`--rt ${ratio}`);
    if (params.duration) promptParts.push(`--dur ${params.duration}`);
  }

  const content: Array<Record<string, unknown>> = [
    { type: 'text', text: promptParts.join(' ') },
  ];

  // 附加上传图片（首帧/尾帧），对齐 Director 面板的 callVolcVideoApi
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  validateSeedanceVideoParams(model, params, grouped);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) {
    const url = await toUploadHttpUrl(primaryFile);
    content.push({ type: 'image_url', image_url: { url }, role: 'first_frame' });
  }
  if (grouped.last) {
    const url = await toUploadHttpUrl(grouped.last);
    content.push({ type: 'image_url', image_url: { url }, role: 'last_frame' });
  }

  // 多功能参考素材（Seedance 2.0 多模态：图片/视频/音频引用）
  if (grouped.references.length > 0) {
    for (const ref of grouped.references) {
      const url = await toUploadHttpUrl(ref);
      const assetType = ref.assetType || inferAssetType(ref);
      if (assetType === 'video') {
        content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' });
      } else if (assetType === 'audio') {
        content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' });
      } else {
        // 默认按图片处理；火山方舟原生要求 image 必须带 role
        content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
      }
    }
  }

  const body: Record<string, any> = { model, content };
  if (usesSeedanceV2Params) {
    body.generate_audio = params.generateAudio ?? true;
    if (resolution) body.resolution = resolution;
    if (ratio) body.ratio = ratio;
    if (params.duration) body.duration = params.duration;
    body.watermark = params.watermark ?? false;
  }
  if (params.tools?.length) {
    body.tools = params.tools;
  }

  console.log('[Freedom] Volc submit →', submitPath, { model });
  const submitResp = await corsFetch(submitPath, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: params.signal,
  });
  if (!submitResp.ok) {
    throw toHttpError('Volc submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await readJsonResponse<{ id?: string }>(submitResp, 'Volc submit');
  const taskId = submitData.id;
  if (!taskId) throw new Error('Volc 返回空任务 ID');

  const pollUrl = `${submitPath}/${taskId}`;
  params.onTaskCreated?.({ taskId: String(taskId), route: 'volc', pollUrl, model });
  return pollVolcVideoTask(pollUrl, params.signal, model);
}

async function pollVolcVideoTask(
  pollUrl: string,
  signal?: AbortSignal,
  model?: string,
): Promise<GenerationResult> {
  const authHeaders = buildResumeAuthHeaders(model);
  // 无限轮询：Seedance/Doubao 多模态参考耗时不定，不再设超时上限，
  // 间隔保持 5s 减少无效请求，由用户手动取消或服务端返回失败状态。
  const VOLC_POLL_INTERVAL = 5000;
  const pollState = createPollState(pollUrl.split('/').filter(Boolean).pop(), pollUrl);
  while (true) {
    await abortableSleep(VOLC_POLL_INTERVAL, signal);
    const pollResp = await pollFetchWithRetry(pollUrl, { headers: authHeaders, signal }, pollState, signal);
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded' || status === 'completed' || status === 'success') {
      const videoUrl = pollData.content?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Volc 成功但无视频 URL');
      const taskId = pollUrl.split('/').filter(Boolean).pop();
      return { url: videoUrl, taskId: taskId ? String(taskId) : undefined };
    }
    if (status === 'failed' || status === 'expired' || status === 'cancelled' || status === 'error') {
      throw new Error(sanitizeErrorMessage(pollData.error?.message || pollData.error || 'Volc 视频生成失败'));
    }
  }
}

async function generateVideoViaWan(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const isHappyHorse = model.toLowerCase().includes('happyhorse');

  // HappyHorse 参考生视频（multi-reference with images）
  const references = (params.uploadFiles || []).filter((f) => f.role === 'reference');
  if (isHappyHorse && references.length > 0) {
    return generateVideoViaHappyHorseR2V(params, references, apiKey, rootBase);
  }

  const body: Record<string, any> = {
    model,
    input: { prompt: params.prompt },
    parameters: {
      resolution: (params.resolution || '720P').toUpperCase(),
      prompt_extend: true,
      audio: true,
    },
  };
  if (params.duration) body.parameters.duration = Math.max(3, params.duration);

  const submitResp = await corsFetch(
    `${rootBase}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  );
  if (!submitResp.ok) {
    throw toHttpError('Wan submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('Wan 返回空任务 ID');

  const pollUrl = `${rootBase}/alibailian/api/v1/tasks/${taskId}`;
  params.onTaskCreated?.({ taskId: String(taskId), route: 'unified', pollUrl, model });
  const pollState = createPollState(String(taskId), pollUrl);
  // 无限轮询：Wan 视频生成不再设超时上限，由服务端返回完成/失败状态。
  while (true) {
    await abortableSleep(VIDEO_POLL_INTERVAL, params.signal);
    const pollResp = await pollFetchWithRetry(
      pollUrl,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: params.signal },
      pollState,
      params.signal,
    );
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const videoUrl = pollData.output?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Wan 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      throw new Error(sanitizeErrorMessage(pollData.output?.message || pollData.output?.error || 'Wan 视频生成失败'));
    }
  }
}

/**
 * HappyHorse 参考生视频（Reference-to-Video）
 * API 文档: https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference
 * - 模型固定为 happyhorse-1.0-r2v
 * - input.media 数组传入 { type: "reference_image", url: "..." } 对象
 * - prompt 中通过 [Image 1]、[Image 2] 指代 media 数组中对应的参考图
 * - 需要 X-DashScope-Async: enable 头
 */
async function generateVideoViaHappyHorseR2V(
  params: FreedomVideoParams,
  references: FreedomVideoUploadFile[],
  apiKey: string,
  rootBase: string,
): Promise<GenerationResult> {
  // 将参考图片上传为 HTTP URL
  const imageUrls: string[] = await Promise.all(
    references.map((ref) => toUploadHttpUrl(ref)),
  );

  const body: Record<string, any> = {
    model: 'happyhorse-1.0-r2v',
    input: {
      prompt: params.prompt,
      media: imageUrls.map((url) => ({ type: 'reference_image', url })),
    },
    parameters: {} as Record<string, any>,
  };

  // 分辨率
  const resolution = (params.resolution || '1080P').toUpperCase();
  body.parameters.resolution = resolution === '720P' ? '720P' : '1080P';

  // 宽高比：API 支持 16:9、9:16、3:4、4:3、1:1
  if (params.aspectRatio) {
    body.parameters.ratio = params.aspectRatio;
  }

  // 时长：3~15 秒整数，默认 5
  if (params.duration) {
    body.parameters.duration = Math.max(3, Math.min(15, params.duration));
  }

  // 不添加水印
  body.parameters.watermark = false;

  const submitResp = await corsFetch(
    `${rootBase}/alibailian/api/v1/services/aigc/video-generation/video-synthesis`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: JSON.stringify(body),
    },
  );
  if (!submitResp.ok) {
    throw toHttpError('HappyHorse R2V submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.output?.task_id;
  if (!taskId) throw new Error('HappyHorse R2V 返回空任务 ID');

  // 无限轮询（参考生视频耗时不定，不再设超时上限，由用户手动取消或服务端返回完成/失败）
  const POLL_INTERVAL = 5000;
  const pollUrl = `${rootBase}/alibailian/api/v1/tasks/${taskId}`;
  params.onTaskCreated?.({ taskId: String(taskId), route: 'unified', pollUrl, model: params.model || '' });
  const pollState = createPollState(String(taskId), pollUrl);

  while (true) {
    await abortableSleep(POLL_INTERVAL, params.signal);
    const pollResp = await pollFetchWithRetry(
      pollUrl,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: params.signal },
      pollState,
      params.signal,
    );
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.output?.task_status || '').toUpperCase();
    if (status === 'SUCCEEDED' || status === 'COMPLETED') {
      const videoUrl = pollData.output?.video_url || extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('HappyHorse R2V 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'FAILED' || status === 'ERROR' || status === 'CANCELLED') {
      throw new Error(sanitizeErrorMessage(pollData.output?.message || pollData.output?.error || 'HappyHorse 参考生视频失败'));
    }
  }
}

// Native Kling endpoint paths (relative to /kling/v1/videos/)
// kling-video is handled dynamically: text2video vs image2video based on uploads
const KLING_VIDEO_PATH_MAP: Record<string, string> = {
  'kling-omni-video': 'omni-video',
  'kling-video-extend': 'video-extend',
  'kling-motion-control': 'motion-control',
  'kling-multi-elements': 'multi-elements',
  'kling-avatar-image2video': 'avatar/image2video',
  'kling-advanced-lip-sync': 'advanced-lip-sync',
  'kling-effects': 'effects',
};

async function generateVideoViaKling(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const uploads = params.uploadFiles || [];
  const firstFrame = uploads.find((f) => f.role === 'single' || f.role === 'first');
  const lastFrame = uploads.find((f) => f.role === 'last');

  // Determine the endpoint path
  // Specialized models have a fixed path; all kling-video variants (kling-v2-1-master,
  // kling-v2-6-pro, kling-v3-0-pro, etc.) fall through to text2video / image2video.
  let endpointPath: string;
  const specialPath = KLING_VIDEO_PATH_MAP[model];
  if (specialPath) {
    endpointPath = specialPath;
  } else {
    endpointPath = firstFrame ? 'image2video' : 'text2video';
  }

  const body: Record<string, any> = {
    model_name: resolveKlingModelName(model),
    prompt: params.prompt,
    aspect_ratio: params.aspectRatio || '16:9',
    duration: String(params.duration ? Math.min(10, Math.max(5, params.duration)) : 5),
    mode: 'std',
  };

  // Attach image URLs for image-based endpoints
  if (endpointPath === 'image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
    if (lastFrame) body.tail_image_url = await toUploadHttpUrl(lastFrame);
  } else if (endpointPath === 'avatar/image2video' && firstFrame) {
    body.image_url = await toUploadHttpUrl(firstFrame);
  }

  const submitUrl = `${rootBase}/kling/v1/videos/${endpointPath}`;
  const submitResp = await corsFetch(submitUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!submitResp.ok) {
    throw toHttpError('Kling submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const taskId = submitData.data?.task_id;
  if (!taskId) throw new Error('Kling 返回空任务 ID');

  // Poll URL mirrors the submit path: GET /kling/v1/videos/{path}/{task_id}
  const pollUrl = `${rootBase}/kling/v1/videos/${endpointPath}/${taskId}`;
  params.onTaskCreated?.({ taskId: String(taskId), route: 'unified', pollUrl, model: model || params.model || '' });
  const pollState = createPollState(String(taskId), pollUrl);
  // 无限轮询：Kling 视频生成耗时不定，不再设超时上限。
  while (true) {
    await abortableSleep(VIDEO_POLL_INTERVAL, params.signal);
    const pollResp = await pollFetchWithRetry(
      pollUrl,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: params.signal },
      pollState,
      params.signal,
    );
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.data?.task_status || '').toLowerCase();
    if (status === 'succeed' || status === 'success' || status === 'completed') {
      const videoUrl =
        pollData.data?.task_result?.videos?.[0]?.url ||
        pollData.data?.task_result?.video_url ||
        extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Kling 成功但无视频 URL');
      return { url: videoUrl, taskId: String(taskId) };
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(sanitizeErrorMessage(pollData.data?.task_status_msg || pollData.message || 'Kling 视频生成失败'));
    }
  }
}

/**
 * Generate video via Replicate's /replicate/v1/predictions endpoint
 * Request body: { model, input: { prompt, aspect_ratio, ... } }
 * Poll until status === 'succeeded' / 'failed' / 'canceled'
 */
async function generateVideoViaReplicate(
  params: FreedomVideoParams,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<GenerationResult> {
  const rootBase = getRootBaseUrl(baseUrl);
  const submitUrl = `${rootBase}/replicate/v1/predictions`;

  const input: Record<string, any> = { prompt: params.prompt };
  if (params.aspectRatio) input.aspect_ratio = params.aspectRatio;
  if (params.duration) input.duration = params.duration;
  if (params.resolution) input.resolution = params.resolution;

  // Image-to-video: attach upload files inside input
  const grouped = groupVideoUploadFiles(params.uploadFiles);
  const primaryFile = grouped.single || grouped.first;
  if (primaryFile) input.image = await toUploadHttpUrl(primaryFile);
  if (grouped.last) input.tail_image = await toUploadHttpUrl(grouped.last);

  const submitResp = await corsFetch(submitUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input }),
  });
  if (!submitResp.ok) {
    throw toHttpError('Replicate video submit failed', submitResp.status, await submitResp.text());
  }

  const submitData = await submitResp.json();
  const directUrl = extractVideoUrl(submitData);
  if (directUrl) return { url: directUrl };

  const predictionId = submitData.id;
  if (!predictionId) throw new Error('Replicate 返回空 prediction ID');

  const pollUrl = `${rootBase}/replicate/v1/predictions/${predictionId}`;
  params.onTaskCreated?.({ taskId: String(predictionId), route: 'unified', pollUrl, model: model || params.model || '' });
  const pollState = createPollState(String(predictionId), pollUrl);
  // 无限轮询：Replicate 视频生成耗时不定，不再设超时上限。
  while (true) {
    await abortableSleep(VIDEO_POLL_INTERVAL, params.signal);
    const pollResp = await pollFetchWithRetry(
      pollUrl,
      { headers: { 'Authorization': `Bearer ${apiKey}` }, signal: params.signal },
      pollState,
      params.signal,
    );
    if (!pollResp) continue;
    const pollData = await pollResp.json();
    const status = String(pollData.status || '').toLowerCase();
    if (status === 'succeeded') {
      const videoUrl = extractVideoUrl(pollData);
      if (!videoUrl) throw new Error('Replicate 成功但未返回视频 URL');
      return { url: videoUrl, taskId: String(predictionId) };
    }
    if (status === 'failed' || status === 'canceled') {
      throw new Error(sanitizeErrorMessage(pollData.error || 'Replicate 视频生成失败'));
    }
  }
}

// ==================== Helpers ====================

function extractImageUrl(data: any): string | null {
  // Handle multiple response formats
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  if (data.url) return data.url;
  if (data.output?.url) return data.output.url;
  // Replicate: output as direct string URL or array of URLs
  if (typeof data.output === 'string' && data.output.startsWith('http')) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === 'string') return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  // Chat completions format
  if (data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content;
    const mdMatch = content.match(/!\[.*?\]\((https?:\/\/[^)]+)\)/);
    if (mdMatch) return mdMatch[1];
    if (content.startsWith('http')) return content.trim();
  }
  return null;
}

function extractVideoUrl(data: any): string | null {
  if (data.data?.[0]?.url) return data.data[0].url;
  if (data.url) return data.url;
  if (data.output?.url) return data.output.url;
  // Replicate: output as direct string URL or array of URLs (minimax/video-01, etc.)
  if (typeof data.output === 'string' && data.output.startsWith('http')) return data.output;
  if (Array.isArray(data.output) && typeof data.output[0] === 'string') return data.output[0];
  if (data.outputs?.[0]) return data.outputs[0];
  if (data.video_url) return data.video_url;
  if (data.response?.url) return data.response.url;  // doubao, jimeng, grok, wan2.6
  return null;
}

async function pollForResult(
  pollUrl: string,
  apiKey: string,
  interval: number,
  maxAttempts: number,
  onProgress?: (info: FreedomProgress) => void,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await abortableSleep(interval, signal);

    try {
      const response = await corsFetch(pollUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal,
      });

      if (!response.ok) continue;

      const data = await response.json();
      const status = (data.status || data.state || '').toLowerCase();
      // 服务器进度（0-100）若有则优先采用
      const serverPct = typeof data.progress === 'number'
        ? (data.progress > 1 ? data.progress : data.progress * 100)
        : (typeof data.percent === 'number' ? data.percent : undefined);

      // Check completion - triple status normalization from Higgsfield
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        onProgress?.({ phase: 'finalizing', percent: 90, message: '已完成，下载结果…' });
        return extractImageUrl(data) || extractVideoUrl(data);
      }

      // Check failure
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        throw new Error(sanitizeErrorMessage(`Generation failed: ${data.error || data.message || status}`));
      }

      // Still processing — 估算进度：25% 起步，逐步增长到 80%
      const estimated = 25 + Math.min(55, Math.round((i / maxAttempts) * 60));
      const percent = Math.max(estimated, Math.round(serverPct ?? 0));
      onProgress?.({
        phase: 'processing',
        percent: Math.min(85, percent),
        message: status ? `状态：${status}` : `生成中… (${i + 1}/${maxAttempts})`,
      });
      console.log(`[Freedom] Polling attempt ${i + 1}/${maxAttempts}, status: ${status}`);
    } catch (err: any) {
      if (err instanceof FreedomCancelledError) throw err;
      if (err?.name === 'AbortError') throw new FreedomCancelledError();
      if (err.message?.startsWith('Generation failed')) throw err;
      console.warn(`[Freedom] Poll error (attempt ${i + 1}):`, err.message);
    }
  }

  return null;
}

function saveToMediaLibrary(
  url: string,
  prompt: string,
  source: 'ai-image' | 'ai-video',
  projectId?: string | null,
): string | undefined {
  try {
    const mediaStore = useMediaStore.getState();
    const activeProjectId = useProjectStore.getState().activeProjectId;
    const targetProjectId = projectId ?? activeProjectId;
    const name = prompt.slice(0, 30).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') || 'freedom';
    const type = source === 'ai-image' ? 'image' : 'video';
    const mediaName = `${name}_${Date.now()}`;

    // 生成任务是后台异步的：若用户在生成期间切换了项目，此时的 activeProjectId
    // 已经不是发起任务时的项目。直接写内存 store 会被 split storage 按当前激活
    // 项目路由，导致图片落到别的项目文件夹。这里改为直接写入目标项目的文件。
    if (targetProjectId && activeProjectId && targetProjectId !== activeProjectId) {
      console.log('[Freedom] Project switched during generation, saving media to original project:', targetProjectId);
      void mediaStore.addMediaFromUrlToProject({
        url,
        name: mediaName,
        type: type as any,
        source,
        projectId: targetProjectId,
      });
      return undefined;
    }

    const mediaId = mediaStore.addMediaFromUrl({
      url,
      name: mediaName,
      type: type as any,
      source,
      projectId: targetProjectId || undefined,
    });

    return mediaId;
  } catch (err) {
    console.warn('[Freedom] Failed to save to media library:', err);
    return undefined;
  }
}
