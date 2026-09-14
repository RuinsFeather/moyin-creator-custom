// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { ImageBox } from '../ImageBox';
import { useBlueprintStore } from '@/stores/blueprint-store';
import type { BlueprintNode } from '@/types/blueprint';

vi.mock('@/components/panels/freedom/VolcAssetPanel', () => ({
  VolcAssetPanel: () => null,
}));

function makeProps(overrides: Partial<NodeProps<BlueprintNode>> = {}): NodeProps<BlueprintNode> {
  return {
    id: 'node-1',
    type: 'image-box',
    selected: false,
    dragging: false,
    zIndex: 0,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    data: { nodeType: 'image-box', label: '图片框', config: { media: [] } },
    ...overrides,
  } as NodeProps<BlueprintNode>;
}

function renderImageBox(overrides: Partial<NodeProps<BlueprintNode>> = {}) {
  return render(
    <ReactFlowProvider>
      <ImageBox {...makeProps(overrides)} />
    </ReactFlowProvider>,
  );
}

describe('ImageBox', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useBlueprintStore.setState({ updateNode: vi.fn(), selectNode: vi.fn() });
  });

  it('renders the label and an empty drop zone by default (no media)', () => {
    renderImageBox();
    expect(screen.getByText('图片框')).toBeTruthy();
    expect(screen.getByText('拖入图片或点击选择')).toBeTruthy();
  });

  it('renders the last image when media is present', () => {
    renderImageBox({
      data: {
        nodeType: 'image-box',
        label: '图片框',
        config: { media: [{ url: 'https://example.com/a.png' }] },
      },
    });
    const img = screen.getByAltText('图片预览') as HTMLImageElement;
    expect(img.src).toBe('https://example.com/a.png');
  });

  it('shows download and asset-library buttons when media exists', () => {
    renderImageBox({
      data: {
        nodeType: 'image-box',
        label: '图片框',
        config: { media: [{ url: 'https://example.com/a.png' }] },
      },
    });
    expect(screen.getByText('⬇ 下载')).toBeTruthy();
    expect(screen.getByText('🗂 素材库')).toBeTruthy();
    expect(screen.queryByText('⬆ 上传到素材库')).toBeNull();
  });

  it('no longer renders an inline 重新生成 button (drawer is the entry)', () => {
    renderImageBox({
      data: {
        nodeType: 'image-box',
        label: '图片框',
        config: { media: [{ url: 'https://example.com/a.png' }], generation: { prompt: '' } },
      },
    });
    expect(screen.queryByText('重新生成')).toBeNull();
  });

  it('does not render generation controls in the window empty state', () => {
    renderImageBox();
    expect(screen.queryByText('生成')).toBeNull();
    expect(screen.queryByText('开始生成')).toBeNull();
  });
});
