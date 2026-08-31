// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE and details in LICENSE.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 剧本助手参考栏「浏览替换」语义测试
 *
 * browseAgentContextFile 覆盖：
 *   - 浏览新文件时替换上一个未勾选的浏览参考（不再堆积）
 *   - 已勾选（active=true）的浏览参考保留
 *   - 手动添加（addedBy='manual'，拖拽/外部导入/目录上下文）的条目保留
 *   - 重复浏览同一文件不重复添加
 *   - 旧持久化数据无 addedBy 字段按 'manual' 保守处理（不被替换删除）
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { useScriptWorkspaceStore } from '@/stores/script-workspace-store';
import type { AgentContextFile } from '@/stores/script-workspace-store';

function file(path: string, extra: Partial<AgentContextFile> = {}): AgentContextFile {
  return { id: `id-${path}`, name: path, path, source: 'workspace', active: false, ...extra };
}

const state = () => useScriptWorkspaceStore.getState().agentContextFiles;

beforeEach(() => {
  useScriptWorkspaceStore.setState({ agentContextFiles: [] });
});

describe('browseAgentContextFile 浏览替换语义', () => {
  it('浏览新文件时移除上一个未勾选的浏览参考', () => {
    const store = useScriptWorkspaceStore.getState();
    store.browseAgentContextFile(file('a.md'));
    expect(state()).toHaveLength(1);
    expect(state()[0].path).toBe('a.md');
    expect(state()[0].addedBy).toBe('browse');

    store.browseAgentContextFile(file('b.md'));
    expect(state()).toHaveLength(1);
    expect(state()[0].path).toBe('b.md');
  });

  it('已勾选（active）的浏览参考不会被替换删除', () => {
    const store = useScriptWorkspaceStore.getState();
    store.browseAgentContextFile(file('a.md'));
    // 用户勾选 a.md 作为参考
    store.toggleAgentContextFile('id-a.md');
    expect(state()[0].active).toBe(true);

    store.browseAgentContextFile(file('b.md'));
    expect(state()).toHaveLength(2);
    expect(state().map((item) => item.path)).toEqual(['a.md', 'b.md']);
    // 再浏览第三个文件，a.md 仍保留，b.md（未勾选）被替换
    store.browseAgentContextFile(file('c.md'));
    expect(state().map((item) => item.path)).toEqual(['a.md', 'c.md']);
  });

  it('手动添加的条目（addedBy=manual）不受浏览替换影响', () => {
    const store = useScriptWorkspaceStore.getState();
    store.addAgentContextFile(file('dragged.md', { addedBy: 'manual' }));
    store.addAgentContextFile({ id: 'ext-1', name: 'ext.md', path: 'ext.md', content: 'x', source: 'external', active: false, addedBy: 'manual' });

    store.browseAgentContextFile(file('a.md'));
    expect(state().map((item) => item.path)).toEqual(['dragged.md', 'ext.md', 'a.md']);

    store.browseAgentContextFile(file('b.md'));
    expect(state().map((item) => item.path)).toEqual(['dragged.md', 'ext.md', 'b.md']);
  });

  it('目录上下文（isDirectory）作为手动添加保留', () => {
    const store = useScriptWorkspaceStore.getState();
    store.addAgentContextFile({
      id: 'folder:docs',
      name: 'docs (3 个文件)',
      path: 'docs',
      source: 'workspace',
      active: false,
      isDirectory: true,
      addedBy: 'manual',
    });

    store.browseAgentContextFile(file('a.md'));
    store.browseAgentContextFile(file('b.md'));
    const paths = state().map((item) => item.path);
    expect(paths).toContain('docs');
    expect(paths).toContain('b.md');
    expect(paths).not.toContain('a.md');
    expect(state()).toHaveLength(2);
  });

  it('重复浏览同一文件不重复添加且清理其它未勾选浏览参考', () => {
    const store = useScriptWorkspaceStore.getState();
    store.browseAgentContextFile(file('a.md'));
    // 再次点选同一文件 a.md（如右键菜单打开）
    store.browseAgentContextFile(file('a.md'));
    expect(state()).toHaveLength(1);
    expect(state()[0].path).toBe('a.md');

    // a.md 勾选后再次浏览同一文件：状态保持勾选，不产生重复
    store.toggleAgentContextFile('id-a.md');
    store.browseAgentContextFile(file('a.md'));
    expect(state()).toHaveLength(1);
    expect(state()[0].active).toBe(true);
  });

  it('已勾选的同一文件再次浏览时保留勾选状态', () => {
    const store = useScriptWorkspaceStore.getState();
    store.browseAgentContextFile(file('a.md'));
    store.toggleAgentContextFile('id-a.md'); // 勾选

    // 浏览 b.md 再回到 a.md（已存在且勾选）→ 不新增条目
    store.browseAgentContextFile(file('b.md'));
    store.browseAgentContextFile(file('a.md'));
    const aEntries = state().filter((item) => item.path === 'a.md');
    expect(aEntries).toHaveLength(1);
    expect(aEntries[0].active).toBe(true);
    // b.md（未勾选浏览参考）被清理
    expect(state().map((item) => item.path)).toEqual(['a.md']);
  });

  it('旧持久化数据无 addedBy 字段按 manual 保守处理', () => {
    const store = useScriptWorkspaceStore.getState();
    // 模拟旧版本 persist 恢复出的条目（无 addedBy 字段）
    useScriptWorkspaceStore.setState({
      agentContextFiles: [file('legacy.md')],
    });

    store.browseAgentContextFile(file('a.md'));
    expect(state().map((item) => item.path)).toEqual(['legacy.md', 'a.md']);

    store.browseAgentContextFile(file('b.md'));
    // legacy 条目仍在，仅浏览参考被替换
    expect(state().map((item) => item.path)).toEqual(['legacy.md', 'b.md']);
  });
});
