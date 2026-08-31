// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * Agent 上下文预算裁剪（Plan 2.4）
 *
 * 现状问题：buildAgentContext 把全部工作区文件正文塞进一条 JSON（上限 800K 字符），
 * 换到小上下文模型（如 32K 的 doubao/_default）会直接报错或被上游静默截断。
 *
 * 方案：按 model-registry 的 contextWindow 反算字符预算，分层填充：
 *   1. 编辑器全文（当前文件）          —— 最重要，优先全额
 *   2. 勾选的参考文件/目录成员全文      —— 其次
 *   3. 其余工作区文件                  —— 预算不足时降级为元数据摘要
 *
 * 预算系数与 model-registry.estimateTokens（chars/1.5）严格互逆：
 *   字符预算 = contextWindow(tokens) × 1.5(chars/token) × 输入份额
 *   输入份额 = 70%（预留 20% 输出 + 10% 安全边际，与 script-parser 的
 *   10% safetyMargin + 输出空间检查口径一致）
 */

import { getModelLimits } from '@/lib/ai/model-registry';

/** chars/token 换算系数 —— 与 estimateTokens 的 /1.5 互逆，勿单独修改 */
export const CHARS_PER_TOKEN = 1.5;
/** contextWindow 中分配给输入的份额（剩余 30% 留给输出与安全边际） */
export const INPUT_SHARE = 0.7;
/** 未知模型时的兜底 token 数（对齐 model-registry 的 _default） */
export const FALLBACK_CONTEXT_WINDOW = 32000;

export interface BudgetInputFile {
  path: string;
  name: string;
  type: string;
  content: string;
  /** 是否可发送正文（与 store 的 editable 对应） */
  editable?: boolean;
}

export interface BudgetResultFile extends BudgetInputFile {
  /** true = 全文；false = 已降级为摘要（超预算） */
  full: boolean;
  /** 实际发送的正文（摘要模式下为占位说明） */
  content: string;
}

export interface BudgetResult {
  files: BudgetResultFile[];
  /** 预算内全文发送的文件数 */
  fullCount: number;
  /** 降级为摘要的文件数（不含本就无正文的文件） */
  degradedCount: number;
  /** 实际使用的字符预算上限 */
  charBudget: number;
}

/**
 * 按 contextWindow 反算输入字符预算。
 * 32000 tokens → 33600 chars（0.7 × 32000 × 1.5）
 */
export function computeCharBudget(contextWindowTokens: number): number {
  return Math.floor(contextWindowTokens * INPUT_SHARE * CHARS_PER_TOKEN);
}

/**
 * 从模型名查询 contextWindow；查不到走保守兜底 32K。
 */
export function getContextWindowForModel(modelName?: string | null): number {
  if (!modelName) return FALLBACK_CONTEXT_WINDOW;
  try {
    return getModelLimits(modelName).contextWindow || FALLBACK_CONTEXT_WINDOW;
  } catch {
    return FALLBACK_CONTEXT_WINDOW;
  }
}

/**
 * 计算一个文件条目序列化后的近似字符占用（与 buildAgentContext 的
 * JSON 结构对齐 —— path/name/type/content 四字段）。
 */
function entryChars(file: { path: string; name: string; type: string; content: string }): number {
  return file.path.length + file.name.length + file.type.length + file.content.length + 8;
}

/**
 * 分层填充预算。
 *
 * @param files 工作区文件（priority 阶层高的先吃预算）
 * @param priorityPaths 优先全文的文件 path 集合（当前编辑器文件 + 勾选参考）
 * @param charBudget 输入字符预算上限
 */
export function applyContextBudget(
  files: BudgetInputFile[],
  priorityPaths: ReadonlySet<string>,
  charBudget: number,
): BudgetResult {
  let remaining = charBudget;
  const result: BudgetResultFile[] = [];
  let degradedCount = 0;

  // 阶层 1：优先文件（预算吃紧时也保证它们先拿）
  for (const file of files) {
    if (!priorityPaths.has(file.path)) continue;
    if (!file.editable) {
      result.push({ ...file, full: false, content: '[正文未载入]' });
      continue;
    }
    if (remaining <= 0) {
      result.push({ ...file, full: false, content: '[预算耗尽：仅发送摘要]' });
      degradedCount += 1;
      continue;
    }
    const content = file.content.length > remaining ? file.content.slice(0, remaining) : file.content;
    const truncated = content.length < file.content.length;
    remaining -= entryChars({ ...file, content });
    result.push({ ...file, full: !truncated, content: truncated ? `${content}\n…[正文已按预算截断]` : content });
    if (truncated) degradedCount += 1;
  }

  // 阶层 2：其余文件 —— 剩余预算内发全文，超了降级为摘要
  for (const file of files) {
    if (priorityPaths.has(file.path)) continue;
    if (!file.editable) {
      result.push({ ...file, full: false, content: '[正文未载入]' });
      continue;
    }
    if (remaining > entryChars(file)) {
      remaining -= entryChars(file);
      result.push({ ...file, full: true, content: file.content });
    } else {
      result.push({ ...file, full: false, content: '[超出上下文预算：仅发送摘要]' });
      degradedCount += 1;
    }
  }

  return {
    files: result,
    fullCount: result.filter((f) => f.full).length,
    degradedCount,
    charBudget,
  };
}
