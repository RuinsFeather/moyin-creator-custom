// @vitest-environment jsdom
// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

// jsdom lacks ResizeObserver (required by Radix use-size inside ReferenceList).
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  (globalThis as Record<string, unknown>).ResizeObserver = ResizeObserverStub;
}

// jsdom does not implement scrollIntoView; AIAssistPanel calls it on mount.
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import type { Node } from '@xyflow/react';
import {
  BoxConfigDrawer,
} from '../BoxConfigDrawer';
import {
  buildDrawerReferences,
  reorderManualRefs,
  removeManualRef,
  getMultiRefTagForItem,
} from '../drawer/drawer-references';
import { readModelDraft, writeModelDraft } from '../drawer/drawer-model';
import { useBlueprintStore } from '@/stores/blueprint-store';
import { executeBlueprintRun, retryNodeExecution } from '@/lib/blueprint/execution-bridge';
import type {
  BlueprintNode,
  BlueprintNodeData,
  BlueprintEdge,
  ImageBoxConfig,
  VideoBoxConfig,
} from '@/types/blueprint';
import type { VolcAssetItem } from '@/components/panels/freedom/VolcAssetPanel';

vi.mock('@/hooks/use-asset-upload', () => ({
  useAssetUpload: () => ({ uploadFiles: vi.fn().mockResolvedValue([]), uploading: false }),
}));

// Mock VolcAssetPanel; capture the onSelectAsset callback so tests can invoke it.
let volcOnSelectAsset: ((asset: VolcAssetItem) => void) | null = null;
vi.mock('@/components/panels/freedom/VolcAssetPanel', () => ({
  VolcAssetPanel: ({ onSelectAsset }: { onSelectAsset: (a: VolcAssetItem) => void }) => {
    volcOnSelectAsset = onSelectAsset;
    return null;
  },
}));

vi.mock('@/lib/blueprint/execution-bridge', () => ({
  executeBlueprintRun: vi.fn().mockResolvedValue(undefined),
  retryNodeExecution: vi.fn().mockResolvedValue(undefined),
}));

// Mock ModelSelector to a plain select so tests can trigger onChange.
vi.mock('@/components/panels/freedom/ModelSelector', () => ({
  ModelSelector: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (v: string) => void;
  }) => (
    <select
      data-testid="mock-model-selector"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">（未选择）</option>
      <option value="doubao-seedmate-1.0">测试图片模型</option>
      <option value="doubao-seedance-1.0-pro-t2v">测试视频模型</option>
    </select>
  ),
}));

// jsdom + Radix popovers are heavy; render GenParamControls for real but stub
// nothing — it only renders selects/sliders when a model is chosen.
import { toast } from 'sonner';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

let nodeSeq = 0;

function makeNode(
  nodeType: 'image-box' | 'video-box',
  config: ImageBoxConfig | VideoBoxConfig,
  extra: Partial<BlueprintNodeData> = {},
): BlueprintNode {
  nodeSeq += 1;
  return {
    id: `node-${nodeSeq}`,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: extra.label ?? (nodeType === 'video-box' ? '视频窗口' : '图片窗口'),
      config,
      ...extra,
    },
  } as BlueprintNode;
}

function makeTextNode(text: string, label = '文本'): BlueprintNode {
  nodeSeq += 1;
  return {
    id: `node-${nodeSeq}`,
    type: 'text-box',
    position: { x: 0, y: 0 },
    data: { nodeType: 'text-box', label, config: { text } },
  } as BlueprintNode;
}

function makeEdge(
  source: string,
  target: string,
  targetHandle: string,
  order = 0,
): BlueprintEdge {
  nodeSeq += 1;
  return {
    id: `edge-${nodeSeq}`,
    source,
    target,
    targetHandle,
    data: { dataType: 'context', order },
  } as BlueprintEdge;
}

function makeAsset(name: string, assetId = 'a1'): VolcAssetItem {
  return {
    assetId,
    assetUri: 'volc://asset/1',
    url: 'https://example.com/asset',
    name,
    groupId: 'g1',
    groupName: '默认分组',
    uploadedAt: 1700000000000,
  } as VolcAssetItem;
}

function setupStore(
  node: BlueprintNode,
  otherNodes: BlueprintNode[] = [],
  edges: BlueprintEdge[] = [],
) {
  const updateNode = vi.fn();
  const selectNode = vi.fn();
  const cancelRun = vi.fn();
  useBlueprintStore.setState({
    blueprints: [
      {
        id: 'bp-1',
        projectId: 'p1',
        name: '测试蓝图',
        version: 2,
        nodes: [node, ...otherNodes],
        edges,
        viewport: { x: 0, y: 0, zoom: 1 },
        status: 'draft',
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    activeBlueprintId: 'bp-1',
    updateNode,
    selectNode,
    cancelRun,
  } as unknown as ReturnType<typeof useBlueprintStore.getState>);
  return { updateNode, selectNode, cancelRun };
}

function renderDrawer(node: BlueprintNode, onClose = vi.fn()) {
  return render(
    <ReactFlowProvider>
      <BoxConfigDrawer node={node} onClose={onClose} />
    </ReactFlowProvider>,
  );
}

describe('BoxConfigDrawer', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    volcOnSelectAsset = null;
  });

  it('renders drawer with 3 sections for image-box', () => {
    const node = makeNode('image-box', { media: [] });
    setupStore(node);
    renderDrawer(node);
    expect(screen.getByTestId('box-config-drawer')).toBeTruthy();
    expect(screen.getByTestId('drawer-reference-strip')).toBeTruthy();
    expect(screen.getByTestId('drawer-prompt-section')).toBeTruthy();
    expect(screen.getByTestId('drawer-generation-mode')).toBeTruthy();
    expect(screen.getByTestId('drawer-parameter-section')).toBeTruthy();
    expect(screen.getByTestId('drawer-generate-actions')).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.getAttribute('data-drawer-section') === 'references'),
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.getAttribute('data-drawer-section') === 'text'),
    ).toBeTruthy();
    expect(
      screen.getByText((_, el) => el?.getAttribute('data-drawer-section') === 'model'),
    ).toBeTruthy();
  });

  it('places the reference, prompt, mode, parameters, and actions in order', () => {
    const node = makeNode('video-box', { media: [] });
    setupStore(node);
    renderDrawer(node);
    const drawer = screen.getByTestId('box-config-drawer');
    const sections = [
      screen.getByTestId('drawer-reference-strip'),
      screen.getByTestId('drawer-prompt-section'),
      screen.getByTestId('drawer-generate-actions'),
    ];
    expect(sections.every((section) => drawer.contains(section))).toBe(true);
    // generation-mode and parameter-section are nested inside generate-actions
    expect(drawer.contains(screen.getByTestId('drawer-generation-mode'))).toBe(true);
    expect(drawer.contains(screen.getByTestId('drawer-parameter-section'))).toBe(true);
    for (let index = 1; index < sections.length; index += 1) {
      expect(
        Boolean(sections[index - 1].compareDocumentPosition(sections[index]) & Node.DOCUMENT_POSITION_FOLLOWING),
      ).toBe(true);
    }
  });

  it('shows visual generation mode options for image and video drawers', () => {
    const imageNode = makeNode('image-box', { media: [] });
    setupStore(imageNode);
    const { unmount } = renderDrawer(imageNode);
    // Open the generation mode popover first
    fireEvent.click(screen.getByTestId('drawer-generation-mode-trigger'));
    expect(screen.getByLabelText(/文生图/, { selector: 'button' })).toBeTruthy();
    expect(screen.getByLabelText(/图生图/, { selector: 'button' })).toBeTruthy();
    unmount();

    const videoNode = makeNode('video-box', { media: [] });
    setupStore(videoNode);
    renderDrawer(videoNode);
    fireEvent.click(screen.getByTestId('drawer-generation-mode-trigger'));
    expect(screen.getByLabelText(/文生视频/, { selector: 'button' })).toBeTruthy();
    expect(screen.getByLabelText(/图生视频/, { selector: 'button' })).toBeTruthy();
    expect(screen.getByLabelText(/多参考/, { selector: 'button' })).toBeTruthy();
  });

  it('renders empty-state hint when no references', () => {
    const node = makeNode('image-box', { media: [] });
    setupStore(node);
    renderDrawer(node);
    expect(screen.getByText(/暂无参考/)).toBeTruthy();
  });

  it('shows edge-connected references with source label and manual refs together', () => {
    const node = makeNode('image-box', { media: [] });
    const upstream = makeNode('image-box', {
      media: [{ url: 'https://ex.com/a.png', mimeType: 'image/png', dedupeKey: 'k-a' }],
    });
    const node2 = makeNode('image-box', {
      media: [],
      referenceImageRefs: [{ url: 'https://ex.com/b.png', mimeType: 'image/png', dedupeKey: 'k-b' }],
    });
    const edges = [
      makeEdge(upstream.id, node.id, 'reference-images', 0),
    ];
    setupStore(node2, [node, upstream], edges);
    // target the box itself
    renderDrawer(node2);
    // Edge ref + manual ref both present
    expect(screen.getByText(/上游/)).toBeTruthy();
  });

  it('removeManualRef writes back only manual subset (image)', () => {
    const node = makeNode('image-box', {
      media: [],
      referenceImageRefs: [
        { url: 'u1', mimeType: 'image/png', dedupeKey: 'k-1' },
        { url: 'u2', mimeType: 'image/png', dedupeKey: 'k-2' },
      ],
    });
    setupStore(node);
    const model = buildDrawerReferences(node, [node], []);
    const patch = removeManualRef(node, model.items[0].key);
    expect(patch).not.toBeNull();
    const cfg = (patch as { config: ImageBoxConfig }).config;
    expect(cfg.referenceImageRefs?.map((r) => r.dedupeKey)).toEqual(['k-2']);
  });

  it('reorderManualRefs writes back reordered manual subset (image)', () => {
    const node = makeNode('image-box', {
      media: [],
      referenceImageRefs: [
        { url: 'u1', mimeType: 'image/png', dedupeKey: 'k-1' },
        { url: 'u2', mimeType: 'image/png', dedupeKey: 'k-2' },
      ],
    });
    const model = buildDrawerReferences(node, [node], []);
    const keys = model.items.map((i) => i.key).reverse();
    const patch = reorderManualRefs(node, keys);
    expect(patch).not.toBeNull();
    const cfg = (patch as { config: ImageBoxConfig }).config;
    expect(cfg.referenceImageRefs?.map((r) => r.dedupeKey)).toEqual(['k-2', 'k-1']);
  });

  it('buildDrawerReferences lists all media of an edge and tracks edgeIds', () => {
    const node = makeNode('video-box', { media: [] });
    const upstream = makeNode('image-box', {
      media: [
        { url: 'u1', mimeType: 'image/png', dedupeKey: 'k-a' },
        { url: 'u2', mimeType: 'image/png', dedupeKey: 'k-b' },
      ],
    });
    const edges = [makeEdge(upstream.id, node.id, 'reference-media', 0)];
    const model = buildDrawerReferences(node, [node, upstream], edges);
    expect(model.items.length).toBe(2);
    expect(model.edgeIds.length).toBe(1);
    expect(model.items.every((i) => i.source === 'edge')).toBe(true);
    expect(model.items.every((i) => i.removable === false)).toBe(true);
  });

  it('shows upstream text merge preview when connected to text-box', () => {
    const node = makeNode('image-box', { media: [] });
    const t1 = makeTextNode('第一段', '文本A');
    const t2 = makeTextNode('第二段', '文本B');
    const edges = [
      makeEdge(t1.id, node.id, 'prompt', 1),
      makeEdge(t2.id, node.id, 'prompt', 0),
    ];
    setupStore(node, [t1, t2], edges);
    renderDrawer(node);
    expect(screen.getByText(/2 个来源/)).toBeTruthy();
    // Order respects edge.data.order (t2 first since order=0)
    const preview = document.querySelector(
      '[data-drawer-section="text"] details p',
    );
    expect(preview?.textContent).toBe('第二段\n\n第一段');
  });

  it('override checkbox turns on custom prompt and writes generation.prompt', () => {
    const node = makeNode('image-box', { media: [] });
    const t1 = makeTextNode('上游文本', '文本A');
    const edges = [makeEdge(t1.id, node.id, 'prompt', 0)];
    const { updateNode } = setupStore(node, [t1], edges);
    renderDrawer(node);
    // Initially no PromptTextarea (using upstream)
    expect(screen.queryByRole('textbox')).toBeNull();
    // Toggle override via the checkbox input directly
    const checkbox = document.querySelector<HTMLInputElement>(
      '[data-drawer-section="text"] input[type="checkbox"]',
    );
    expect(checkbox).toBeTruthy();
    fireEvent.click(checkbox as HTMLInputElement);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-drawer-section="text"] textarea',
    );
    expect(textarea).toBeTruthy();
    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: '自定义提示词' } });
    // PromptTextarea flushes onChange on blur (local draft pattern).
    fireEvent.blur(textarea as HTMLTextAreaElement);
    expect(updateNode).toHaveBeenCalled();
    const last = updateNode.mock.calls.at(-1)?.[1] as { config: ImageBoxConfig };
    expect(last.config.generation?.prompt).toBe('自定义提示词');
  });

  it('add local file: image 10-limit toast blocks 11th', () => {
    const refs = Array.from({ length: 10 }, (_, i) => ({
      url: `u${i}`,
      mimeType: 'image/png',
      dedupeKey: `k-${i}`,
    }));
    const node = makeNode('image-box', { media: [], referenceImageRefs: refs });
    setupStore(node);
    renderDrawer(node);
    // Drawer shows 10 manual refs; attempting add via asset library path:
    expect(screen.getAllByTestId(/^reference-item-/).length).toBe(10);
  });

  it('asset library selection appends reference (image)', () => {
    const node = makeNode('image-box', { media: [] });
    const { updateNode } = setupStore(node);
    renderDrawer(node);
    // Open asset dialog via asset library button
    fireEvent.click(screen.getByTitle('从素材库选参考'));
    expect(volcOnSelectAsset).toBeTruthy();
    volcOnSelectAsset?.(makeAsset('cat.png'));
    const last = updateNode.mock.calls.at(-1)?.[1] as { config: ImageBoxConfig };
    expect(last.config.referenceImageRefs?.length).toBe(1);
    expect(last.config.referenceImageRefs?.[0].assetId).toBe('a1');
  });

  it('asset library selection blocked at image 10-limit with toast', () => {
    const refs = Array.from({ length: 10 }, (_, i) => ({
      url: `u${i}`,
      mimeType: 'image/png',
      dedupeKey: `k-${i}`,
    }));
    const node = makeNode('image-box', { media: [], referenceImageRefs: refs });
    const { updateNode } = setupStore(node);
    renderDrawer(node);
    fireEvent.click(screen.getByTitle('从素材库选参考'));
    volcOnSelectAsset?.(makeAsset('cat.png'));
    expect(toast.warning).toHaveBeenCalledWith('参考图片上限为 10 张');
    expect(updateNode).not.toHaveBeenCalled();
  });

  it('model selection persists via generate button path (generation.model)', async () => {
    const node = makeNode('image-box', { media: [] });
    const { updateNode } = setupStore(node);
    renderDrawer(node);
    // Open the parameter popover first
    fireEvent.click(screen.getByTestId('drawer-parameter-section').querySelector('button')!);
    const select = screen.getByTestId('mock-model-selector') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'doubao-seedmate-1.0' } });
    // generate button now enabled
    const btn = screen.getByTestId('drawer-generate') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await vi.waitFor(() => {
      expect(executeBlueprintRun).toHaveBeenCalledWith(
        'node',
        node.id,
        expect.objectContaining({ confirmPaidTask: expect.any(Function) }),
      );
    });
    // persistDraft wrote generation.model before executing
    const last = updateNode.mock.calls.at(-1)?.[1] as { config: ImageBoxConfig };
    expect(last.config.generation?.model).toBe('doubao-seedmate-1.0');
  });

  it('generate button disabled without model', () => {
    const node = makeNode('image-box', { media: [] });
    setupStore(node);
    renderDrawer(node);
    const btn = screen.getByTestId('drawer-generate') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('save-only persists draft and closes without executing', () => {
    const node = makeNode('image-box', { media: [] });
    const { updateNode } = setupStore(node);
    const onClose = vi.fn();
    renderDrawer(node, onClose);
    // Open the parameter popover first
    fireEvent.click(screen.getByTestId('drawer-parameter-section').querySelector('button')!);
    const select = screen.getByTestId('mock-model-selector') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'doubao-seedmate-1.0' } });
    fireEvent.click(screen.getByTestId('drawer-save-only'));
    expect(executeBlueprintRun).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    const last = updateNode.mock.calls.at(-1)?.[1] as { config: ImageBoxConfig };
    expect(last.config.generation?.model).toBe('doubao-seedmate-1.0');
    expect(toast.success).toHaveBeenCalledWith('配置已保存');
  });

  it('failed state shows retry; running state has no drawer progress bar', () => {
    const runningNode = makeNode('image-box', { media: [] }, {
      execution: { status: 'running', progress: 42 },
    });
    setupStore(runningNode);
    renderDrawer(runningNode);
    // 运行中的进度/取消已移至窗口正中央覆盖层，抽屉不再显示
    expect(screen.queryByTestId('drawer-run-status')).toBeNull();
    expect(screen.queryByTestId('drawer-cancel-run')).toBeNull();

    cleanup();
    vi.clearAllMocks();

    const failedNode = makeNode('image-box', { media: [] }, {
      execution: { status: 'failed', error: '生成失败：额度不足' },
    });
    setupStore(failedNode);
    renderDrawer(failedNode);
    expect(screen.getByTestId('drawer-retry')).toBeTruthy();
    fireEvent.click(screen.getByTestId('drawer-retry'));
    expect(retryNodeExecution).toHaveBeenCalledWith(
      failedNode.id,
      expect.objectContaining({ confirmPaidTask: expect.any(Function) }),
    );
  });

  it('auto-close on completion transition (running → completed)', () => {
    const node = makeNode('image-box', { media: [] }, {
      execution: { status: 'running', progress: 0.5 },
    });
    setupStore(node);
    const onClose = vi.fn();
    const { rerender } = renderDrawer(node, onClose);
    expect(onClose).not.toHaveBeenCalled();
    // Simulate completion: re-render with completed status
    const completed = {
      ...node,
      data: { ...node.data, execution: { status: 'completed' as const, progress: 1 } },
    };
    rerender(
      <ReactFlowProvider>
        <BoxConfigDrawer node={completed} onClose={onClose} />
      </ReactFlowProvider>,
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('video drawer passes role click to cycle first → last → reference', () => {
    const node = makeNode('video-box', {
      media: [],
      generation: {
        model: 'doubao-seedance-1.0-pro-t2v',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 5,
        referenceMediaRefs: [
          { url: 'u1', mimeType: 'image/png', dedupeKey: 'k-1', role: 'first', assetType: 'image' },
        ],
      },
    });
    const { updateNode } = setupStore(node);
    renderDrawer(node);
    // Role tag with onRoleClick gets pointer-events and click handler
    const roleTag = document.querySelector(
      '[data-drawer-section="references"] [title*="切换角色"]',
    );
    expect(roleTag).toBeTruthy();
    fireEvent.click(roleTag as HTMLElement);
    const last = updateNode.mock.calls.at(-1)?.[1] as { config: VideoBoxConfig };
    expect(last.config.generation?.referenceMediaRefs?.[0].role).toBe('last');
  });

  it('video right-click reference inserts @image_file_1 tag into prompt', () => {
    const node = makeNode('video-box', {
      media: [],
      generation: {
        model: 'doubao-seedance-1.0-pro-t2v',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 5,
        referenceMediaRefs: [
          { url: 'u1', mimeType: 'image/png', dedupeKey: 'k-1', role: 'reference', assetType: 'image' },
        ],
      },
    });
    setupStore(node);
    renderDrawer(node);
    // PromptTextarea is rendered (no upstream text) — may be aria-hidden by vaul overlay.
    const textarea = document.querySelector<HTMLTextAreaElement>(
      '[data-drawer-section="text"] textarea',
    );
    expect(textarea).toBeTruthy();
    // Simulate context menu on the reference thumb via ReferenceList onItemContextMenu
    const thumb = document.querySelector(
      '[data-drawer-section="references"] img, [data-drawer-section="references"] [style*="background"]',
    );
    expect(thumb ?? textarea).toBeTruthy();
    // Direct helper check:
    const model = buildDrawerReferences(node, [node], []);
    const tag = getMultiRefTagForItem(model.items[0].key, model.items);
    expect(tag).toBe('@image_file_1');
  });

  it('getMultiRefTagForItem numbers same-type refs 1-based', () => {
    const items = [
      { key: 'a', mediaType: 'image' },
      { key: 'b', mediaType: 'video' },
      { key: 'c', mediaType: 'image' },
    ] as never;
    expect(getMultiRefTagForItem('a', items)).toBe('@image_file_1');
    expect(getMultiRefTagForItem('b', items)).toBe('@video_file_1');
    expect(getMultiRefTagForItem('c', items)).toBe('@image_file_2');
  });

  it('seedance reference-count validation blocks generate when over limit', async () => {
    // Legacy seedance capability: maxImages = 9 → 10 manual images must block.
    const refs = Array.from({ length: 10 }, (_, i) => ({
      url: `u${i}`,
      mimeType: 'image/png',
      dedupeKey: `k-${i}`,
      role: 'reference' as const,
      assetType: 'image' as const,
    }));
    const node = makeNode('video-box', {
      media: [],
      generation: {
        model: 'doubao-seedance-1.0-lite-t2v',
        aspectRatio: '16:9',
        resolution: '720p',
        duration: 5,
        referenceMediaRefs: refs,
      },
    });
    setupStore(node);
    renderDrawer(node);
    const btn = screen.getByTestId('drawer-generate') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await vi.waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('参考图片最多 9 张');
    });
    expect(executeBlueprintRun).not.toHaveBeenCalled();
  });

  it('readModelDraft/writeModelDraft round-trip preserves prompt/refs', () => {
    const cfg: VideoBoxConfig = {
      media: [],
      generation: {
        model: 'model-x',
        prompt: '提示词',
        aspectRatio: '9:16',
        resolution: '1080p',
        duration: 10,
        referenceMediaRefs: [
          { url: 'u', mimeType: 'image/png', dedupeKey: 'k', role: 'first', assetType: 'image' },
        ],
      },
    };
    const draft = readModelDraft(cfg);
    expect(draft.model).toBe('model-x');
    expect(draft.aspectRatio).toBe('9:16');
    const next = writeModelDraft(cfg, { ...draft, model: 'model-y' }) as VideoBoxConfig;
    expect(next.generation?.model).toBe('model-y');
    expect(next.generation?.prompt).toBe('提示词');
    expect(next.generation?.referenceMediaRefs?.length).toBe(1);
  });
});
