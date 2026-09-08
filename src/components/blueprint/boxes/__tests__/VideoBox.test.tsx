// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { VideoBox } from '../VideoBox';
import { useBlueprintStore } from '@/stores/blueprint-store';
import type { BlueprintNode } from '@/types/blueprint';

function makeProps(overrides: Partial<NodeProps<BlueprintNode>> = {}): NodeProps<BlueprintNode> {
  return {
    id: 'node-1',
    type: 'video-box',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: { nodeType: 'video-box', label: '视频框', config: { media: [] } },
    ...overrides,
  } as NodeProps<BlueprintNode>;
}

function renderVideoBox(overrides: Partial<NodeProps<BlueprintNode>> = {}) {
  return render(
    <ReactFlowProvider>
      <VideoBox {...makeProps(overrides)} />
    </ReactFlowProvider>,
  );
}

describe('VideoBox', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({ updateNode: vi.fn(), selectNode: vi.fn() });
  });

  it('renders the label and an empty drop zone by default (upload mode)', () => {
    renderVideoBox();
    expect(screen.getByText('视频框')).toBeTruthy();
    expect(screen.getByText('拖入视频或点击选择')).toBeTruthy();
  });

  it('renders the current video preview when media exists', () => {
    renderVideoBox({
      data: {
        nodeType: 'video-box',
        label: '视频框',
        config: { media: [{ url: 'https://example.com/a.mp4' }] },
      },
    });
    const video = document.querySelector('video') as HTMLVideoElement;
    expect(video).toBeTruthy();
    expect(video.getAttribute('src')).toBe('https://example.com/a.mp4');
  });

  it('shows download button when media exists', () => {
    renderVideoBox({
      data: {
        nodeType: 'video-box',
        label: '视频框',
        config: { media: [{ url: 'https://example.com/a.mp4' }] },
      },
    });
    expect(screen.getByText('⬇ 下载')).toBeTruthy();
  });

  it('does not render generation controls in the window empty state', () => {
    renderVideoBox();
    expect(screen.queryByText('生成')).toBeNull();
    expect(screen.queryByText('开始生成')).toBeNull();
  });
});
