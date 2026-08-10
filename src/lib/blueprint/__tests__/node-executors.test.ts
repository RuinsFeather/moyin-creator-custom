// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { BlueprintEdge, BlueprintNode } from '@/types/blueprint';
import { NODE_EXECUTORS, type NodeExecutionContext, type NodeExecutorOutput } from '../node-executors';

// Mock the Freedom API
vi.mock('@/lib/freedom/freedom-api', () => ({
  generateFreedomImage: vi.fn().mockResolvedValue({
    url: 'https://example.com/generated-image.png',
    mediaId: 'media-123',
    taskId: 'task-456',
    metadata: {},
  }),
  generateFreedomVideo: vi.fn().mockImplementation(async (params: any) => {
    // Simulate onTaskCreated callback (mirrors real freedom-api behavior)
    params.onTaskCreated?.({
      taskId: 'task-vid-789',
      route: 'unified',
      pollUrl: 'https://example.test/poll/task-vid-789',
      model: params.model || 'default-video-model',
    });
    return {
      url: 'https://example.com/generated-video.mp4',
      mediaId: 'media-789',
      taskId: 'task-vid-789',
      metadata: {},
    };
  }),
}));

import { generateFreedomImage, generateFreedomVideo } from '@/lib/freedom/freedom-api';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeNode(
  id: string,
  nodeType: BlueprintNode['data']['nodeType'] = 'text-input',
  config: Record<string, unknown> = {},
): BlueprintNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: {
      nodeType,
      label: nodeType + ' (' + id + ')',
      config,
    },
  } as BlueprintNode;
}

function makeCtx(
  node: BlueprintNode,
  upstreamOutputs: Map<string, NodeExecutorOutput> = new Map(),
  projectId = 'test-project-123',
): NodeExecutionContext {
  const targetHandle = node.data.nodeType === 'video-generator' ? 'media' : 'reference-images';
  const edges: BlueprintEdge[] = [...upstreamOutputs.keys()].map((source, index) => ({
    id: `edge-${source}-${node.id}`,
    source,
    target: node.id,
    targetHandle,
    data: { order: index, dataType: 'image' },
  }));
  return {
    node,
    upstreamOutputs,
    edges,
    config: node.data.config,
    signal: new AbortController().signal,
    projectId,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('node-executors', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Registry completeness ──────────────────────────────────────

  describe('NODE_EXECUTORS registry', () => {
    it('has executors for all 7 node types', () => {
      const expectedTypes = [
        'text-input',
        'image-reference',
        'video-reference',
        'script-import',
        'image-generator',
        'video-generator',
        'output',
      ];
      for (const type of expectedTypes) {
        expect(NODE_EXECUTORS[type]).toBeDefined();
        expect(typeof NODE_EXECUTORS[type]).toBe('function');
      }
    });
  });

  // ── text-input ─────────────────────────────────────────────────

  describe('text-input', () => {
    it('returns the configured text', async () => {
      const node = makeNode('a', 'text-input', { text: 'hello world' });
      const result = await NODE_EXECUTORS['text-input'](makeCtx(node));
      expect(result.data).toBe('hello world');
      expect(result.summary).toContain('11 chars');
    });

    it('returns empty string when text is missing', async () => {
      const node = makeNode('a', 'text-input', {});
      const result = await NODE_EXECUTORS['text-input'](makeCtx(node));
      expect(result.data).toBe('');
      expect(result.summary).toContain('0 chars');
    });

    it('throws AbortError when signal is aborted', async () => {
      const node = makeNode('a', 'text-input', { text: 'x' });
      const controller = new AbortController();
      controller.abort();
      const ctx: NodeExecutionContext = {
        ...makeCtx(node),
        signal: controller.signal,
      };
      await expect(NODE_EXECUTORS['text-input'](ctx)).rejects.toThrow('Execution aborted');
    });
  });

  // ── image-reference ───────────────────────────────────────────

  describe('image-reference', () => {
    it('returns media refs from config', async () => {
      const media = [
        { url: 'http://example.com/1.png', mimeType: 'image/png' },
        { url: 'http://example.com/2.png', mimeType: 'image/png' },
      ];
      const node = makeNode('a', 'image-reference', { media });
      const result = await NODE_EXECUTORS['image-reference'](makeCtx(node));
      expect(result.data).toEqual(media);
      expect(result.summary).toContain('2 refs');
    });

    it('returns empty array when media is missing', async () => {
      const node = makeNode('a', 'image-reference', {});
      const result = await NODE_EXECUTORS['image-reference'](makeCtx(node));
      expect(result.data).toEqual([]);
    });
  });

  // ── video-reference ───────────────────────────────────────────

  describe('video-reference', () => {
    it('returns video media refs', async () => {
      const media = [{ url: 'http://example.com/1.mp4', mimeType: 'video/mp4' }];
      const node = makeNode('a', 'video-reference', { media });
      const result = await NODE_EXECUTORS['video-reference'](makeCtx(node));
      expect(result.data).toEqual(media);
      expect(result.summary).toContain('1 refs');
    });
  });

  // ── script-import ─────────────────────────────────────────────

  describe('script-import', () => {
    it('returns script info with shot count', async () => {
      const node = makeNode('a', 'script-import', {
        selectedShotIds: ['s1', 's2', 's3'],
        mode: 'snapshot',
      });
      const result = await NODE_EXECUTORS['script-import'](makeCtx(node));
      expect(result.data).toBeNull();
      expect(result.summary).toContain('3 shots');
      expect(result.summary).toContain('snapshot');
    });
  });

  // ── image-generator ───────────────────────────────────────────

  describe('image-generator', () => {
    it('executes successfully with a prompt', async () => {
      const node = makeNode('gen', 'image-generator', {
        prompt: 'A cat',
        model: 'test-model',
      });
      const result = await NODE_EXECUTORS['image-generator'](makeCtx(node));
      expect(result.data).toBeDefined();
      expect(result.summary).toContain('test-model');
      if (result.data && typeof result.data === 'object' && 'url' in result.data) {
        expect(result.data.url).toContain('https://example.com/generated-image.png');
        expect(result.data.mediaId).toBe('media-123');
      }
    });

    it('throws when prompt is missing', async () => {
      const node = makeNode('gen', 'image-generator', { model: 'x' });
      await expect(NODE_EXECUTORS['image-generator'](makeCtx(node))).rejects.toThrow(
        '缺少 prompt',
      );
    });

    it('collects reference images from upstream outputs', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'A cat' });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('ref', {
        data: [
          { url: 'http://example.com/ref1.png', mimeType: 'image/png' },
        ],
        summary: 'image-reference (1 refs)',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      const result = await NODE_EXECUTORS['image-generator'](ctx);
      expect(result.summary).toContain('refs=1');
    });

    it('throws AbortError when signal is aborted', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'A cat' });
      const controller = new AbortController();
      controller.abort();
      const ctx: NodeExecutionContext = {
        ...makeCtx(node),
        signal: controller.signal,
      };
      await expect(NODE_EXECUTORS['image-generator'](ctx)).rejects.toThrow('Execution aborted');
    });
  });

  // ── 9.1 图片生成：参数映射与媒体落库 ─────────────────────────

  describe('9.1 image generation: param mapping & media persistence', () => {

    it('passes all FreedomImageParams fields to generateFreedomImage', async () => {
      const node = makeNode('gen', 'image-generator', {
        prompt: 'A beautiful landscape',
        model: 'flux-v1',
        aspectRatio: '16:9',
        resolution: '1024x576',
        width: 1024,
        height: 576,
        negativePrompt: 'blurry, low quality',
        extraParams: { seed: 42, steps: 30 },
      });
      const ctx = makeCtx(node, new Map(), 'my-project-abc');
      await NODE_EXECUTORS['image-generator'](ctx);

      expect(generateFreedomImage).toHaveBeenCalledTimes(1);
      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.prompt).toBe('A beautiful landscape');
      expect(callArgs.model).toBe('flux-v1');
      expect(callArgs.aspectRatio).toBe('16:9');
      expect(callArgs.resolution).toBe('1024x576');
      expect(callArgs.width).toBe(1024);
      expect(callArgs.height).toBe(576);
      expect(callArgs.negativePrompt).toBe('blurry, low quality');
      expect(callArgs.projectId).toBe('my-project-abc');
      expect(callArgs.extraParams).toEqual({ seed: 42, steps: 30 });
      expect(callArgs.signal).toBeDefined();
    });

    it('explicitly passes projectId from context, not from config', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Test' });
      const ctx = makeCtx(node, new Map(), 'proj-uuid-42');
      await NODE_EXECUTORS['image-generator'](ctx);

      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.projectId).toBe('proj-uuid-42');
    });

    it('returns BlueprintMediaRef with url from GenerationResult', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Sunset' });
      const ctx = makeCtx(node);
      const result = await NODE_EXECUTORS['image-generator'](ctx);

      expect(result.data).toBeDefined();
      const ref = result.data as { url?: string };
      expect(ref.url).toBe('https://example.com/generated-image.png');
    });

    it('returns BlueprintMediaRef with mediaId from GenerationResult', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Sunset' });
      const ctx = makeCtx(node);
      const result = await NODE_EXECUTORS['image-generator'](ctx);

      const ref = result.data as { mediaId?: string };
      expect(ref.mediaId).toBe('media-123');
    });

    it('returns BlueprintMediaRef with taskId from GenerationResult', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Sunset' });
      const ctx = makeCtx(node);
      const result = await NODE_EXECUTORS['image-generator'](ctx);

      const ref = result.data as { taskId?: string };
      expect(ref.taskId).toBe('task-456');
    });

    it('returns BlueprintMediaRef with mimeType image/png', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Sunset' });
      const ctx = makeCtx(node);
      const result = await NODE_EXECUTORS['image-generator'](ctx);

      const ref = result.data as { mimeType?: string };
      expect(ref.mimeType).toBe('image/png');
    });

    it('generates dedupeKey based on node id and taskId', async () => {
      const node = makeNode('node-abc', 'image-generator', { prompt: 'Sunset' });
      const ctx = makeCtx(node);
      const result = await NODE_EXECUTORS['image-generator'](ctx);

      const ref = result.data as { dedupeKey?: string };
      expect(ref.dedupeKey).toBe('img-node-abc-task-456');
    });

    it('forwards extraParams from config to FreedomImageParams', async () => {
      const node = makeNode('gen', 'image-generator', {
        prompt: 'Test',
        extraParams: { seed: 123, style: 'anime', steps: 25 },
      });
      const ctx = makeCtx(node);
      await NODE_EXECUTORS['image-generator'](ctx);

      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.extraParams).toEqual({ seed: 123, style: 'anime', steps: 25 });
    });

    it('passes reference image URLs from upstream array outputs', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'Enhance' });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('ref1', {
        data: [
          { url: 'http://cdn.example.com/ref-a.png', mimeType: 'image/png' },
          { url: 'http://cdn.example.com/ref-b.jpg', mimeType: 'image/jpeg' },
        ],
        summary: '2 refs',
      });
      upstreamOutputs.set('ref2', {
        data: [
          { url: 'http://cdn.example.com/ref-c.png', mimeType: 'image/png' },
        ],
        summary: '1 ref',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      await NODE_EXECUTORS['image-generator'](ctx);

      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.referenceImages).toEqual([
        'http://cdn.example.com/ref-a.png',
        'http://cdn.example.com/ref-b.jpg',
        'http://cdn.example.com/ref-c.png',
      ]);
    });

    it('omits referenceImages when no upstream refs available', async () => {
      const node = makeNode('gen', 'image-generator', { prompt: 'No refs' });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('text', {
        data: 'just text, not a media ref',
        summary: 'text',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      await NODE_EXECUTORS['image-generator'](ctx);

      const callArgs = (generateFreedomImage as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.referenceImages).toBeUndefined();
    });

    it('reports progress callbacks during generation', async () => {
      const progressValues: number[] = [];
      const node = makeNode('gen', 'image-generator', { prompt: 'Test' });
      const ctx: NodeExecutionContext = {
        ...makeCtx(node),
        onProgress: (p) => progressValues.push(p),
      };
      await NODE_EXECUTORS['image-generator'](ctx);

      // Should have at least: initial 10 + some progress + final 100
      expect(progressValues.length).toBeGreaterThanOrEqual(2);
      expect(progressValues[0]).toBe(10); // initial
      expect(progressValues[progressValues.length - 1]).toBe(100); // final
    });
  });

  // ── video-generator ───────────────────────────────────────────

  describe('video-generator', () => {
    it('executes successfully with a prompt', async () => {
      const node = makeNode('gen', 'video-generator', {
        prompt: 'A moving cat',
        model: 'video-model',
      });
      const result = await NODE_EXECUTORS['video-generator'](makeCtx(node));
      expect(result.data).toBeDefined();
      expect(result.summary).toContain('video-model');
      if (result.data && typeof result.data === 'object' && 'url' in result.data) {
        expect(result.data.url).toContain('https://example.com/generated-video.mp4');
        expect(result.data.mediaId).toBe('media-789');
      }
    });

    it('throws when prompt is missing', async () => {
      const node = makeNode('gen', 'video-generator', {});
      await expect(NODE_EXECUTORS['video-generator'](makeCtx(node))).rejects.toThrow(
        '缺少 prompt',
      );
    });

    it('calls onUpdateNode with BlueprintTaskRef when task is created', async () => {
      const node = makeNode('vid-node', 'video-generator', {
        prompt: 'A dancing robot',
        model: 'test-video-model',
      });
      const taskUpdates: any[] = [];
      const ctx: NodeExecutionContext = {
        ...makeCtx(node),
        onUpdateNode: (updates) => taskUpdates.push(updates),
      };
      await NODE_EXECUTORS['video-generator'](ctx);

      // onTaskCreated should have fired once with the task ref
      expect(taskUpdates.length).toBeGreaterThanOrEqual(1);
      const taskUpdate = taskUpdates.find((u) => u.task);
      expect(taskUpdate).toBeDefined();
      expect(taskUpdate.task).toEqual({
        taskId: 'task-vid-789',
        route: 'unified',
        pollUrl: 'https://example.test/poll/task-vid-789',
        model: 'test-video-model',
        serverTaskId: 'task-vid-789',
      });
    });

    it('calls onUpdateNode before returning the final result', async () => {
      const callOrder: string[] = [];
      const node = makeNode('vid-node', 'video-generator', { prompt: 'Test' });
      const ctx: NodeExecutionContext = {
        ...makeCtx(node),
        onUpdateNode: (updates) => {
          if (updates.task) callOrder.push('taskCreated');
        },
      };
      await NODE_EXECUTORS['video-generator'](ctx);
      callOrder.push('executorDone');

      expect(callOrder).toEqual(['taskCreated', 'executorDone']);
    });

    it('returns BlueprintMediaRef with url from GenerationResult', async () => {
      const node = makeNode('vid-node', 'video-generator', { prompt: 'Test' });
      const result = await NODE_EXECUTORS['video-generator'](makeCtx(node));
      const ref = result.data as { url?: string; mediaId?: string; mimeType?: string };
      expect(ref.url).toBe('https://example.com/generated-video.mp4');
      expect(ref.mediaId).toBe('media-789');
      expect(ref.mimeType).toBe('video/mp4');
    });

    it('generates dedupeKey based on node id and taskId', async () => {
      const node = makeNode('vid-abc', 'video-generator', { prompt: 'Test' });
      const result = await NODE_EXECUTORS['video-generator'](makeCtx(node));
      const ref = result.data as { dedupeKey?: string };
      expect(ref.dedupeKey).toBe('vid-vid-abc-task-vid-789');
    });

    it('forwards all config fields to FreedomVideoParams', async () => {
      const node = makeNode('gen', 'video-generator', {
        prompt: 'Test video',
        model: 'vid-model-x',
        aspectRatio: '9:16',
        duration: 10,
        resolution: '1080p',
        generateAudio: true,
        watermark: false,
      });
      await NODE_EXECUTORS['video-generator'](makeCtx(node));

      const callArgs = (generateFreedomVideo as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(callArgs.prompt).toBe('Test video');
      expect(callArgs.model).toBe('vid-model-x');
      expect(callArgs.aspectRatio).toBe('9:16');
      expect(callArgs.duration).toBe(10);
      expect(callArgs.resolution).toBe('1080p');
      expect(callArgs.generateAudio).toBe(true);
      expect(callArgs.watermark).toBe(false);
      expect(callArgs.onTaskCreated).toBeDefined();
      expect(typeof callArgs.onTaskCreated).toBe('function');
    });
  });

  // ── output ────────────────────────────────────────────────────

  describe('output', () => {
    it('collects upstream media and filters by accepted types', async () => {
      const node = makeNode('out', 'output', { acceptedTypes: ['image'] });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('img', {
        data: { url: 'http://example.com/img.png', mimeType: 'image/png' },
        summary: 'image',
      });
      upstreamOutputs.set('vid', {
        data: { url: 'http://example.com/vid.mp4', mimeType: 'video/mp4' },
        summary: 'video',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      const result = await NODE_EXECUTORS['output'](ctx);
      // Only image should pass the filter
      expect(Array.isArray(result.data)).toBe(true);
      const refs = result.data as Array<{ url: string }>;
      expect(refs).toHaveLength(1);
      expect(refs[0].url).toContain('img.png');
    });

    it('collects array-type upstream outputs', async () => {
      const node = makeNode('out', 'output', { acceptedTypes: ['image', 'video'] });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('gen', {
        data: [
          { url: 'http://example.com/1.png', mimeType: 'image/png' },
          { url: 'http://example.com/2.png', mimeType: 'image/png' },
        ],
        summary: '2 images',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      const result = await NODE_EXECUTORS['output'](ctx);
      const refs = result.data as Array<{ url: string }>;
      expect(refs).toHaveLength(2);
    });

    it('includes refs with unknown mimeType', async () => {
      const node = makeNode('out', 'output', { acceptedTypes: ['image'] });
      const upstreamOutputs = new Map<string, NodeExecutorOutput>();
      upstreamOutputs.set('gen', {
        data: { url: 'http://example.com/unknown' },
        summary: 'unknown',
      });
      const ctx = makeCtx(node, upstreamOutputs);
      const result = await NODE_EXECUTORS['output'](ctx);
      const refs = result.data as Array<{ url: string }>;
      expect(refs).toHaveLength(1);
    });
  });
});
