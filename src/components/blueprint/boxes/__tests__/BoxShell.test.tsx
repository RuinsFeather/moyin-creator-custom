// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { BoxShell } from '../BoxShell';
import { useBlueprintStore } from '@/stores/blueprint-store';

function renderShell(overrides: Partial<Parameters<typeof BoxShell>[0]> = {}) {
  return render(
    <ReactFlowProvider>
      <BoxShell
        id="node-1"
        nodeType="text-box"
        icon="📝"
        label="我的文本框"
        {...overrides}
      >
        <div>子内容</div>
      </BoxShell>
    </ReactFlowProvider>,
  );
}

describe('BoxShell', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({
      activeBlueprintId: null,
      blueprints: [],
    });
  });

  it('renders icon, label and children', () => {
    renderShell();
    expect(screen.getByText('我的文本框')).toBeTruthy();
    expect(screen.getByText('子内容')).toBeTruthy();
  });

  it('applies selected ring styling when selected=true', () => {
    const { container } = renderShell({ selected: true });
    const shell = container.querySelector('.ring-2');
    expect(shell).toBeTruthy();
  });

  it('does not show the retry button unless execution status is failed', () => {
    renderShell();
    expect(screen.queryByTitle('重试')).toBeNull();
  });

  it('shows the retry button when execution status is failed', () => {
    renderShell({ execution: { status: 'failed' } as never });
    expect(screen.getByTitle('重试')).toBeTruthy();
  });

  it('calls removeNode when the delete button is clicked', () => {
    const removeNode = vi.fn();
    useBlueprintStore.setState({ removeNode });
    renderShell();
    fireEvent.click(screen.getByTitle('删除'));
    expect(removeNode).toHaveBeenCalledWith('node-1');
  });

  it('duplicates the node via addNode when the copy button is clicked', () => {
    const addNode = vi.fn();
    const selectNode = vi.fn();
    useBlueprintStore.setState({
      addNode,
      selectNode,
      activeBlueprintId: 'bp-1',
      blueprints: [
        {
          id: 'bp-1',
          name: 'bp',
          projectId: 'p1',
          status: 'active',
          createdAt: 0,
          updatedAt: 0,
          schemaVersion: 1,
          nodes: [
            {
              id: 'node-1',
              type: 'text-box',
              position: { x: 0, y: 0 },
              data: { nodeType: 'text-box', label: '我的文本框', config: { text: 'hi' } },
            },
          ],
          edges: [],
        } as never,
      ],
    });
    renderShell();
    fireEvent.click(screen.getByTitle('复制'));
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(selectNode).toHaveBeenCalledTimes(1);
  });
});
