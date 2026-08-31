// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑤⑥ 剧本助手消息操作测试
 *
 * 覆盖：
 *   - updateAgentMessage 部分更新：reasoning 字段独立于 content 写入
 *   - reasoning 未传时不覆盖已有值（流式 text 更新不清空思考过程）
 *   - truncateAgentMessages：重新生成语义（截断到触发消息前）+ 同步 agentSessions
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import type { AgentMessage } from '@/stores/script-workspace-store';

function msg(id: string, role: 'user' | 'assistant', content: string): AgentMessage {
  return { id, role, content, timestamp: Date.now() };
}

beforeEach(() => {
  const store = useScriptWorkspaceStore.getState();
  store.createAgentSession();
  useScriptWorkspaceStore.setState({ agentMessages: [], agentSessions: useScriptWorkspaceStore.getState().agentSessions.slice(0, 1) });
  useScriptWorkspaceStore.getState().createAgentSession();
});

describe('updateAgentMessage 部分更新（⑥ 思考过程）', () => {
  it('partial.reasoning 只更新 reasoning，不动 content', () => {
    const store = useScriptWorkspaceStore.getState();
    const id = 'm-reason';
    store.addAgentMessage({ ...msg(id, 'assistant', '正文'), reasoning: '' });

    useScriptWorkspaceStore.getState().updateAgentMessage(id, '正文', { reasoning: '第一步：分析剧情' });

    const updated = useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === id);
    expect(updated?.reasoning).toBe('第一步：分析剧情');
    expect(updated?.content).toBe('正文');
  });

  it('流式 text 增量更新（不传 partial）不清空已有 reasoning', () => {
    const store = useScriptWorkspaceStore.getState();
    const id = 'm-mixed';
    store.addAgentMessage({ ...msg(id, 'assistant', '…'), reasoning: '思考片段' });

    // 模拟 onText text 通道：只传 content
    useScriptWorkspaceStore.getState().updateAgentMessage(id, '正文增量');

    const updated = useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === id);
    expect(updated?.content).toBe('正文增量');
    expect(updated?.reasoning).toBe('思考片段');
  });

  it('reasoning 与 content 同时更新（text 通道带已有 reasoning 快照）', () => {
    const store = useScriptWorkspaceStore.getState();
    const id = 'm-both';
    store.addAgentMessage(msg(id, 'assistant', '…'));

    useScriptWorkspaceStore.getState().updateAgentMessage(id, '正文', { reasoning: '完整思考' });
    useScriptWorkspaceStore.getState().updateAgentMessage(id, '正文续', { reasoning: '完整思考延续' });

    const updated = useScriptWorkspaceStore.getState().agentMessages.find((m) => m.id === id);
    expect(updated?.content).toBe('正文续');
    expect(updated?.reasoning).toBe('完整思考延续');
  });

  it('更新同步写入当前会话的 messages', () => {
    const store = useScriptWorkspaceStore.getState();
    const sessionId = useScriptWorkspaceStore.getState().agentSessionId;
    expect(sessionId).toBeTruthy();
    const id = 'm-sync';
    store.addAgentMessage({ ...msg(id, 'assistant', '…'), reasoning: '' });

    useScriptWorkspaceStore.getState().updateAgentMessage(id, '完成', { reasoning: '思考' });

    const session = useScriptWorkspaceStore.getState().agentSessions.find((s) => s.id === sessionId);
    expect(session?.messages.find((m) => m.id === id)?.reasoning).toBe('思考');
    expect(session?.messages.find((m) => m.id === id)?.content).toBe('完成');
  });
});

describe('truncateAgentMessages（⑤ 重新生成）', () => {
  it('截断到 userIndex+1：删除旧 assistant 回复及其后所有消息', () => {
    const store = useScriptWorkspaceStore.getState();
    store.addAgentMessage(msg('u1', 'user', '提问1'));
    store.addAgentMessage(msg('a1', 'assistant', '回答1'));
    store.addAgentMessage(msg('u2', 'user', '提问2'));
    store.addAgentMessage(msg('a2', 'assistant', '回答2'));

    // 重新生成 a2：截断到 u2 之后（index 2 + 1 = 3）
    useScriptWorkspaceStore.getState().truncateAgentMessages(3);

    const messages = useScriptWorkspaceStore.getState().agentMessages;
    expect(messages.map((m) => m.id)).toEqual(['u1', 'a1', 'u2']);
  });

  it('截断后 agentSessions 中当前会话同步', () => {
    const store = useScriptWorkspaceStore.getState();
    const sessionId = useScriptWorkspaceStore.getState().agentSessionId;
    store.addAgentMessage(msg('u1', 'user', '提问'));
    store.addAgentMessage(msg('a1', 'assistant', '回答'));

    useScriptWorkspaceStore.getState().truncateAgentMessages(1);

    const session = useScriptWorkspaceStore.getState().agentSessions.find((s) => s.id === sessionId);
    expect(session?.messages.map((m) => m.id)).toEqual(['u1']);
    expect(useScriptWorkspaceStore.getState().agentMessages.map((m) => m.id)).toEqual(['u1']);
  });

  it('越界值安全处理（负数 → 空列表）', () => {
    const store = useScriptWorkspaceStore.getState();
    store.addAgentMessage(msg('u1', 'user', '提问'));
    useScriptWorkspaceStore.getState().truncateAgentMessages(-5);
    expect(useScriptWorkspaceStore.getState().agentMessages).toHaveLength(0);
  });
});
