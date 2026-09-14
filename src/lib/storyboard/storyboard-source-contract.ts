// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard source contract types (源单元与镜头草稿契约)
 *
 * 阶段 3 的分层生成/覆盖审计所依赖的中间态类型。这些类型不改变现有
 * `StoryboardShot` 持久化结构，只服务于"解析 → 分批 → 生成 → 审计 → 发布"
 * 的生成链路。
 */
import type { StoryboardShotContent } from "@/types/storyboard";

/** 源单元种类 */
export type SourceUnitKind =
  | 'visual-event'
  | 'dialogue'
  | 'transition'
  | 'subtitle'
  | 'comment'
  | 'unknown';

/** 源单元：来自剧本语法解析与视觉事件提取的最小可覆盖单元 */
export interface SourceUnit {
  id: string;
  kind: SourceUnitKind;
  sourceRange: { start: number; end: number };
  /** 所属场次 ID（场次 token 的 id）；未知场次时为 null */
  sceneId: string | null;
  /** 是否必须被覆盖：comment 为约束、场次标题仅作边界（不生成镜头） */
  required: boolean;
  /** 附带内容（对白/动作/字幕/转场/注释等） */
  content: string;
}

/** 视觉事件（用于覆盖审计的源单元，kind=visual-event） */
export interface VisualEvent {
  id: string;
  /** 事件阶段：建立/发起/显现/作用/结果/反应 */
  phase: VisualEventPhase;
  content: string;
  sourceRange: { start: number; end: number };
  sceneId: string | null;
}

export type VisualEventPhase = '建立' | '发起' | '显现' | '作用' | '结果' | '反应';

/** 对白片段：跨画面绑定时记录原文范围 */
export interface DialogueSlice {
  unitId: string;
  start: number;
  end: number;
}

/** 镜头草稿：AI 生成 + 覆盖审计后的中间态 */
export interface ShotDraft {
  content: StoryboardShotContent;
  /** 本批范围内被覆盖的源单元 ID（视觉事件/转场/字幕） */
  sourceUnitIds: string[];
  /** 对白片段（单元 ID + 原文范围） */
  dialogueSlices: DialogueSlice[];
  /** 覆盖的原文范围（支持不连续） */
  sourceRanges: Array<{ start: number; end: number }>;
  references?: { characters: string[]; costumes: string[]; scenes: string[] };
  notes?: string;
}

/** 覆盖审计单条诊断 */
export interface CoverageIssue {
  type:
    | 'empty_result'
    | 'skipped_entry'
    | 'unknown_id'
    | 'cross_scene_id'
    | 'range_out_of_bounds'
    | 'reversed_range'
    | 'duplicate_id'
    | 'uncovered_unit'
    | 'dialogue_orphan'
    | 'dialogue_mismatch'
    | 'dialogue_duplicate';
  unitId?: string;
  message: string;
}

/** 覆盖审计结果 */
export interface CoverageAuditResult {
  valid: boolean;
  issues: CoverageIssue[];
  /** 已覆盖的必需源单元 ID */
  coveredUnitIds: string[];
  /** 缺失的必需源单元 ID */
  missingUnitIds: string[];
}
