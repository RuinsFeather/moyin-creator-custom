// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * ⑦⑩ 选区上报与模型覆盖 store 测试
 * 同时验证 ⑨ 分镜建议字段移除后 store 仍然可用（迁移安全）
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';

beforeEach(() => {
  useScriptWorkspaceStore.setState({
    editorSelection: null,
    agentModelOverride: null,
    agentMessages: [],
    agentSessions: [],
    agentSessionId: null,
  });
});

describe('⑦ setEditorSelection', () => {
  it('写入与清除选区', () => {
    const sel = { text: '选中段落', line: 3, column: 2, startOffset: 10, endOffset: 14 };
    useScriptWorkspaceStore.getState().setEditorSelection(sel);
    expect(useScriptWorkspaceStore.getState().editorSelection).toEqual(sel);

    useScriptWorkspaceStore.getState().setEditorSelection(null);
    expect(useScriptWorkspaceStore.getState().editorSelection).toBeNull();
  });
});

describe('⑩ setAgentModelOverride', () => {
  it('切换模型与恢复默认', () => {
    useScriptWorkspaceStore.getState().setAgentModelOverride('glm-4.7');
    expect(useScriptWorkspaceStore.getState().agentModelOverride).toBe('glm-4.7');

    useScriptWorkspaceStore.getState().setAgentModelOverride(null);
    expect(useScriptWorkspaceStore.getState().agentModelOverride).toBeNull();
  });
});

describe('⑨ 分镜建议移除后的 store 兼容', () => {
  it('会话切换/清空不再操作分镜建议字段（action 全部可调用）', () => {
    const store = useScriptWorkspaceStore.getState();
    store.createAgentSession();
    store.addAgentMessage({ id: 'm1', role: 'user', content: '你好', timestamp: Date.now() });
    store.selectAgentSession(useScriptWorkspaceStore.getState().agentSessionId!);
    store.clearAgentMessages();

    expect(useScriptWorkspaceStore.getState().agentMessages).toHaveLength(0);
    expect('storyboardSuggestions' in useScriptWorkspaceStore.getState()).toBe(false);
  });
});
