// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { BlueprintToolbar } from '../BlueprintToolbar';
import { useBlueprintStore } from '@/stores/blueprint-store';

vi.mock('@/lib/blueprint/undo-redo', () => ({
  undo: vi.fn(),
  redo: vi.fn(),
  useCanUndo: () => false,
  useCanRedo: () => false,
}));

describe('BlueprintToolbar', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({
      addNode: vi.fn(),
      autoLayoutNodes: vi.fn(),
      currentRun: null,
      activeRuns: {},
      executionLock: false,
      errorSummary: [],
      cancelRun: vi.fn(),
      clearExecutionState: vi.fn(),
    });
  });

  it('renders the "添加窗口" button and no run-related buttons (P1-8)', () => {
    render(<BlueprintToolbar />);
    expect(screen.getByTestId('add-node-menu')).toBeTruthy();
    expect(screen.queryByText('▶ 选中')).toBeNull();
    expect(screen.queryByText('▶▶ 全部')).toBeNull();
  });

  it('opens the add-window menu and shows all catalog groups', () => {
    render(<BlueprintToolbar />);
    fireEvent.click(screen.getByTestId('add-node-menu'));
    expect(screen.getByText('窗口')).toBeTruthy();
    expect(screen.getByText('文本')).toBeTruthy();
  });

  it('shows "就绪" status when idle with no errors', () => {
    render(<BlueprintToolbar />);
    expect(screen.getByText('就绪')).toBeTruthy();
  });

  it('shows the error count badge when errorSummary is non-empty', () => {
    useBlueprintStore.setState({ errorSummary: [{ nodeId: 'n1', message: 'oops' } as never] });
    render(<BlueprintToolbar />);
    expect(screen.getByText('⚠ 1 个错误')).toBeTruthy();
  });

  it('opens the more menu and calls autoLayoutNodes when clicking 自动布局', () => {
    const autoLayoutNodes = vi.fn();
    useBlueprintStore.setState({ autoLayoutNodes });
    render(<BlueprintToolbar />);
    fireEvent.click(screen.getByTitle('更多'));
    fireEvent.click(screen.getByText('自动布局'));
    expect(autoLayoutNodes).toHaveBeenCalledTimes(1);
  });

  it('calls onToggleMetrics when the metrics item in the more menu is clicked', () => {
    const onToggleMetrics = vi.fn();
    render(<BlueprintToolbar onToggleMetrics={onToggleMetrics} metricsOpen={false} />);
    fireEvent.click(screen.getByTitle('更多'));
    fireEvent.click(screen.getByText('显示指标面板'));
    expect(onToggleMetrics).toHaveBeenCalledTimes(1);
  });
});
