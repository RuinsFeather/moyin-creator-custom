// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard response parser (AI 拆镜响应解析器)
 *
 * 将 AI 返回的文本解析为 StoryboardShot[] 原始数据（未校验、未建 ID）。
 * 支持：
 *   - 纯 JSON 数组
 *   - 包裹在 ```json ``` 代码块中
 *   - 含前后说明文字的 JSON
 * 解析失败返回 null，交由上层决定是否重试。
 */
import type { StoryboardShotContent } from "@/types/storyboard";

export interface ParsedRawShot {
  content: StoryboardShotContent;
  references?: {
    characters: string[];
    costumes: string[];
    scenes: string[];
  };
  sourceText?: string;
}

export interface ParseResult {
  ok: boolean;
  shots: ParsedRawShot[];
  error?: string;
  rawText?: string;
}

/**
 * 从 AI 返回文本中提取 JSON 数组字符串。
 * 返回 null 表示未找到可解析的 JSON 数组。
 */
export function extractJsonArray(text: string): string | null {
  if (!text) return null;

  // 去除 ```json ... ``` 代码块标记
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;

  // 找到第一个 '[' 和最后一个 ']'
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  return candidate.slice(start, end + 1);
}

/**
 * 解析 AI 拆镜结果为镜头数组（原始，未规范化）。
 * 对每个镜头做宽松的字段归一化：
 *   - content 缺失时尝试从顶层字段补齐
 *   - 字符串字段转 string
 */
export function parseStoryboardResponse(text: string): ParseResult {
  const jsonStr = extractJsonArray(text);
  if (!jsonStr) {
    return { ok: false, shots: [], error: "未能在 AI 返回中提取到镜头数组", rawText: text };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return {
      ok: false,
      shots: [],
      error: `JSON 解析失败：${(e as Error).message}`,
      rawText: jsonStr,
    };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, shots: [], error: "AI 返回的 JSON 不是数组", rawText: jsonStr };
  }

  const shots: ParsedRawShot[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!item || typeof item !== "object") continue;

    const raw = item as Record<string, unknown>;
    const normalized = normalizeShot(raw, i);
    if (normalized) shots.push(normalized);
  }

  return { ok: true, shots, rawText: jsonStr };
}

function asString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  return "";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter(Boolean);
}

/**
 * 将原始镜头对象归一化为 ParsedRawShot。
 * 兼容两种结构：
 *   A) { content: {...}, references: {...} }（新模型）
 *   B) 顶层直接是 content 字段 + references 字段
 */
function normalizeShot(raw: Record<string, unknown>, index: number): ParsedRawShot | null {
  const contentSrc =
    raw.content && typeof raw.content === "object"
      ? (raw.content as Record<string, unknown>)
      : raw;

  const content: StoryboardShotContent = {
    summary: asString(contentSrc.summary),
    scene: asString(contentSrc.scene),
    action: asString(contentSrc.action),
    dialogue: asString(contentSrc.dialogue),
    shotSize: asString(contentSrc.shotSize),
    cameraMovement: asString(contentSrc.cameraMovement),
    durationSeconds:
      typeof contentSrc.durationSeconds === "number"
        ? contentSrc.durationSeconds
        : typeof contentSrc.durationSeconds === "string"
          ? Number(contentSrc.durationSeconds)
          : undefined,
    additionalDescription: asString(contentSrc.additionalDescription) || undefined,
  };

  // references 可能嵌套在 content 下，或顶层
  const refSrc =
    (contentSrc.references && typeof contentSrc.references === "object"
      ? (contentSrc.references as Record<string, unknown>)
      : raw.references && typeof raw.references === "object"
        ? (raw.references as Record<string, unknown>)
        : null);

  const references: { characters: string[]; costumes: string[]; scenes: string[] } = {
    characters: asStringArray(refSrc?.characters),
    costumes: asStringArray(refSrc?.costumes),
    scenes: asStringArray(refSrc?.scenes),
  };

  const sourceText = asString(raw.sourceText) || undefined;

  return {
    content,
    references:
      references.characters.length || references.costumes.length || references.scenes.length
        ? references
        : undefined,
    sourceText,
  };
}