// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑦ 选区上下文测试：行列计算、无选区纯光标、越界钳制
 */

import { describe, expect, it } from 'vitest';
import { buildEditorSelection, hasSelectedText } from '@/lib/script-workspace/agent-selection';

describe('buildEditorSelection', () => {
  it('计算光标行列（无选区）', () => {
    const content = '第一行\n第二行\n第三行';
    // 光标在第二行行首（偏移 4）
    const sel = buildEditorSelection(content, 4, 4);
    expect(sel).toEqual({ text: '', line: 1, column: 0, startOffset: 4, endOffset: 4 });
  });

  it('计算光标列号（行内偏移）', () => {
    const content = 'ABC\nDEF';
    // 光标在 D 之后（偏移 5）
    const sel = buildEditorSelection(content, 5, 5);
    expect(sel.line).toBe(1);
    expect(sel.column).toBe(1);
  });

  it('选中文本：text 与起止偏移正确', () => {
    const content = 'AAAA\nBBBB\nCCCC';
    // 选中 B 的前三个字符（偏移 5-8，5 是第二行行首）
    const sel = buildEditorSelection(content, 5, 8);
    expect(sel.text).toBe('BBB');
    expect(sel.startOffset).toBe(5);
    expect(sel.endOffset).toBe(8);
    expect(sel.line).toBe(1);
    expect(sel.column).toBe(0);
  });

  it('跨行选区', () => {
    const content = 'A\nB\nC';
    // 从 A 之后选到 C 之前（跨第二行）
    const sel = buildEditorSelection(content, 1, 4);
    expect(sel.text).toBe('\nB\n');
    expect(sel.line).toBe(0);
    expect(sel.column).toBe(1);
  });

  it('文档起始光标：line 0, column 0', () => {
    const sel = buildEditorSelection('任意内容', 0, 0);
    expect(sel.line).toBe(0);
    expect(sel.column).toBe(0);
  });

  it('越界偏移被钳制到内容长度', () => {
    const content = 'AB';
    const sel = buildEditorSelection(content, 10, 20);
    expect(sel.startOffset).toBe(2);
    expect(sel.endOffset).toBe(2);
    expect(sel.text).toBe('');
  });

  it('start > end 时自动交换（防御）', () => {
    const content = 'ABCDEF';
    const sel = buildEditorSelection(content, 5, 2);
    expect(sel.startOffset).toBe(2);
    expect(sel.endOffset).toBe(5);
    expect(sel.text).toBe('CDE');
  });
});

describe('hasSelectedText', () => {
  it('null 与空选区返回 false，有文本返回 true', () => {
    expect(hasSelectedText(null)).toBe(false);
    expect(hasSelectedText({ text: '', line: 0, column: 0, startOffset: 0, endOffset: 0 })).toBe(false);
    expect(hasSelectedText({ text: '选中', line: 0, column: 0, startOffset: 0, endOffset: 2 })).toBe(true);
  });
});
