// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { CanvasContextMenu } from '../CanvasContextMenu';
import { useBlueprintStore } from '@/stores/blueprint-store';

function renderMenu(onClose = vi.fn()) {
  const utils = render(
    <ReactFlowProvider>
      <CanvasContextMenu x={100} y={200} onClose={onClose} />
    </ReactFlowProvider>,
  );
  return { ...utils, onClose };
}

describe('CanvasContextMenu', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({ addNode: vi.fn() });
  });

  it('renders both "窗口" and "高级" groups with all box catalog items', () => {
    renderMenu();
    expect(screen.getByText('窗口')).toBeTruthy();
    expect(screen.getByText('高级')).toBeTruthy();
    expect(screen.getByText('文本')).toBeTruthy();
    expect(screen.getByText('图片')).toBeTruthy();
    expect(screen.getByText('视频')).toBeTruthy();
    expect(screen.getByText('剧本导入')).toBeTruthy();
  });

  it('calls addNode and onClose when a catalog item is clicked', () => {
    const addNode = vi.fn();
    useBlueprintStore.setState({ addNode });
    const { onClose } = renderMenu();
    fireEvent.click(screen.getByText('文本'));
    expect(addNode).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const { onClose } = renderMenu();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when clicking outside the menu', () => {
    const { onClose } = renderMenu();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
