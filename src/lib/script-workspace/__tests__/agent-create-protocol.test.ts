// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * P2 CREATE 协议 + safe-path 路径校验测试
 */

import { describe, it, expect } from 'vitest';
import {
  EDIT_OPEN,
  CREATE_OPEN,
  parseAgentResponse,
  renderStreamingText,
} from '../agent-protocol';
import {
  isSafeRelativePath,
  hasEditableExtension,
  validateCreatePath,
} from '../safe-path';

describe('parseAgentResponse CREATE 协议', () => {
  it('解析 CREATE 块：kind=create', () => {
    const raw = [
      '我来新建一个分场文件。',
      CREATE_OPEN,
      'filePath: scenes/ep02.md',
      '<<<',
      '# 第二集',
      '正文',
      '>>>',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.reply.trim()).toBe('我来新建一个分场文件。');
    expect(parsed.edits).toHaveLength(1);
    expect(parsed.edits[0].filePath).toBe('scenes/ep02.md');
    expect(parsed.edits[0].kind).toBe('create');
    expect(parsed.edits[0].proposedContent).toBe('# 第二集\n正文');
  });

  it('EDIT 与 CREATE 混合输出：各自保留 kind', () => {
    const raw = [
      '说明。',
      CREATE_OPEN,
      'filePath: new.md',
      '<<<',
      '新文件',
      '>>>',
      EDIT_OPEN,
      'filePath: old.md',
      '<<<',
      '旧文件改',
      '>>>',
    ].join('\n');

    const parsed = parseAgentResponse(raw);
    expect(parsed.edits).toHaveLength(2);
    expect(parsed.edits[0]).toMatchObject({ filePath: 'new.md', kind: 'create' });
    expect(parsed.edits[1]).toMatchObject({ filePath: 'old.md', kind: 'edit' });
  });

  it('CREATE 在 EDIT 之前出现时优先命中 CREATE（取更靠前的标记）', () => {
    const raw = [
      CREATE_OPEN,
      'filePath: first.md',
      '<<<',
      'A',
      '>>>',
      EDIT_OPEN,
      'filePath: second.md',
      '<<<',
      'B',
      '>>>',
    ].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.edits.map((e) => e.filePath)).toEqual(['first.md', 'second.md']);
    expect(parsed.edits[0].kind).toBe('create');
    expect(parsed.edits[1].kind).toBe('edit');
  });

  it('未闭合的 CREATE 块（流式中断）被忽略', () => {
    const raw = ['部分回复', CREATE_OPEN, 'filePath: unfinished.md', '<<<', '写到一半'].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.edits).toHaveLength(0);
  });

  it('旧 EDIT 输出无 kind 字段（向后兼容）', () => {
    const raw = ['说明', EDIT_OPEN, 'filePath: a.md', '<<<', 'A', '>>>'].join('\n');
    const parsed = parseAgentResponse(raw);
    expect(parsed.edits[0].kind).toBe('edit');
  });
});

describe('renderStreamingText CREATE', () => {
  it('流式中：CREATE 头未闭合时截断展示', () => {
    const partial = '回答\n' + CREATE_OPEN + '\nfilePath: x.md\n<<<\n写到一半';
    expect(renderStreamingText(partial)).not.toContain(CREATE_OPEN);
    expect(renderStreamingText(partial)).toContain('回答');
  });

  it('完整 CREATE 块：显示“新建”前缀', () => {
    const raw = ['好了。', CREATE_OPEN, 'filePath: a.md', '<<<', 'AA', '>>>'].join('\n');
    const rendered = renderStreamingText(raw);
    expect(rendered).toContain('新建 a.md');
    expect(rendered).toContain('待确认');
  });
});

describe('safe-path', () => {
  it('isSafeRelativePath：合法相对路径', () => {
    expect(isSafeRelativePath('scenes/ep01.md')).toBe(true);
    expect(isSafeRelativePath('outline.md')).toBe(true);
    expect(isSafeRelativePath('a/b/c/d.md')).toBe(true);
  });

  it('isSafeRelativePath：拒绝绝对路径/回溯/反斜杠/空', () => {
    expect(isSafeRelativePath('/abs/path.md')).toBe(false);
    expect(isSafeRelativePath('../escape.md')).toBe(false);
    expect(isSafeRelativePath('a/../../escape.md')).toBe(false);
    expect(isSafeRelativePath('a\\b.md')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a//b.md')).toBe(false);  // 空段
    expect(isSafeRelativePath('a/./b.md')).toBe(false); // . 段
  });

  it('hasEditableExtension：白名单后缀', () => {
    expect(hasEditableExtension('a.md')).toBe(true);
    expect(hasEditableExtension('a.TXT'.toLowerCase())).toBe(true);
    expect(hasEditableExtension('a.markdown')).toBe(true);
    expect(hasEditableExtension('a.exe')).toBe(false);
    expect(hasEditableExtension('noext')).toBe(false);
    expect(hasEditableExtension('a.MD')).toBe(true); // 大小写不敏感
  });

  it('validateCreatePath：返回中文错误或 null', () => {
    expect(validateCreatePath('scenes/new.md')).toBeNull();
    expect(validateCreatePath('')).toContain('为空');
    expect(validateCreatePath('/abs.md')).toContain('不安全');
    expect(validateCreatePath('../x.md')).toContain('不安全');
    expect(validateCreatePath('script.js')).toContain('后缀');
  });
});
