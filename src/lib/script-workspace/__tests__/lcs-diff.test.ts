// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑧ LCS 行级 diff 测试
 *
 * 核心回归：旧按 index 对比实现中"头部插入一行 → 全红全绿"，
 * LCS 对齐后头部插入只产生 1 条 added。
 */

import { describe, expect, it } from 'vitest';
import { computeLineDiff, collapseDiffLines } from '@/lib/script-workspace/lcs-diff';

describe('computeLineDiff', () => {
  it('头部插入一行：只产生 1 条 added，其余行对齐为 same', () => {
    const original = ['第一行', '第二行', '第三行'].join('\n');
    const proposed = ['插入行', '第一行', '第二行', '第三行'].join('\n');

    const diff = computeLineDiff(original, proposed);

    const added = diff.filter((l) => l.type === 'added');
    const removed = diff.filter((l) => l.type === 'removed');
    expect(added).toHaveLength(1);
    expect(added[0]?.content).toBe('插入行');
    expect(added[0]?.newLine).toBe(1);
    expect(removed).toHaveLength(0);
    expect(diff.filter((l) => l.type === 'same')).toHaveLength(3);
  });

  it('中部修改一行：1 removed + 1 added', () => {
    const original = ['A', 'B', 'C'].join('\n');
    const proposed = ['A', 'B改', 'C'].join('\n');

    const diff = computeLineDiff(original, proposed);

    expect(diff.filter((l) => l.type === 'removed')).toEqual([{ type: 'removed', content: 'B', oldLine: 2 }]);
    expect(diff.filter((l) => l.type === 'added')).toEqual([{ type: 'added', content: 'B改', newLine: 2 }]);
    expect(diff.filter((l) => l.type === 'same')).toHaveLength(2);
  });

  it('尾部删除多行：全部标记 removed 且带原行号', () => {
    const original = ['A', 'B', 'C', 'D'].join('\n');
    const proposed = 'A';

    const diff = computeLineDiff(original, proposed);

    const removed = diff.filter((l) => l.type === 'removed');
    expect(removed.map((l) => l.content)).toEqual(['B', 'C', 'D']);
    expect(removed.map((l) => l.oldLine)).toEqual([2, 3, 4]);
    expect(diff.filter((l) => l.type === 'added')).toHaveLength(0);
  });

  it('完全相同：全部 same，行号双侧对齐', () => {
    const text = ['A', 'B', 'C'].join('\n');
    const diff = computeLineDiff(text, text);
    expect(diff).toHaveLength(3);
    expect(diff.every((l) => l.type === 'same' && l.oldLine === l.newLine)).toBe(true);
  });

  it('空文本 → 非空：全部 added', () => {
    const diff = computeLineDiff('', '新内容\n第二行');
    expect(diff.filter((l) => l.type === 'added')).toHaveLength(2);
    // '' split 后有 1 个空行，与首个非空行不同 → 1 removed
    expect(diff.filter((l) => l.type === 'removed')).toHaveLength(1);
  });

  it('顺序交换的行被正确识别（移动而非全删全加）', () => {
    const original = ['A', 'B', 'C', 'D', 'E'].join('\n');
    // 把 E 移到最前
    const proposed = ['E', 'A', 'B', 'C', 'D'].join('\n');

    const diff = computeLineDiff(original, proposed);

    expect(diff.filter((l) => l.type === 'added')).toHaveLength(1);
    expect(diff.filter((l) => l.type === 'removed')).toHaveLength(1);
    expect(diff.filter((l) => l.type === 'same')).toHaveLength(4);
  });
});

describe('collapseDiffLines', () => {
  it('不超限时不折叠', () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ type: 'same' as const, content: `行${i}` }));
    const { lines: out, collapsed } = collapseDiffLines(lines, 100);
    expect(out).toHaveLength(80);
    expect(collapsed).toBe(0);
  });

  it('超限时折叠为头尾各半 + 省略标记', () => {
    const lines = Array.from({ length: 300 }, (_, i) => ({ type: 'same' as const, content: `行${i}` }));
    const { lines: out, collapsed } = collapseDiffLines(lines, 100);
    // 50 头 + 1 标记 + 50 尾
    expect(out).toHaveLength(101);
    expect(collapsed).toBe(200);
    expect(out[50]?.content).toContain('省略 200 行');
  });
});
