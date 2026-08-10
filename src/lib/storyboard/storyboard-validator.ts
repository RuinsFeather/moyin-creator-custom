// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard validator (分镜校验器)
 *
 * 校验 AI 拆镜结果是否符合新分镜模型约束：
 *   - 不出现 集/场 层级字段
 *   - 不出现 首尾帧 / 提示词 / 视频 字段
 *   - 每个镜头具备最小必需内容
 * 失败时不覆盖现有分镜，交由上层处理。
 */
import type { StoryboardShotContent } from "@/types/storyboard";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface StoryboardShotValidation {
  valid: boolean;
  shotIndex: number;
  issues: ValidationIssue[];
}

/** 每批镜头整体的校验结果 */
export interface StoryboardValidationResult {
  valid: boolean;
  shotCount: number;
  issues: ValidationIssue[];
  /** 若有致命问题，给出整体错误信息 */
  error?: string;
}

/** 禁止出现的字段（历史遗留，新模型不允许） */
const FORBIDDEN_FIELDS = [
  "imagePrompt",
  "imagePromptZh",
  "endFramePrompt",
  "endFramePromptZh",
  "videoPrompt",
  "videoPromptZh",
  "imageDataUrl",
  "imageHttpUrl",
  "endFrameImageUrl",
  "endFrameHttpUrl",
  "imageStatus",
  "endFrameStatus",
  "videoStatus",
  "videoUrl",
  "needsEndFrame",
  "sourceEpisodeId",
  "sourceSceneId",
  "selectedEpisodeId",
  "selectedSceneId",
];

/**
 * 校验单个镜头内容是否具备最小必需字段。
 * 不校验 summary 是否为空（AI 可能返回空 summary 但有 action），
 * 但 summary 与 action 至少填一个。
 */
export function validateShotContent(
  content: StoryboardShotContent,
  shotIndex: number,
): StoryboardShotValidation {
  const issues: ValidationIssue[] = [];
  const path = `shots[${shotIndex}]`;

  if (!content || typeof content !== "object") {
    return {
      valid: false,
      shotIndex,
      issues: [{ path, message: "镜头内容缺失" }],
    };
  }

  const summary = (content.summary || "").trim();
  const action = (content.action || "").trim();
  if (!summary && !action) {
    issues.push({ path: `${path}.content`, message: "画面内容与动作均为空" });
  }

  if (typeof content.shotSize === "string" && content.shotSize.trim() === "") {
    issues.push({ path: `${path}.shotSize`, message: "景别为空" });
  }

  return { valid: issues.length === 0, shotIndex, issues };
}

/**
 * 校验一批镜头（AI 返回的完整拆镜结果）。
 * 检查：
 *   1. 是数组
 *   2. 每个镜头校验内容
 *   3. 不包含禁止字段
 */
export function validateShotBatch(
  rawShots: unknown,
): StoryboardValidationResult {
  if (!Array.isArray(rawShots)) {
    return {
      valid: false,
      shotCount: 0,
      issues: [{ path: "shots", message: "AI 返回结果不是数组" }],
      error: "AI 拆镜结果格式错误：期待镜头数组",
    };
  }

  const issues: ValidationIssue[] = [];

  rawShots.forEach((shot, i) => {
    const path = `shots[${i}]`;
    if (!shot || typeof shot !== "object") {
      issues.push({ path, message: "镜头不是对象" });
      return;
    }

    // 禁止字段检查
    for (const field of FORBIDDEN_FIELDS) {
      if (field in (shot as Record<string, unknown>)) {
        issues.push({ path: `${path}.${field}`, message: `包含禁止字段 ${field}` });
      }
    }

    // 内容校验
    const content = (shot as { content?: unknown }).content;
    if (!content || typeof content !== "object") {
      issues.push({ path: `${path}.content`, message: "缺少 content 对象" });
    } else {
      const contentResult = validateShotContent(content as StoryboardShotContent, i);
      issues.push(...contentResult.issues);
    }
  });

  return {
    valid: issues.length === 0,
    shotCount: rawShots.length,
    issues,
    error: issues.length > 0 ? "AI 拆镜结果未通过校验" : undefined,
  };
}

/**
 * 严格 JSON Schema 常量，供提示词使用（可选）。
 */
export const STORYBOARD_JSON_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      content: {
        type: "object",
        properties: {
          summary: { type: "string", description: "本镜头画面内容的一句话概述" },
          scene: { type: "string", description: "发生场景（与角色/场景库名一致或描述）" },
          action: { type: "string", description: "镜头内主要动作" },
          dialogue: { type: "string", description: "若镜头内有对白，放原文；否则空串" },
          shotSize: { type: "string", description: "景别：特写/近景/中景/全景/远景" },
          cameraMovement: { type: "string", description: "镜头运动：固定/推/拉/摇/移/跟" },
          durationSeconds: { type: "number", description: "预估时长（秒），可选" },
          additionalDescription: { type: "string", description: "补充视觉/氛围描述，可选" },
        },
        required: ["summary", "scene", "action", "dialogue", "shotSize", "cameraMovement"],
      },
      references: {
        type: "object",
        properties: {
          characters: { type: "array", items: { type: "string" } },
          costumes: { type: "array", items: { type: "string" } },
          scenes: { type: "array", items: { type: "string" } },
        },
      },
      sourceText: { type: "string", description: "从剧本中摘取的对应原文，可选" },
    },
    required: ["content"],
  },
};