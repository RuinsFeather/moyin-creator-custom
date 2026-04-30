// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.

/**
 * 分镜提示词 AI 优化 / 镜头参数 AI 补全
 *
 * 通过"剧本分析"模型（callFeatureAPI('script_analysis', ...)）：
 *  - optimizeScenePrompt：润色首帧/尾帧提示词，返回中英对照
 *  - analyzeShotDetails：推断景别 / 时长 / 镜头运动
 *
 * 全部以 JSON 形式响应，便于稳定解析。
 */

import { callFeatureAPI } from "@/lib/ai/feature-router";
import {
  SHOT_SIZE_PRESETS,
  DURATION_PRESETS,
  CAMERA_MOVEMENT_PRESETS,
  type ShotSizeType,
  type DurationType,
} from "@/stores/director-presets";

// ============ 工具：从可能含 ```json 标记的文本中抽取 JSON ============
function extractJson(text: string): any {
  if (!text) throw new Error("AI 返回为空");
  let s = text.trim();
  // 去除围栏代码块
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  // 截取首尾大括号
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last < first) {
    throw new Error("AI 返回格式错误：未找到 JSON 对象");
  }
  const json = s.slice(first, last + 1);
  try {
    return JSON.parse(json);
  } catch (e: any) {
    throw new Error(`AI 返回 JSON 解析失败：${e?.message || e}`);
  }
}

// ============ 输入/输出类型 ============

export interface OptimizePromptInput {
  /** 当前分镜的中文提示词（首帧或尾帧） */
  promptZh?: string;
  /** 当前英文提示词 */
  prompt?: string;
  /** 提示词类型 */
  frame: "first" | "end";
  /** 上下文：场景描述（可选） */
  sceneDescription?: string;
  /** 上下文：动作概述（可选） */
  actionSummary?: string;
  /** 上下文：对白（可选） */
  dialogue?: string;
  /** 上下文：景别（可选） */
  shotSize?: string | null;
  /** 上下文：镜头运动（可选） */
  cameraMovement?: string;
  /** 风格关键词（可选） */
  styleHint?: string;
}

export interface OptimizePromptResult {
  promptZh: string;
  prompt: string;
}

export interface AnalyzeShotInput {
  /** 中文提示词 */
  promptZh?: string;
  /** 英文提示词 */
  prompt?: string;
  /** 场景描述 */
  sceneDescription?: string;
  /** 动作概述 */
  actionSummary?: string;
  /** 对白 */
  dialogue?: string;
  /** 叙事功能 */
  narrativeFunction?: string;
}

export interface AnalyzeShotResult {
  shotSize: ShotSizeType;
  duration: DurationType;
  cameraMovement: string; // CameraMovementType id
  reasoning?: string;
}

// ============ 1. 优化提示词 ============

export async function optimizeScenePrompt(
  input: OptimizePromptInput,
): Promise<OptimizePromptResult> {
  const {
    promptZh = "",
    prompt = "",
    frame,
    sceneDescription = "",
    actionSummary = "",
    dialogue = "",
    shotSize = "",
    cameraMovement = "",
    styleHint = "",
  } = input;

  const frameLabel = frame === "first" ? "首帧（镜头开始的画面）" : "尾帧（镜头结束的画面）";

  const systemPrompt = `你是一名专业的 AI 影视分镜提示词专家，擅长把简单的画面描述润色为高质量的"文生图"提示词。

要求：
1. 保留原有信息和镜头意图，禁止改变画面主体或情节
2. 补充：构图（视角/取景）、光影（自然/人工/方向/色温）、氛围（情绪/天气/时段）、细节（材质/纹理/服装/道具）
3. 中文提示词：自然中文短语逗号分隔，120-200 字之间
4. 英文提示词：标准 SD/Midjourney 风格，camelCase 关键字逗号分隔，可包含 8k/cinematic/depth of field/bokeh 等技术词汇
5. 输出必须为合法 JSON，不要任何解释、不要 Markdown 代码块`;

  const userPrompt = `请优化以下分镜的【${frameLabel}】提示词。

【场景描述】${sceneDescription || "（无）"}
【动作概述】${actionSummary || "（无）"}
【对白】${dialogue || "（无）"}
【景别】${shotSize || "（未指定）"}
【镜头运动】${cameraMovement || "（未指定）"}
【风格倾向】${styleHint || "（按场景自行判断）"}

【当前中文提示词】${promptZh || "（空）"}
【当前英文提示词】${prompt || "（空）"}

请输出 JSON：
{
  "promptZh": "优化后的中文提示词",
  "prompt": "优化后的英文提示词"
}`;

  const text = await callFeatureAPI("script_analysis", systemPrompt, userPrompt, {
    temperature: 0.6,
    maxTokens: 1024,
  });

  const obj = extractJson(text);
  const outZh = String(obj.promptZh || obj.prompt_zh || "").trim();
  const outEn = String(obj.prompt || obj.promptEn || obj.prompt_en || "").trim();
  if (!outZh && !outEn) {
    throw new Error("AI 返回 JSON 缺少 promptZh / prompt 字段");
  }
  return {
    promptZh: outZh || promptZh,
    prompt: outEn || prompt,
  };
}

// ============ 2. 分析镜头参数（景别/时长/镜头运动） ============

export async function analyzeShotDetails(
  input: AnalyzeShotInput,
): Promise<AnalyzeShotResult> {
  const {
    promptZh = "",
    prompt = "",
    sceneDescription = "",
    actionSummary = "",
    dialogue = "",
    narrativeFunction = "",
  } = input;

  const shotSizeList = SHOT_SIZE_PRESETS.map(
    (p) => `${p.id}（${p.label} / ${p.abbr}）`,
  ).join("、");
  const durationList = DURATION_PRESETS.map((p) => p.value).join(" / ");
  const cameraList = CAMERA_MOVEMENT_PRESETS.map(
    (p) => `${p.id}（${p.label}）`,
  ).join("、");

  const systemPrompt = `你是一名专业的影视摄影指导，擅长根据剧情/画面内容判断最合适的【景别】、【镜头时长】、【镜头运动】。

判断原则：
- 远景/全景：建立环境、空旷氛围、宏大叙事
- 中景：人物互动、动作展示
- 近景/特写：情绪表达、对白、关键细节
- 时长：动作越快/对白越短 → 时长短；情绪渲染/长动作 → 时长长
- 镜头运动：静态对白多用 static；追踪角色用 tracking；纵深推进用 dolly-in；环境介绍用 pan/orbit

输出必须为合法 JSON，禁止任何解释或 Markdown。`;

  const userPrompt = `请为以下分镜推断最合适的镜头参数。

【场景描述】${sceneDescription || "（无）"}
【动作概述】${actionSummary || "（无）"}
【对白】${dialogue || "（无）"}
【叙事功能】${narrativeFunction || "（无）"}
【中文提示词】${promptZh || "（无）"}
【英文提示词】${prompt || "（无）"}

可选【景别 id】：${shotSizeList}
可选【时长（秒）】：${durationList}
可选【镜头运动 id】：${cameraList}

请严格在上述 id / 数值范围内选择，输出 JSON：
{
  "shotSize": "景别 id（如 ms）",
  "duration": 数字（如 5）,
  "cameraMovement": "镜头运动 id（如 static）",
  "reasoning": "10 字以内的简短理由"
}`;

  const text = await callFeatureAPI("script_analysis", systemPrompt, userPrompt, {
    temperature: 0.3,
    maxTokens: 512,
  });

  const obj = extractJson(text);

  // 校验/修正
  const validShot = SHOT_SIZE_PRESETS.find((p) => p.id === obj.shotSize)
    ?.id as ShotSizeType | undefined;
  const validDur = DURATION_PRESETS.find(
    (p) => p.value === Number(obj.duration),
  )?.value as DurationType | undefined;
  const validCam = CAMERA_MOVEMENT_PRESETS.find(
    (p) => p.id === obj.cameraMovement,
  )?.id;

  return {
    shotSize: validShot || "ms",
    duration: validDur || 5,
    cameraMovement: validCam || "static",
    reasoning: obj.reasoning ? String(obj.reasoning) : undefined,
  };
}
