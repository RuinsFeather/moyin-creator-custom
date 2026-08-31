// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard analysis service (AI 完整剧本拆镜)
 *
 * 一次分析当前单集、单场剧本，输出不含 集/场、首尾帧和提示词 的分镜镜头。
 * 关键约束（来自重构计划）：
 *   - 失败不覆盖现有分镜（先做快照，成功才应用）
 *   - 可取消 / 重试 / 失败恢复
 *   - 参考项（角色/服装/场景）与角色库、场景库做名称匹配
 */
import { callFeatureAPI } from "@/lib/ai/feature-router";
import { parseStoryboardResponse } from "./storyboard-response-parser";
import { validateShotBatch } from "./storyboard-validator";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import type {
  StoryboardAnalysisJob,
  StoryboardDocument,
  StoryboardReferenceItem,
  StoryboardShot,
  StoryboardShotContent,
} from "@/types/storyboard";

export interface AnalyzeOptions {
  /** 覆盖模型（可选） */
  modelOverride?: string;
  /** 每次校验失败后最大重试次数，默认 1 */
  maxRetries?: number;
  /** 分析时参考的上下文（角色名、场景名等提示） */
  context?: string;
}

export interface AnalyzeResult {
  ok: boolean;
  jobId: string;
  shotCount: number;
  error?: string;
}

// 模块级取消机制：jobId -> 是否取消
const cancelFlags = new Map<string, boolean>();

/**
 * 长剧本按段落分批的字符上限（§14 风险：单份剧本内容过长）。
 * 超过该长度时服务层按段落分批分析并在返回前合并镜头，UI 仍保持一张分镜表。
 */
export const SCRIPT_CHUNK_CHAR_LIMIT = 12000;

/**
 * 将剧本按段落切分为不超过字符上限的若干块。
 * 以空行（\n\n）为主的自然分段，尽量保持段落完整；单个超长段落硬切。
 * 导出以便测试。
 */
export function splitScriptIntoChunks(
  content: string,
  limit: number = SCRIPT_CHUNK_CHAR_LIMIT,
): string[] {
  if (!content) return [];
  const text = content.trim();
  if (!text) return [];
  if (text.length <= limit) return [text];

  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    // 单段超长：硬切
    if (para.length > limit) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < para.length; i += limit) {
        chunks.push(para.slice(i, i + limit));
      }
      continue;
    }

    if (current.length + para.length + 1 > limit) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() || `sb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function uidCounter() {
  return createId();
}

/** 取消当前分析任务 */
export function cancelStoryboardAnalysis(jobId: string): void {
  cancelFlags.set(jobId, true);
}

/** 是否已取消 */
function isCancelled(jobId: string): boolean {
  return cancelFlags.get(jobId) === true;
}

function markRunning(jobId: string): void {
  cancelFlags.set(jobId, false);
}

function throwIfCancelled(jobId: string): void {
  if (isCancelled(jobId)) {
    throw new Error("分析已取消");
  }
}

/**
 * 从角色库获取当前项目角色名列表（用于名称匹配）。
 */
function getCharacterNames(): string[] {
  try {
    const characterStore = useCharacterLibraryStore.getState();
    const list = characterStore.characters || [];
    return list.map((c) => c.name).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 从场景库获取当前项目场景名列表。
 */
function getSceneNames(): string[] {
  try {
    const sceneStore = useSceneStore.getState();
    const list = sceneStore.scenes || [];
    return list.map((s) => s.name).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 将 AI 返回的字符串引用项匹配到库内名称（精确匹配优先，包含匹配兜底）。
 */
function matchReference(
  raw: string[] = [],
  knownNames: string[],
): StoryboardReferenceItem[] {
  const used = new Set<string>();
  const result: StoryboardReferenceItem[] = [];
  const known = knownNames.map((n) => n.trim()).filter(Boolean);

  for (const r of raw) {
    const name = r.trim();
    if (!name || used.has(name)) continue;

    // 精确匹配
    const exact = known.find((k) => k === name);
    // 包含匹配：库内名称是引用的子串 或 引用是库内名称的子串
    const contains = !exact && known.find((k) => name.includes(k) || k.includes(name));

    const matched = exact || contains;
    if (matched) {
      used.add(name);
      result.push({
        id: uidCounter(),
        name,
        source: "library",
      });
    } else {
      used.add(name);
      result.push({
        id: uidCounter(),
        name,
        source: "ai-suggestion",
      });
    }
  }
  return result;
}

/**
 * 构建每个镜头的 StoryboardShot（分配 ID、references 匹配库）。
 */
function buildShots(
  parsedShots: Array<{ content: StoryboardShotContent; references?: any; sourceText?: string }>,
): StoryboardShot[] {
  const characterNames = getCharacterNames();
  const sceneNames = getSceneNames();
  const now = Date.now();

  return parsedShots.map((p, i) => {
    const refs = p.references || {};
    const characters = matchReference(refs.characters, characterNames);
    const scenes = matchReference(refs.scenes, sceneNames);
    // 服装库暂未统一，先作为 ai-suggestion
    const costumes = (refs.costumes || []).map((name: string) => ({
      id: uidCounter(),
      name,
      source: "ai-suggestion" as const,
    }));

    return {
      id: uidCounter(),
      order: i,
      shotNumber: String(i + 1),
      content: p.content,
      references: { characters, costumes, scenes },
      notes: "",
      referenceImages: [],
      origin: "ai" as const,
      reviewStatus: "pending" as const,
      createdAt: now,
      updatedAt: now,
      sourceText: p.sourceText,
    };
  });
}

/**
 * 构建 AI 系统提示词（严格约束：不含集/场/首尾帧/提示词）。
 */
export function buildSystemPrompt(): string {
  return `你是专业的影视分镜师。请根据给定的单集、单场剧本，将其拆解为一组连续的分镜镜头。

【硬性要求】
1. 只针对当前输入的这份剧本进行拆镜，不要涉及其他集、场。
2. 不要输出任何 "集"、"场" 的层级信息。
3. 不要输出任何图片提示词（imagePrompt）、首尾帧提示词（endFramePrompt）或视频提示词（videoPrompt）。
4. 不要输出任何 Base64 图片、图片 URL 或视频 URL。
5. 每个镜头只描述画面内容、场景、动作、对白、景别、镜头运动，不负责生成图像或视频。

【输出格式】
必须严格输出一个 JSON 数组，不要输出任何解释文字。数组每一项结构如下：
[
  {
    "content": {
      "summary": "本镜头画面内容的一句话概述",
      "scene": "发生场景，尽量使用给定的角色/场景库中的名称",
      "action": "镜头内主要动作",
      "dialogue": "若本镜头有对白，放剧本原文；否则空字符串",
      "shotSize": "景别：特写/近景/中景/全景/远景",
      "cameraMovement": "镜头运动：固定/推/拉/摇/移/跟",
      "durationSeconds": 3,
      "additionalDescription": "补充视觉或氛围描述，可选"
    },
    "references": {
      "characters": ["出现的角色名"],
      "costumes": ["出现的服装名"],
      "scenes": ["出现的场景名"]
    },
    "sourceText": "从剧本中摘取的对应原文，可选"
  }
]

请确保镜头之间逻辑连贯，覆盖剧本全部关键情节，不要遗漏。`;
}

/**
 * 构建用户提示词。
 */
export function buildUserPrompt(
  scriptContent: string,
  context?: string,
  shotCountHint?: number,
): string {
  const hint = shotCountHint ? `\n【目标镜头数】约 ${shotCountHint} 个镜头，可根据剧情灵活调整。` : "";
  const ctx = context ? `\n【参考上下文】\n${context}\n` : "";
  return `【剧本】\n${scriptContent}\n${ctx}${hint}\n\n请按上述要求输出 JSON 数组。`;
}

/**
 * 创建分析任务并开始执行。
 * 返回立即的 jobId；结果通过 store 的 analysisJob 更新。
 */
export async function startStoryboardAnalysis(
  scriptContent: string,
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const store = useStoryboardStore.getState();
  const doc = store.document;
  if (!doc) {
    return { ok: false, jobId: "", shotCount: 0, error: "没有可分镜文档，请先从项目导入剧本" };
  }
  if (!scriptContent || !scriptContent.trim()) {
    return { ok: false, jobId: "", shotCount: 0, error: "剧本内容为空" };
  }

  const jobId = uidCounter();
  markRunning(jobId);

  // 快照：AI 成功前不覆盖现有分镜
  const snapshot = doc;
  const startedAt = Date.now();
  const job: StoryboardAnalysisJob = {
    id: jobId,
    status: "running",
    progress: 0,
    message: "开始拆镜…",
    startedAt,
    snapshot,
  };
  store.setAnalysisJob(job);
  store.setStatus("analyzing");

  const maxRetries = options.maxRetries ?? 1;

  try {
    const systemPrompt = buildSystemPrompt();
    const chunks = splitScriptIntoChunks(scriptContent);
    const totalChunks = chunks.length;

    if (totalChunks <= 1) {
      // 短剧本：单次完整分析（原有语义）
      const userPrompt = buildUserPrompt(scriptContent, options.context);
      const newShots = await analyzeChunk(jobId, systemPrompt, userPrompt, maxRetries, 1, 1);
      applyShots(newShots);
      store.setAnalysisProgress({
        status: "succeeded",
        progress: 100,
        message: `拆镜完成，共 ${newShots.length} 个镜头`,
        finishedAt: Date.now(),
      });
      store.setStatus("review");
      return { ok: true, jobId, shotCount: newShots.length };
    }

    // 长剧本：按段落分批分析并在返回前合并镜头（UI 仍保持一张分镜表）
    const allShots: StoryboardShot[] = [];
    for (let b = 0; b < totalChunks; b++) {
      throwIfCancelled(jobId);
      const chunk = chunks[b];
      store.setAnalysisProgress({
        progress: Math.round((b / totalChunks) * 80),
        message: `正在分析剧本第 ${b + 1}/${totalChunks} 段…`,
      });
      // 每批提示词标注当前段范围，保证批次间无 集/场 层级
      const userPrompt =
        `当前分析的是剧本第 ${b + 1}/${totalChunks} 段，请只基于这段剧本拆镜，` +
        `不要输出任何 "集"、"场" 层级信息，不要输出图片/首尾帧/视频提示词。\n\n` +
        buildUserPrompt(chunk, options.context);
      const batchShots = await analyzeChunk(
        jobId,
        systemPrompt,
        userPrompt,
        maxRetries,
        b + 1,
        totalChunks,
      );
      allShots.push(...batchShots);
    }

    // 按顺序重排镜头号（各批内部是 1..n，合并后需连续）
    const mergedShots = allShots.map((s, i) => ({
      ...s,
      order: i,
      shotNumber: String(i + 1),
    }));
    applyShots(mergedShots);
    store.setAnalysisProgress({
      status: "succeeded",
      progress: 100,
      message: `拆镜完成，共 ${mergedShots.length} 个镜头（${totalChunks} 段合并）`,
      finishedAt: Date.now(),
    });
    store.setStatus("review");
    return { ok: true, jobId, shotCount: mergedShots.length };
  } catch (e) {
    const cancelled = isCancelled(jobId);
    const errMsg = cancelled
      ? "分析已取消"
      : `拆镜失败：${(e as Error).message || "未知错误"}`;

    // 失败/取消：恢复快照（不覆盖现有分镜）
    restoreSnapshot(jobId, snapshot);
    store.setAnalysisProgress({
      status: cancelled ? "cancelled" : "failed",
      progress: 0,
      message: cancelled ? "已取消" : "拆镜失败",
      error: errMsg,
      finishedAt: Date.now(),
    });
    if (!cancelled) {
      store.setStatus(snapshot?.status || "draft");
    }
    return { ok: false, jobId, shotCount: 0, error: errMsg };
  } finally {
    cancelFlags.delete(jobId);
  }
}

/**
 * 将 AI 结果应用到 store（整体替换 shots）。
 */
function applyShots(shots: StoryboardShot[]): void {
  const store = useStoryboardStore.getState();
  const doc = store.document;
  if (!doc) return;
  useStoryboardStore.setState({
    document: {
      ...doc,
      shots,
      updatedAt: Date.now(),
    },
    dirty: true,
  });
}

/**
 * 对单个分块执行一次拆镜（含解析/校验失败重试与取消检查）。
 * 返回该块产出的 StoryboardShot[]。
 */
async function analyzeChunk(
  jobId: string,
  systemPrompt: string,
  userPrompt: string,
  maxRetries: number,
  chunkIndex: number,
  totalChunks: number,
): Promise<StoryboardShot[]> {
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfCancelled(jobId);
    if (attempt > 0) {
      // 重试进度
    }
    const rawText = await callFeatureAPI("script_analysis", systemPrompt, userPrompt, {
      maxTokens: 16384,
      temperature: 0.4,
    });
    throwIfCancelled(jobId);

    const parsed = parseStoryboardResponse(rawText);
    if (!parsed.ok) {
      lastError = parsed.error || "无法解析 AI 拆镜结果";
      if (attempt < maxRetries) continue;
      throw new Error(`第 ${chunkIndex}/${totalChunks} 段解析失败：${lastError}`);
    }

    const validation = validateShotBatch(parsed.shots);
    if (!validation.valid) {
      lastError = validation.error || "AI 拆镜结果未通过校验";
      if (attempt < maxRetries) continue;
      throw new Error(`第 ${chunkIndex}/${totalChunks} 段未通过校验：${lastError}`);
    }

    // 成功：构建该块镜头
    return buildShots(parsed.shots);
  }
  throw new Error(`第 ${chunkIndex}/${totalChunks} 段拆镜失败：${lastError || "未知错误"}`);
}

/**
 * 失败/取消时恢复快照。
 */
function restoreSnapshot(jobId: string, snapshot: StoryboardDocument | null): void {
  const store = useStoryboardStore.getState();
  if (!snapshot) return;
  const currentJob = store.analysisJob;
  if (currentJob && currentJob.id !== jobId) return;
  useStoryboardStore.setState({
    document: snapshot,
    dirty: false,
  });
}