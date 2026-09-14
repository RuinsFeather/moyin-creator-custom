// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Skill validator (Skill 质量校验器)
 *
 * 集成 skill/storyboard_SKILL.md 的质量检查规则，对拆分结果做内容层面的
 * 质量校验（区别于格式校验与源覆盖审计）。
 */
import type { StoryboardShot } from '@/types/storyboard';

export type SkillIssueType =
  | 'empty_action'
  | 'dialogue_only'
  | 'missing_source'
  | 'orphan_dialogue'
  | 'syntax_unparsed'
  | 'comment_rendered'
  | 'uncovered_unit'
  | 'duplicate_dialogue'
  | 'source_mismatch';

export interface SkillIssue {
  type: SkillIssueType;
  shotIndex: number;
  message: string;
  suggestion: string;
}

export interface SkillValidationResult {
  valid: boolean;
  issues: SkillIssue[];
  /** 必需源单元是否全部有经校验的镜头归属（由覆盖审计补充，这里仅占位） */
  sourceCoverageComplete: boolean;
  dialogueBindingCorrect: boolean;
  scriptSyntaxHandled: boolean;
}

/**
 * 对已构建的 StoryboardShot[] 做 Skill 质量校验。
 * 覆盖：空 action、只有对白的镜头、缺失 sourceText、重复对白等。
 */
export function validateWithSkillRules(shots: StoryboardShot[]): SkillValidationResult {
  const issues: SkillIssue[] = [];
  const dialogueSeen = new Map<string, number>();

  shots.forEach((shot, i) => {
    const c = shot.content;

    // 空 action（scene 也空 → 更严重）
    if (!c.action.trim()) {
      issues.push({
        type: 'empty_action',
        shotIndex: i,
        message: `镜头 ${shot.shotNumber} 缺少 action`,
        suggestion: '补充该镜头可拍摄的画面动作',
      });
    }

    // 只有对白、无可见画面
    if (c.dialogue.trim() && !c.action.trim() && !c.scene.trim()) {
      issues.push({
        type: 'dialogue_only',
        shotIndex: i,
        message: `镜头 ${shot.shotNumber} 只有对白没有画面`,
        suggestion: '将对白绑定到其发生时的可见视觉节拍',
      });
    }

    // 缺失 sourceText
    if (!shot.sourceText?.trim()) {
      issues.push({
        type: 'missing_source',
        shotIndex: i,
        message: `镜头 ${shot.shotNumber} 缺少 sourceText`,
        suggestion: '从剧本原文回填对应原文',
      });
    }

    // 对白重复检查
    const d = c.dialogue.trim();
    if (d) {
      const prev = dialogueSeen.get(d);
      if (prev !== undefined) {
        issues.push({
          type: 'duplicate_dialogue',
          shotIndex: i,
          message: `镜头 ${shot.shotNumber} 的对白与镜头 ${prev + 1} 重复`,
          suggestion: '确认是否为原文重复，或修正对白归属',
        });
      }
      dialogueSeen.set(d, i);
    }
  });

  const hasDialogueIssue = issues.some((i) => i.type === 'dialogue_only' || i.type === 'duplicate_dialogue');
  const hasSyntaxIssue = issues.some((i) => i.type === 'syntax_unparsed' || i.type === 'comment_rendered');

  return {
    valid: issues.length === 0,
    issues,
    sourceCoverageComplete: true,
    dialogueBindingCorrect: !hasDialogueIssue,
    scriptSyntaxHandled: !hasSyntaxIssue,
  };
}
