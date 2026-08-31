// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑦ 编辑器选区/光标上下文工具
 *
 * MarkdownEditor 的 textarea 在 select 事件中调用 buildEditorSelection，
 * 把选中文本 + 光标行列写入 store（editorSelection），供 agent context 使用。
 */

import type { EditorSelection } from '@/stores/script-workspace-store';

/**
 * 从 textarea 的 selectionStart/End 与全文计算选区上下文。
 * 无选中（start === end）时 text 为空串，仍返回光标行列 —— 续写场景需要。
 */
export function buildEditorSelection(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): EditorSelection {
  // 先各自钳制到内容长度，再交换保证 start ≤ end（textarea 不会逆序，防御外部调用）
  const rawStart = Math.max(0, Math.min(selectionStart, content.length));
  const rawEnd = Math.max(0, Math.min(selectionEnd, content.length));
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);
  const text = content.slice(start, end);
  // 光标（或选区起点）之前的行数即 0 基行号；列号为该行内偏移
  const before = content.slice(0, start);
  const line = before.length === 0 ? 0 : before.split('\n').length - 1;
  const lastLineStart = before.lastIndexOf('\n') + 1;
  const column = start - lastLineStart;
  return { text, line, column, startOffset: start, endOffset: end };
}

/** 选区是否包含实际选中文本（区别于纯光标） */
export function hasSelectedText(selection: EditorSelection | null): boolean {
  return !!selection && selection.text.length > 0;
}
