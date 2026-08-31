// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL LICENSE.md.

/**
 * P2 会话搜索纯函数测试
 */

import { describe, it, expect } from 'vitest';
import { searchAgentSessions } from '../session-search';
import type { AgentChatSession } from '@/stores/script-workspace-store';

function makeSession(
  id: string,
  title: string,
  contents: string[],
  updatedAt = Date.now(),
): AgentChatSession {
  return {
    id,
    title,
    messages: contents.map((content, i) => ({
      id: `${id}-m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content,
      createdAt: updatedAt - (contents.length - i),
    })),
    createdAt: updatedAt - contents.length,
    updatedAt,
  } as unknown as AgentChatSession;
}

describe('searchAgentSessions', () => {
  const sessions = [
    makeSession('s1', '第一集分场讨论', ['帮我拆分第一集的分场结构', '好的，以下是分场建议…']),
    makeSession('s2', '角色设定', ['主角的背景故事是什么？', '主角林渡是一名舟师…']),
    makeSession('s3', 'weekly review', ['本周进度汇报', '本周完成了 P0 与 P1 开发。']),
  ];

  it('空 query：返回全量会话，snippet 为空', () => {
    const results = searchAgentSessions(sessions, '');
    expect(results).toHaveLength(3);
    expect(results[0].snippet).toBe('');
  });

  it('仅空白 query：等同全量', () => {
    expect(searchAgentSessions(sessions, '   ')).toHaveLength(3);
  });

  it('标题命中：snippet 即标题（不再重复显示命中行）', () => {
    const results = searchAgentSessions(sessions, '角色');
    expect(results.map((r) => r.session.id)).toEqual(['s2']);
    expect(results[0].snippet).toBe('角色设定');
  });

  it('消息内容命中：返回首处片段（带省略号上下文）', () => {
    const results = searchAgentSessions(sessions, '分场');
    expect(results.map((r) => r.session.id)).toContain('s1');
    const hit = results.find((r) => r.session.id === 's1');
    expect(hit?.snippet).toContain('分场');
    // s1 标题也含“分场”，标题命中优先（snippet = 标题）
    expect(hit?.snippet).toBe('第一集分场讨论');
  });

  it('内容-only 命中：snippet 来自消息正文', () => {
    const results = searchAgentSessions(sessions, '林渡');
    expect(results.map((r) => r.session.id)).toEqual(['s2']);
    expect(results[0].snippet).toContain('林渡');
    expect(results[0].snippet).not.toBe('角色设定');
  });

  it('大小写不敏感：英文小写 query 命中大写内容', () => {
    const results = searchAgentSessions(sessions, 'p0');
    expect(results.map((r) => r.session.id)).toEqual(['s3']);
    expect(results[0].snippet.toLowerCase()).toContain('p0');
  });

  it('无命中：返回空数组', () => {
    expect(searchAgentSessions(sessions, '不存在的关键词xyz')).toHaveLength(0);
  });

  it('空会话列表：返回空', () => {
    expect(searchAgentSessions([], '任何')).toHaveLength(0);
  });
});
