// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑧ LCS 行级 diff（自实现，避免引入依赖）
 *
 * DiffViewer 旧实现按 index 逐行对比：头部插入一行会导致后续全部错位（全红全绿）。
 * 这里用经典 LCS（最长公共子序列）DP 求对齐，再回溯产出 removed/added/same 序列。
 * 行数规模 n×m（n,m ≤ 数千行）对 diff 面板足够快；DP 表用 Int32Array 行存储降低内存。
 */

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  content: string;
  /** 原文件行号（removed/same 有；added 无） */
  oldLine?: number;
  /** 新文件行号（added/same 有；removed 无） */
  newLine?: number;
}

/**
 * 计算两个文本的行级 diff（LCS 对齐）。
 * 头部插入一行只会产生 1 条 added 行，不再全红全绿。
 */
export function computeLineDiff(original: string, proposed: string): DiffLine[] {
  const oldLines = original.split('\n');
  const newLines = proposed.split('\n');
  const n = oldLines.length;
  const m = newLines.length;

  // DP 表：(n+1)×(m+1)，值为 LCS 长度。行存储 Int32Array 省内存
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    const rowOffset = i * width;
    const nextRowOffset = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      dp[rowOffset + j] = oldLines[i] === newLines[j]
        ? dp[nextRowOffset + j + 1] + 1
        : Math.max(dp[nextRowOffset + j], dp[rowOffset + j + 1]);
    }
  }

  // 回溯：从 (0,0) 走到 (n,m)，产出 diff 序列
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      result.push({ type: 'same', content: oldLines[i]!, oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) {
      result.push({ type: 'removed', content: oldLines[i]!, oldLine: i + 1 });
      i++;
    } else {
      result.push({ type: 'added', content: newLines[j]!, newLine: j + 1 });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'removed', content: oldLines[i]!, oldLine: i + 1 });
    i++;
  }
  while (j < m) {
    result.push({ type: 'added', content: newLines[j]!, newLine: j + 1 });
    j++;
  }
  return result;
}

/**
 * 折叠展示：长 diff 只保留头尾各 keepHalf 行，中间插一条省略标记。
 * 返回行数组 + 被折叠的行数（0 = 无折叠）。
 */
export function collapseDiffLines(lines: DiffLine[], limit = 100): { lines: DiffLine[]; collapsed: number } {
  if (lines.length <= limit) return { lines, collapsed: 0 };
  const keepHalf = Math.floor(limit / 2);
  const elided = lines.length - limit;
  const marker: DiffLine = { type: 'same', content: `... 省略 ${elided} 行 ...` };
  return { lines: [...lines.slice(0, keepHalf), marker, ...lines.slice(-keepHalf)], collapsed: elided };
}
