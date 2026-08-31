// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and COMMERCIAL_LICENSE.md.

/**
 * P2 store 层：applyDiff create 分支 + revertDiff 撤销语义
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useScriptWorkspaceStore, type AgentMessage } from '@/stores/script-workspace-store';

const baseFile = {
  id: 'f1',
  name: 'old.md',
  path: 'old.md',
  type: 'markdown' as const,
  content: '旧内容\n第一段',
  lastModified: 1000,
  isDirty: false,
  editable: true,
};

/** 构造完整 AgentMessage（store 的 addAgentMessage 需要完整字段） */
function makeMessage(partial: {
  role: 'user' | 'assistant' | 'system';
  content: string;
  diff?: AgentMessage['diff'];
}): AgentMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 10)}`,
    role: partial.role,
    content: partial.content,
    timestamp: Date.now(),
    ...(partial.diff ? { diff: partial.diff } : {}),
  };
}

beforeEach(() => {
  useScriptWorkspaceStore.setState({
    files: [baseFile],
    editorContent: '旧内容\n第一段',
    activeFileId: 'f1',
    agentMessages: [],
    agentSessions: [],
    agentContextFiles: [],
    agentSessionId: null,
    workspaceRoot: null,
  });
});

describe('applyDiff：create 分支', () => {
  it('工作区无该路径时：新建文件条目并应用', () => {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '建议新建 characters/hero.md',
      diff: {
        filePath: 'characters/hero.md',
        original: '',
        proposed: '# 主角设定',
        kind: 'create',
      },
    }));
    const withDiff = useScriptWorkspaceStore.getState();
    const target = withDiff.agentMessages.find((m) => m.diff);

    withDiff.applyDiff(target!.id);

    const applied = useScriptWorkspaceStore.getState();
    const created = applied.files.find((f) => f.path === 'characters/hero.md');
    expect(created).toBeDefined();
    expect(created?.content).toBe('# 主角设定');
    expect(created?.name).toBe('hero.md');
    expect(created?.isDirty).toBe(true);
    expect(created?.editable).toBe(true);
    const updated = applied.agentMessages.find((m) => m.diff);
    expect(updated?.diff?.applied).toBe(true);
    expect(updated?.diff?.reverted).toBe(false);
  });

  it('工作区已存在同路径：覆写既有条目内容', () => {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '覆写',
      diff: {
        filePath: 'old.md',
        original: '旧内容\n第一段',
        proposed: '新内容',
        kind: 'create',
      },
    }));
    const state = useScriptWorkspaceStore.getState();
    const target = state.agentMessages.find((m) => m.diff);
    state.applyDiff(target!.id);

    const applied = useScriptWorkspaceStore.getState();
    expect(applied.files.filter((f) => f.path === 'old.md')).toHaveLength(1);
    expect(applied.files.find((f) => f.path === 'old.md')?.content).toBe('新内容');
    expect(applied.editorContent).toBe('新内容');
  });

  // ── Bug1 回归：applyDiff({ saved: true }) 原子完成应用+已保存 ──────────
  it('Bug1：saved:true 时一次 set 完成“应用+已保存”，无 isDirty 中间态（create 入列）', () => {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '新建',
      diff: { filePath: 'fresh/new.md', original: '', proposed: '# 新文件', kind: 'create' },
    }));
    const state = useScriptWorkspaceStore.getState();
    const msgId = state.agentMessages.find((m) => m.diff)!.id;

    state.applyDiff(msgId, { saved: true });

    const after = useScriptWorkspaceStore.getState();
    const created = after.files.find((f) => f.path === 'fresh/new.md');
    expect(created).toBeDefined();
    // 原 Bug1：create 分支 file 恒为空 → markFileSaved 被跳过 → 永远 isDirty:true
    expect(created?.isDirty).toBe(false);
    expect(after.agentMessages.find((m) => m.id === msgId)?.diff?.applied).toBe(true);
  });

  it('Bug1：saved:true 对 edit 覆写同样置 isDirty:false', () => {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '修改',
      diff: { filePath: 'old.md', original: '旧内容\n第一段', proposed: '改后内容', kind: 'edit' },
    }));
    const state = useScriptWorkspaceStore.getState();
    const msgId = state.agentMessages.find((m) => m.diff)!.id;

    state.applyDiff(msgId, { saved: true });

    const after = useScriptWorkspaceStore.getState();
    expect(after.files.find((f) => f.path === 'old.md')?.content).toBe('改后内容');
    expect(after.files.find((f) => f.path === 'old.md')?.isDirty).toBe(false);
    expect(after.lastSavedAt).not.toBeNull();
  });

  it('Bug1：默认（无 options）保持原行为 isDirty:true（未落盘场景）', () => {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '修改',
      diff: { filePath: 'old.md', original: '旧内容\n第一段', proposed: '内存中应用', kind: 'edit' },
    }));
    const state = useScriptWorkspaceStore.getState();
    const msgId = state.agentMessages.find((m) => m.diff)!.id;
    state.applyDiff(msgId);
    expect(useScriptWorkspaceStore.getState().files.find((f) => f.path === 'old.md')?.isDirty).toBe(true);
  });
});

describe('revertDiff', () => {
  function seedEditDiff(overrides: Record<string, unknown> = {}) {
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '修改建议',
      diff: {
        filePath: 'old.md',
        original: '旧内容\n第一段',
        proposed: '改成的新内容',
        kind: 'edit',
        snapshot: '磁盘快照内容',
        ...overrides,
      } as AgentMessage['diff'],
    }));
    const state = useScriptWorkspaceStore.getState();
    return state.agentMessages.find((m) => m.diff)!.id;
  }

  it('edit：已应用可撤销，回滚到 snapshot 并标记 isDirty', () => {
    const msgId = seedEditDiff();
    const store = useScriptWorkspaceStore.getState();
    store.applyDiff(msgId);
    // 模拟 Panel 落盘后回填快照
    useScriptWorkspaceStore.setState((s) => ({
      agentMessages: s.agentMessages.map((m) =>
        m.id === msgId && m.diff ? { ...m, diff: { ...m.diff, snapshot: '磁盘快照内容' } } : m,
      ),
    }));
    useScriptWorkspaceStore.getState().revertDiff(msgId);

    const after = useScriptWorkspaceStore.getState();
    expect(after.files.find((f) => f.path === 'old.md')?.content).toBe('磁盘快照内容');
    expect(after.files.find((f) => f.path === 'old.md')?.isDirty).toBe(true);
    const msg = after.agentMessages.find((m) => m.id === msgId);
    expect(msg?.diff?.reverted).toBe(true);
  });

  it('edit：无 snapshot 时回滚到 original', () => {
    const msgId = seedEditDiff({ snapshot: null });
    useScriptWorkspaceStore.getState().applyDiff(msgId);
    useScriptWorkspaceStore.getState().revertDiff(msgId);

    const after = useScriptWorkspaceStore.getState();
    expect(after.files.find((f) => f.path === 'old.md')?.content).toBe('旧内容\n第一段');
  });

  it('create：撤销后删除新建的文件条目（活动文件被删则清空编辑器）', () => {
    // 先 create 应用
    useScriptWorkspaceStore.getState().addAgentMessage(makeMessage({
      role: 'assistant',
      content: '新建',
      diff: { filePath: 'new/scene.md', original: '', proposed: '# 新场景', kind: 'create' },
    }));
    let state = useScriptWorkspaceStore.getState();
    const createMsgId = state.agentMessages.find((m) => m.diff)!.id;
    state.applyDiff(createMsgId);

    // 设为活动文件
    const createdFile = useScriptWorkspaceStore.getState().files.find((f) => f.path === 'new/scene.md')!;
    useScriptWorkspaceStore.setState({ activeFileId: createdFile.id, editorContent: '# 新场景' });

    useScriptWorkspaceStore.getState().revertDiff(createMsgId);

    const after = useScriptWorkspaceStore.getState();
    expect(after.files.find((f) => f.path === 'new/scene.md')).toBeUndefined();
    expect(after.editorContent).toBe('');
    const msg = after.agentMessages.find((m) => m.id === createMsgId);
    expect(msg?.diff?.reverted).toBe(true);
    expect(msg?.diff?.applied).toBe(true);
  });

  it('未应用的消息调用 revertDiff 不生效', () => {
    const msgId = seedEditDiff({ applied: undefined });
    useScriptWorkspaceStore.getState().revertDiff(msgId);
    const after = useScriptWorkspaceStore.getState();
    expect(after.agentMessages.find((m) => m.id === msgId)?.diff?.reverted).toBeUndefined();
    expect(after.files.find((f) => f.path === 'old.md')?.content).toBe('旧内容\n第一段');
  });

  it('已撤销的消息再次 revertDiff 不会重复回滚', () => {
    const msgId = seedEditDiff();
    const store = useScriptWorkspaceStore.getState();
    store.applyDiff(msgId);
    store.revertDiff(msgId);
    // 第二次撤销（内容已被外部改成别的）不应再回滚
    useScriptWorkspaceStore.setState((s) => ({
      files: s.files.map((f) => (f.path === 'old.md' ? { ...f, content: '外部编辑的内容' } : f)),
    }));
    useScriptWorkspaceStore.getState().revertDiff(msgId);
    expect(useScriptWorkspaceStore.getState().files.find((f) => f.path === 'old.md')?.content).toBe('外部编辑的内容');
  });
});
