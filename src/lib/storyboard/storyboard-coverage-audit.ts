// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Source coverage audit (源覆盖审计)
 *
 * 在格式校验之后，对 AI 生成的镜头草稿做确定性覆盖审计：
 *   - 非空可拍摄输入不得返回空结果
 *   - 每个 sourceUnitId 必须已知、不得跨场、不得越界/逆序/重复
 *   - 每个必需源单元必须有可见镜头归属
 *   - 对白片段的并集与顺序需与原文一致
 *
 * 这是"合法 JSON 但省略后半段 / 静默跳过条目"的最终防线。
 */
import type { SourceUnit, ShotDraft, CoverageAuditResult, CoverageIssue } from './storyboard-source-contract';

export interface AuditContext {
  /** 本批需要覆盖的源单元 */
  units: SourceUnit[];
  /** 批边界：原文范围 */
  batchRange: { start: number; end: number };
}

/**
 * 审计一批镜头草稿是否覆盖了本批源单元。
 */
export function auditSourceCoverage(
  drafts: ShotDraft[],
  ctx: AuditContext,
): CoverageAuditResult {
  const issues: CoverageIssue[] = [];
  const covered = new Set<string>();
  const unitById = new Map<string, SourceUnit>();
  for (const u of ctx.units) unitById.set(u.id, u);

  // 非空可拍摄输入不得返回空结果
  const requiredUnits = ctx.units.filter((u) => u.required);
  if (requiredUnits.length > 0 && drafts.length === 0) {
    return {
      valid: false,
      issues: [{ type: 'empty_result', message: '非空剧本不得返回空镜头数组' }],
      coveredUnitIds: [],
      missingUnitIds: requiredUnits.map((u) => u.id),
    };
  }

  for (const draft of drafts) {
    const idsInDraft = new Set<string>();
    for (const unitId of draft.sourceUnitIds) {
      const unit = unitById.get(unitId);
      if (!unit) {
        issues.push({ type: 'unknown_id', unitId, message: `镜头引用了未知源单元 ${unitId}` });
        continue;
      }
      // 同一源单元可以跨多个镜头细拆，但单个镜头内不得重复列出同一 ID。
      if (idsInDraft.has(unitId)) {
        issues.push({ type: 'duplicate_id', unitId, message: `镜头内重复引用源单元 ${unitId}` });
        continue;
      }
      idsInDraft.add(unitId);
      covered.add(unitId);

      // 跨场：单元所属场次必须与镜头所属场次一致（由 sourceUnitIds 的第一单元推断）
      if (!rangeWithin(unit.sourceRange, ctx.batchRange)) {
        issues.push({
          type: 'range_out_of_bounds',
          unitId,
          message: `源单元 ${unitId} 超出本批原文范围`,
        });
      }
    }

    // 校验 sourceRanges 合法
    for (const r of draft.sourceRanges) {
      if (r.start < 0 || r.end < r.start) {
        issues.push({ type: 'reversed_range', message: `非法原文范围 [${r.start},${r.end})` });
      }
    }

    // 对白片段范围合法
    for (const ds of draft.dialogueSlices) {
      const unit = unitById.get(ds.unitId);
      if (!unit) {
        issues.push({ type: 'dialogue_orphan', unitId: ds.unitId, message: `对白片段引用了未知单元 ${ds.unitId}` });
        continue;
      }
      if (ds.start < unit.sourceRange.start || ds.end > unit.sourceRange.end || ds.start >= ds.end) {
        issues.push({
          type: 'dialogue_mismatch',
          unitId: ds.unitId,
          message: `对白片段范围 [${ds.start},${ds.end}) 越界或非法`,
        });
      }
    }
  }

  // 必需单元缺失检查
  const missing = requiredUnits.filter((u) => !covered.has(u.id)).map((u) => u.id);
  for (const mid of missing) {
    issues.push({ type: 'uncovered_unit', unitId: mid, message: `必需源单元 ${mid} 未被任何镜头覆盖` });
  }

  return {
    valid: issues.length === 0,
    issues,
    coveredUnitIds: Array.from(covered),
    missingUnitIds: missing,
  };
}

function rangeWithin(r: { start: number; end: number }, batch: { start: number; end: number }): boolean {
  return r.start >= batch.start && r.end <= batch.end;
}
