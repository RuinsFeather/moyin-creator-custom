// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard analysis service (AI 完整剧本拆镜)
 *
 * 阶段 3 重构：画面级精细拆分。
 * 链路：解析六类语法 → 提取源单元/视觉事件 → 按场次与事件组分批 →
 *       预算感知生成 → 源覆盖审计 → 定向修复 → 全局原子发布。
 * 关键约束（来自重构计划）：
 *   - 失败不覆盖现有分镜（先做快照，成功才应用）
 *   - 可取消 / 重试 / 失败恢复
 *   - 参考项（角色/服装/场景）与角色库、场景库做名称匹配
 */
import { callFeatureAPI } from "@/lib/ai/feature-router";
import { parseStoryboardResponse } from "./storyboard-response-parser";
import { validateShotBatch } from "./storyboard-validator";
import { SHOT_SIZE_VALUES, CAMERA_MOVEMENT_VALUES } from "./shot-options";
import { parseScriptSyntax } from "./script-syntax-parser";
import { extractSourceUnits } from "./storyboard-visual-events";
import { auditSourceCoverage } from "./storyboard-coverage-audit";
import { validateWithSkillRules } from "./skill-validator";
import type { SourceUnit, ShotDraft, CoverageAuditResult } from "./storyboard-source-contract";
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
 * 长剧本按段落分批的字符上限（兼容保留）。
 * 阶段 3 中分批不再以字符硬切，而是按场次与事件组；此常量仅作兜底预算参考。
 */
export const SCRIPT_CHUNK_CHAR_LIMIT = 8000;
/** 单批源单元数上限（预算感知的保守默认） */
const MAX_UNITS_PER_BATCH = 12;
/** 定向修复每单元最大重试次数 */
const MAX_REPAIR_RETRIES = 2;

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
  parsedShots: Array<{
    content: StoryboardShotContent;
    references?: any;
    sourceText?: string;
    sourceUnitIds?: string[];
    dialogueSlices?: Array<{ unitId: string; start: number; end: number }>;
    sourceRanges?: Array<{ start: number; end: number }>;
  }>,
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

    const continuous =
      p.sourceRanges && p.sourceRanges.length === 1 ? p.sourceRanges[0] : undefined;

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
      sourceTextRange: continuous,
    };
  });
}

/**
 * 构建 AI 系统提示词（阶段 3：画面节拍 + 六类语法 + 对白语义规则）。
 */
export function buildSystemPrompt(): string {
  return `你是专业的影视分镜师。请根据给定的单集、单场剧本，按画面变化拆解为一组连续的分镜镜头。

【硬性要求】
1. 只针对当前输入的这份剧本进行拆镜，不要涉及其他集、场。
2. 不要输出任何 "集"、"场" 的层级信息。
3. 不要输出任何图片提示词（imagePrompt）、首尾帧提示词（endFramePrompt）或视频提示词（videoPrompt）。
4. 不要输出任何 Base64 图片、图片 URL 或视频 URL。
5. 每个镜头只描述画面内容、场景、动作、对白、景别、镜头运动，不负责生成图像或视频。

【拆分原则】
1. 一个镜头对应一个在同一时空中连续发生、可独立拍摄的视觉节拍。
2. 先拆视觉事件链，再绑定对白：建立 → 发起 → 显现 → 作用 → 结果 → 反应。
3. 出现以下情况必须拆分：地点/时间变化、主要可见主体改变、主体状态不可逆变化、
   新威胁/新角色/关键道具/字幕/转场/特效首次显现、动作从发起进入命中/作用或从作用进入结果/反应。
4. 对白绑定到说话发生时的画面，不因说话人变化机械切镜；同一连续画面内的问答可合并。
5. 画外音、字幕、转场和特效必须挂到实际画面上，不能单独构成空镜头。
6. 镜头数量由视觉节拍覆盖决定，不设固定配额；长复合动作要细拆，短而不可再分的动作保持完整。

【输出格式】
必须严格输出一个 JSON 数组，不要输出任何解释文字。数组每一项结构如下：
[
  {
    "content": {
      "scene": "发生场景，尽量使用给定的角色/场景库中的名称",
      "action": "镜头内主要动作",
      "dialogue": "若本镜头有对白，放剧本原文；否则空字符串",
      "shotSize": "景别：${SHOT_SIZE_VALUES.join("/")}",
      "cameraMovement": "镜头运动：${CAMERA_MOVEMENT_VALUES.join("/")}",
      "durationSeconds": 3,
      "additionalDescription": "补充视觉或氛围描述，可选"
    },
    "references": {
      "characters": ["出现的角色名"],
      "costumes": ["出现的服装名"],
      "scenes": ["出现的场景名"]
    },
    "sourceUnitIds": ["本镜头覆盖的源单元 ID（来自输入）"],
    "dialogueSlices": [{"unitId": "对白单元ID", "start": 该片段在整篇剧本中的绝对起始偏移, "end": 绝对结束偏移}],
    "sourceText": "从剧本中摘取的对应原文，可选"
  }
]

【禁止输出字段】
不要输出 "summary" 字段，画面内容直接由 scene + action 表达。

【输出规模约束】
1. 镜头数量由视觉节拍决定，不设固定数量；每个镜头的 action 必须非空且可拍摄。
2. 必须输出完整、可直接 JSON.parse 的数组，结尾必须包含对应的 ] 和 }，不要在半个镜头中结束。
3. 不要输出 Markdown 代码围栏、注释或任何 JSON 之外的文字。

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
 * 构建批次用户提示：带源单元 ID、原文范围与场次，明确"仅输出本批"。
 */
export function buildBatchUserPrompt(
  units: SourceUnit[],
  scriptContent: string,
  context?: string,
): string {
  const unitLines = units
    .filter((u) => u.required)
    .map((u) => {
      const text = scriptContent
        .slice(u.sourceRange.start, u.sourceRange.end)
        .replace(/\n/g, " ");
      return `- [${u.id}] (${u.kind}) [${u.sourceRange.start},${u.sourceRange.end}) ${text}`;
    })
    .join("\n");
  const constraintLines = units
    .filter((u) => !u.required)
    .map((u) => {
      const text = scriptContent
        .slice(u.sourceRange.start, u.sourceRange.end)
        .replace(/\n/g, " ");
      return `- (${u.kind}) [${u.sourceRange.start},${u.sourceRange.end}) ${text}`;
    })
    .join("\n");
  const constraints = constraintLines
    ? `\n\n【本批创作约束（不单独生成镜头）】\n${constraintLines}`
    : "";
  const ctx = context ? `\n【参考上下文】\n${context}\n` : "";
  return `【本批需要覆盖的源单元】\n${unitLines}${constraints}\n\n【约束】\n仅输出覆盖上述源单元的镜头，按源顺序覆盖每个必需单元；可为同一动作生成多个镜头。${ctx}\n\n请按系统提示要求的 JSON 数组格式输出，每个镜头用 sourceUnitIds 标注其覆盖的源单元 ID。dialogueSlices 仅在一句对白确实跨多个镜头时输出；start/end 必须使用上方标注的整篇剧本绝对偏移，不确定时省略该字段。`;
}

// ==================== 分批 ====================

interface Batch {
  units: SourceUnit[];
  range: { start: number; end: number };
  sceneId: string | null;
}

/**
 * 将源单元按场次与事件组边界分批（预算感知）。
 * 不跨场；每批必需单元数不超过 MAX_UNITS_PER_BATCH。
 */
export function batchSourceUnits(units: SourceUnit[]): Batch[] {
  const batches: Batch[] = [];
  let current: SourceUnit[] = [];
  let currentScene: string | null = null;
  let requiredCount = 0;

  const flush = () => {
    if (current.length === 0) return;
    if (requiredCount === 0) {
      current = [];
      return;
    }
    const first = current[0];
    const last = current[current.length - 1];
    batches.push({
      units: current,
      range: { start: first.sourceRange.start, end: last.sourceRange.end },
      sceneId: currentScene,
    });
    current = [];
    requiredCount = 0;
  };

  for (const u of units) {
    if (u.sceneId !== currentScene && current.length > 0) {
      flush();
      currentScene = u.sceneId;
    } else if (currentScene === null) {
      currentScene = u.sceneId;
    }
    // 达到预算后，在下一个必需单元开始前切批，让尾随注释留在其约束的上一批。
    if (u.required && requiredCount >= MAX_UNITS_PER_BATCH) {
      flush();
      currentScene = u.sceneId;
    }
    current.push(u);
    if (u.required) requiredCount++;
  }
  flush();
  return batches;
}

// ==================== 生成 ====================

async function callAI(
  jobId: string,
  systemPrompt: string,
  userPrompt: string,
  options: AnalyzeOptions,
): Promise<string> {
  throwIfCancelled(jobId);
  return await callFeatureAPI("script_analysis", systemPrompt, userPrompt, {
    maxTokens: 16384,
    temperature: 0.4,
    modelOverride: options.modelOverride,
  });
}

/**
 * 对单个批次执行一次拆镜（含解析/校验失败重试），返回解析结果。
 */
async function analyzeBatch(
  jobId: string,
  systemPrompt: string,
  userPrompt: string,
  options: AnalyzeOptions,
  maxRetries: number,
): Promise<ReturnType<typeof parseStoryboardResponse>> {
  let lastError = "";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfCancelled(jobId);
    const rawText = await callAI(jobId, systemPrompt, userPrompt, options);
    throwIfCancelled(jobId);

    const parsed = parseStoryboardResponse(rawText);
    if (!parsed.ok) {
      lastError = parsed.error || "无法解析 AI 拆镜结果";
      if (parsed.errorCode === "TRUNCATED_OUTPUT") {
        const error = new Error(lastError) as Error & { code?: string };
        error.code = "TRUNCATED_OUTPUT";
        throw error;
      }
      if (attempt < maxRetries) continue;
      throw new Error(`解析失败：${lastError}`);
    }

    const validation = validateShotBatch(parsed.shots);
    if (!validation.valid) {
      lastError = validation.error || "AI 拆镜结果未通过校验";
      if (attempt < maxRetries) continue;
      throw new Error(`未通过校验：${lastError}`);
    }

    return parsed;
  }
  throw new Error(`拆镜失败：${lastError || "未知错误"}`);
}

/**
 * 将解析结果转为 ShotDraft（供覆盖审计）。
 */
function toDrafts(
  parsed: ReturnType<typeof parseStoryboardResponse>,
  units: SourceUnit[],
  scriptContent: string,
): ShotDraft[] {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  return parsed.shots.map((p) => ({
    content: p.content,
    sourceUnitIds: p.sourceUnitIds || [],
    dialogueSlices: normalizeDialogueSlices(
      p.dialogueSlices || [],
      p.sourceUnitIds || [],
      unitById,
      scriptContent,
    ),
    // 来源范围由可信的本地源单元回填，不依赖模型猜测全文偏移。
    sourceRanges: sourceRangesForIds(p.sourceUnitIds || [], unitById),
    references: p.references,
  }));
}

function sourceRangesForIds(
  ids: string[],
  unitById: Map<string, SourceUnit>,
): Array<{ start: number; end: number }> {
  const seen = new Set<string>();
  return ids.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    const unit = unitById.get(id);
    return unit ? [unit.sourceRange] : [];
  });
}

/**
 * 模型常把对白切片返回为对白文本内的相对偏移，即使契约要求全文绝对偏移。
 * 此处兼容两种表示；没有可靠切片时按 sourceUnitIds 回填整段对白范围。
 */
function normalizeDialogueSlices(
  slices: Array<{ unitId: string; start: number; end: number }>,
  sourceUnitIds: string[],
  unitById: Map<string, SourceUnit>,
  scriptContent: string,
): Array<{ unitId: string; start: number; end: number }> {
  const normalized: Array<{ unitId: string; start: number; end: number }> = [];
  const coveredDialogueIds = new Set<string>();

  for (const slice of slices) {
    const unit = unitById.get(slice.unitId);
    if (!unit || unit.kind !== "dialogue") continue;

    if (
      slice.start >= unit.sourceRange.start &&
      slice.end <= unit.sourceRange.end &&
      slice.start < slice.end
    ) {
      normalized.push(slice);
      coveredDialogueIds.add(slice.unitId);
      continue;
    }

    const rawUnit = scriptContent.slice(unit.sourceRange.start, unit.sourceRange.end);
    const dialogueOffset = rawUnit.indexOf(unit.content);
    if (
      dialogueOffset >= 0 &&
      slice.start >= 0 &&
      slice.end > slice.start &&
      slice.end <= unit.content.length
    ) {
      const contentStart = unit.sourceRange.start + dialogueOffset;
      normalized.push({
        unitId: slice.unitId,
        start: contentStart + slice.start,
        end: contentStart + slice.end,
      });
      coveredDialogueIds.add(slice.unitId);
    }
  }

  for (const id of sourceUnitIds) {
    const unit = unitById.get(id);
    if (unit?.kind === "dialogue" && !coveredDialogueIds.has(id)) {
      normalized.push({ unitId: id, ...unit.sourceRange });
    }
  }
  return normalized;
}

/**
 * 从 draft 的 sourceRanges 回填 sourceText（不依赖模型摘抄）。
 */
function extractSourceText(draft: ShotDraft, scriptContent: string): string {
  if (draft.sourceRanges.length === 0) return "";
  return draft.sourceRanges
    .map((r) => scriptContent.slice(r.start, r.end))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
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

    // 1. 解析六类语法 + 提取源单元
    const parsed = parseScriptSyntax(scriptContent);
    const units = extractSourceUnits(parsed);
    const batches = batchSourceUnits(units);

    const allShots: StoryboardShot[] = [];
    const totalBatches = batches.length;

    // 2. 逐批生成 + 审计 + 定向修复
    for (let b = 0; b < totalBatches; b++) {
      throwIfCancelled(jobId);
      const batch = batches[b];
      store.setAnalysisProgress({
        progress: Math.round((b / Math.max(totalBatches, 1)) * 80),
        message: `正在拆分第 ${b + 1}/${totalBatches} 批…`,
      });

      const userPrompt = buildBatchUserPrompt(batch.units, scriptContent, options.context);
      const parsedBatch = await analyzeBatch(jobId, systemPrompt, userPrompt, options, maxRetries);

      let drafts = toDrafts(parsedBatch, batch.units, scriptContent);

      // 3. 覆盖审计
      const audit = auditSourceCoverage(drafts, {
        units: batch.units,
        batchRange: batch.range,
      });

      // 4. 定向修复缺失单元
      if (!audit.valid) {
        drafts = await repairMissingUnits(
          jobId,
          systemPrompt,
          batch,
          scriptContent,
          options,
          audit,
          drafts,
        );
        const reAudit = auditSourceCoverage(drafts, {
          units: batch.units,
          batchRange: batch.range,
        });
        if (!reAudit.valid) {
          throw new Error(
            `第 ${b + 1}/${totalBatches} 批覆盖审计失败：${reAudit.issues
              .map((i) => i.message)
              .join("；")}`,
          );
        }
      }

      const batchShots = buildShots(
        drafts.map((d) => ({
          content: d.content,
          references: d.references,
          sourceText: extractSourceText(d, scriptContent),
          sourceUnitIds: d.sourceUnitIds,
          dialogueSlices: d.dialogueSlices,
          sourceRanges: d.sourceRanges,
        })),
      );
      allShots.push(...batchShots);
      store.setAnalysisProgress({
        progress: Math.round(((b + 1) / Math.max(totalBatches, 1)) * 80),
        message: `已完成第 ${b + 1}/${totalBatches} 批，累计 ${allShots.length} 个镜头`,
      });
    }

    // 5. 全局合并 + Skill 校验 + 重排编号
    const mergedShots = allShots.map((s, i) => ({
      ...s,
      order: i,
      shotNumber: String(i + 1),
    }));

    // Skill 校验（质量提示，非阻断；阻断性遗漏已由覆盖审计拦截）
    validateWithSkillRules(mergedShots);

    applyShots(mergedShots);
    store.setAnalysisProgress({
      status: "succeeded",
      progress: 100,
      message: `拆镜完成，共 ${mergedShots.length} 个镜头（${totalBatches} 批）`,
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
 * 定向修复缺失源单元：针对未覆盖单元发小额重试，不重写已确认批次。
 */
async function repairMissingUnits(
  jobId: string,
  systemPrompt: string,
  batch: Batch,
  scriptContent: string,
  options: AnalyzeOptions,
  audit: CoverageAuditResult,
  existingDrafts: ShotDraft[],
): Promise<ShotDraft[]> {
  const missing = audit.missingUnitIds;
  if (missing.length === 0) return existingDrafts;

  const repairedDrafts: ShotDraft[] = [...existingDrafts];
  let missingUnits = batch.units.filter((u) => missing.includes(u.id));

  for (let retry = 0; retry < MAX_REPAIR_RETRIES && missingUnits.length > 0; retry++) {
    throwIfCancelled(jobId);
    const repairPrompt =
      buildBatchUserPrompt(missingUnits, scriptContent, options.context) +
      `\n\n【注意】这是针对遗漏单元的补充分镜，只输出上述缺失单元的镜头。`;
    const parsedRepair = await analyzeBatch(jobId, systemPrompt, repairPrompt, options, 0);
    const repairDrafts = toDrafts(parsedRepair, batch.units, scriptContent);
    repairedDrafts.push(...repairDrafts);

    const reAudit = auditSourceCoverage(repairedDrafts, {
      units: batch.units,
      batchRange: batch.range,
    });
    if (reAudit.missingUnitIds.length === 0) return repairedDrafts;
    missingUnits = batch.units.filter((u) => reAudit.missingUnitIds.includes(u.id));
  }

  return repairedDrafts;
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