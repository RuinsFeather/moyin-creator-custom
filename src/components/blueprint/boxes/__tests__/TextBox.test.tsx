// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { TextBox } from '../TextBox';

import { useBlueprintStore } from '@/stores/blueprint-store';
import type { NodeProps } from '@xyflow/react';
import type { BlueprintNode } from '@/types/blueprint';

vi.mock('@/lib/skills/skill-library', () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  subscribeSkills: vi.fn(() => () => undefined),
}));

function makeProps(overrides: Partial<NodeProps<BlueprintNode>> = {}): NodeProps<BlueprintNode> {
  return {
    id: 'node-1',
    type: 'text-box',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: { nodeType: 'text-box', label: '文本框', config: { text: '' } },
    ...overrides,
  } as NodeProps<BlueprintNode>;
}

function renderTextBox(overrides: Partial<NodeProps<BlueprintNode>> = {}) {
  return render(
    <ReactFlowProvider>
      <TextBox {...makeProps(overrides)} />
    </ReactFlowProvider>,
  );
}

describe('TextBox', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({ updateNode: vi.fn() });
  });

  it('renders the label and empty textarea by default', () => {
    renderTextBox();
    expect(screen.getByText('文本框')).toBeTruthy();
    const textarea = screen.getByPlaceholderText('输入提示词、台词或上下文…') as HTMLTextAreaElement;
    expect(textarea.value).toBe('');
  });

  it('renders existing config text in the textarea', () => {
    renderTextBox({ data: { nodeType: 'text-box', label: '文本框', config: { text: '你好' } } });
    const textarea = screen.getByPlaceholderText('输入提示词、台词或上下文…') as HTMLTextAreaElement;
    expect(textarea.value).toBe('你好');
  });

  it('calls updateNode with patched text when typing', () => {
    const updateNode = vi.fn();
    useBlueprintStore.setState({ updateNode });
    renderTextBox();
    const textarea = screen.getByPlaceholderText('输入提示词、台词或上下文…');
    fireEvent.change(textarea, { target: { value: '新内容' } });
    expect(updateNode).toHaveBeenCalledWith('node-1', {
      config: { text: '新内容' },
    });
  });

  it('shows character count only when text is non-empty', () => {
    renderTextBox({ data: { nodeType: 'text-box', label: '文本框', config: { text: 'abc' } } });
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('opens the local AI assist panel without selecting the node', () => {
    const selectNode = vi.fn();
    useBlueprintStore.setState({ selectNode, updateNode: vi.fn() });
    renderTextBox();
    const aiButton = screen.getByTitle('AI 写作助手');
    fireEvent.click(aiButton);
    expect(screen.getByText('AI 写作助手')).toBeTruthy();
    expect(selectNode).not.toHaveBeenCalled();
  });

  it('highlights the ✨ button while the local panel is open', () => {
    renderTextBox();
    const aiButton = screen.getByTitle('AI 写作助手');
    fireEvent.click(aiButton);
    expect(aiButton.className).toContain('bg-primary/20');
  });
});
