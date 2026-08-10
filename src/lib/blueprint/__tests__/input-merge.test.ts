// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { describe, expect, it } from 'vitest';
import type { BlueprintEdge, BlueprintNode, BlueprintMediaRef } from '@/types/blueprint';
import type { NodeExecutorOutput } from '../node-executors';
import {
  mergePromptText,
  collectReferenceImages,
  collectReferenceImageRefs,
  collectVideoUploadFiles,
  resolveMissingUpstream,
  getStaleDownstreamNodes,
} from '../input-merge';

// ── Helpers ───────────────────────────────────────────────────────────────

function makeEdge(
  id: string,
  source: string,
  target: string,
  targetHandle = '',
  order?: number,
): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle: '',
    targetHandle,
    data: { dataType: 'text', order },
  } as BlueprintEdge;
}

function makeNode(id: string, nodeType: string): BlueprintNode {
  return {
    id,
    type: nodeType,
    position: { x: 0, y: 0 },
    data: { nodeType, label: nodeType + ' (' + id + ')', config: {} },
  } as BlueprintNode;
}

function textOutput(text: string): NodeExecutorOutput {
  return { data: text, summary: 'text (' + text.length + ' chars)' };
}

function imageArrayOutput(refs: Array<{ url: string; mimeType?: string }>): NodeExecutorOutput {
  return { data: refs, summary: 'image (' + refs.length + ' refs)' };
}

function singleImageOutput(url: string, mimeType?: string): NodeExecutorOutput {
  return {
    data: { url, mimeType },
    summary: 'image (1 ref)',
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('input-merge', () => {
  const TARGET = 'target';

  // ── 1. mergePromptText ───────────────────────────────────────────

  describe('mergePromptText', () => {
    it('returns empty string when no upstreams produce text', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'prompt')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([{ url: 'img.png' }]));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('');
    });

    it('returns a single upstream text as-is', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'prompt')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('hello'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('hello');
    });

    it('merges two upstream texts with double newline', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'prompt', 0),
        makeEdge('e2', 'b', TARGET, 'prompt', 1),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('first'));
      upstreams.set('b', textOutput('second'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('first\n\nsecond');
    });

    it('respects edge order (lower order first)', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'prompt', 2),
        makeEdge('e2', 'b', TARGET, 'prompt', 0),
        makeEdge('e3', 'c', TARGET, 'prompt', 1),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('third'));
      upstreams.set('b', textOutput('first'));
      upstreams.set('c', textOutput('second'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('first\n\nsecond\n\nthird');
    });

    it('breaks ties by edge ID lexicographic order', () => {
      const edges = [
        makeEdge('z-edge', 'a', TARGET, 'prompt'),
        makeEdge('a-edge', 'b', TARGET, 'prompt'),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('z'));
      upstreams.set('b', textOutput('a'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('a\n\nz');
    });

    it('ignores non-text upstream outputs', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'prompt'),
        makeEdge('e2', 'b', TARGET, 'prompt'),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('hello'));
      upstreams.set('b', imageArrayOutput([{ url: 'img.png' }]));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('hello');
    });

    it('trims whitespace from upstream text', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'prompt')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('  padded  '));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('padded');
    });

    it('ignores edges for other target handles', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'prompt'),
        makeEdge('e2', 'b', TARGET, 'reference-images'),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('prompt text'));
      upstreams.set('b', textOutput('should not appear'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('prompt text');
    });

    it('ignores edges targeting other nodes', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'prompt'),
        makeEdge('e2', 'b', 'other', 'prompt'),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('hello'));
      upstreams.set('b', textOutput('world'));
      expect(mergePromptText(TARGET, edges, upstreams)).toBe('hello');
    });
  });

  // ── 2. collectReferenceImages ────────────────────────────────────

  describe('collectReferenceImages', () => {
    it('returns empty array when no upstream images', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-images')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', textOutput('not an image'));
      expect(collectReferenceImages(TARGET, edges, upstreams)).toEqual([]);
    });

    it('collects from array-type upstream output', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-images')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://img1.png' },
        { url: 'http://img2.png' },
      ]));
      const urls = collectReferenceImages(TARGET, edges, upstreams);
      expect(urls).toEqual(['http://img1.png', 'http://img2.png']);
    });

    it('collects from single object upstream output', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-images')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', singleImageOutput('http://gen.png'));
      const urls = collectReferenceImages(TARGET, edges, upstreams);
      expect(urls).toEqual(['http://gen.png']);
    });

    it('merges images from multiple upstreams in edge order', () => {
      const edges = [
        makeEdge('e1', 'a', TARGET, 'reference-images', 1),
        makeEdge('e2', 'b', TARGET, 'reference-images', 0),
      ];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([{ url: 'a.png' }]));
      upstreams.set('b', imageArrayOutput([{ url: 'b.png' }]));
      const urls = collectReferenceImages(TARGET, edges, upstreams);
      expect(urls).toEqual(['b.png', 'a.png']);
    });

    it('respects maxCount limit', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-images')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: '1.png' },
        { url: '2.png' },
        { url: '3.png' },
        { url: '4.png' },
        { url: '5.png' },
      ]));
      const urls = collectReferenceImages(TARGET, edges, upstreams, 3);
      expect(urls).toEqual(['1.png', '2.png', '3.png']);
    });
  });

  // ── collectReferenceImageRefs ────────────────────────────────────

  describe('collectReferenceImageRefs', () => {
    it('returns full BlueprintMediaRef objects', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-images')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://img1.png', mimeType: 'image/png' },
      ]));
      const refs = collectReferenceImageRefs(TARGET, edges, upstreams);
      expect(refs).toEqual([{ url: 'http://img1.png', mimeType: 'image/png' }]);
    });
  });

  // ── 3. collectVideoUploadFiles ───────────────────────────────────

  describe('collectVideoUploadFiles', () => {
    it('assigns "first" role to a single image', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([{ url: 'http://img.png', mimeType: 'image/png' }]));
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files).toHaveLength(1);
      expect(files[0].role).toBe('first');
      expect(files[0].dataUrl).toBe('http://img.png');
      expect(files[0].assetType).toBe('image');
    });

    it('assigns first/last roles to two images', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://first.png', mimeType: 'image/png' },
        { url: 'http://last.png', mimeType: 'image/png' },
      ]));
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files).toHaveLength(2);
      expect(files[0].role).toBe('first');
      expect(files[1].role).toBe('last');
    });

    it('assigns first/reference/last roles to 3+ images', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://first.png' },
        { url: 'http://mid1.png' },
        { url: 'http://mid2.png' },
        { url: 'http://last.png' },
      ]));
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files).toHaveLength(4);
      expect(files[0].role).toBe('first');
      expect(files[1].role).toBe('reference');
      expect(files[2].role).toBe('reference');
      expect(files[3].role).toBe('last');
    });

    it('respects explicit role from upstream item', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      // The upstream output data is raw objects (not BlueprintMediaRef),
      // so 'role' is an extra field the executor can pass through.
      // Cast through a compatible shape for the test.
      const output: NodeExecutorOutput = {
        data: [{ url: 'http://single.png', role: 'single' }] as unknown as NodeExecutorOutput['data'],
        summary: '1 ref',
      };
      upstreams.set('a', output);
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files[0].role).toBe('single');
    });

    it('appends config-level referenceMediaRefs', () => {
      const edges: BlueprintEdge[] = [];
      const upstreams = new Map<string, NodeExecutorOutput>();
      const configRefs = [
        { url: 'http://config.png', role: 'reference' as const, mimeType: 'image/png' },
      ];
      const files = collectVideoUploadFiles(TARGET, edges, upstreams, configRefs);
      expect(files).toHaveLength(1);
      expect(files[0].role).toBe('reference');
      expect(files[0].dataUrl).toBe('http://config.png');
    });

    it('infers assetType from mimeType', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://img.png', mimeType: 'image/png' },
        { url: 'http://vid.mp4', mimeType: 'video/mp4' },
        { url: 'http://aud.wav', mimeType: 'audio/wav' },
      ]));
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files[0].assetType).toBe('image');
      expect(files[1].assetType).toBe('video');
      expect(files[2].assetType).toBe('audio');
    });

    it('passes through volcAssetUri from upstream media refs (P1-1)', () => {
      const edges = [makeEdge('e1', 'a', TARGET, 'reference-media')];
      const upstreams = new Map<string, NodeExecutorOutput>();
      upstreams.set('a', imageArrayOutput([
        { url: 'http://local-thumb.png', mimeType: 'image/png' },
        { url: 'http://local-thumb2.png', mimeType: 'image/png' },
      ]));
      // 上游输出携带已上传素材的 asset 引用（执行器从 BlueprintMediaRef 透传）
      upstreams.set('a', {
        data: [
          { url: 'http://local-thumb.png', mimeType: 'image/png', volcAssetUri: 'Asset://Asset-2026-1' },
          { url: 'http://local-thumb2.png', mimeType: 'image/png', volcAssetUri: 'Asset://Asset-2026-2' },
        ],
        summary: '2 refs',
      } as NodeExecutorOutput);
      const files = collectVideoUploadFiles(TARGET, edges, upstreams);
      expect(files).toHaveLength(2);
      expect(files[0].volcAssetUri).toBe('Asset://Asset-2026-1');
      expect(files[1].volcAssetUri).toBe('Asset://Asset-2026-2');
      // dataUrl 仍保留本地缩略图用于展示/兜底上传
      expect(files[0].dataUrl).toBe('http://local-thumb.png');
    });

    it('passes through volcAssetUri from config-level referenceMediaRefs (P1-1)', () => {
      const edges: BlueprintEdge[] = [];
      const upstreams = new Map<string, NodeExecutorOutput>();
      const configRefs = [
        { url: 'http://config.png', role: 'reference' as const, mimeType: 'image/png', volcAssetUri: 'Asset://Asset-2026-3' },
      ];
      const files = collectVideoUploadFiles(TARGET, edges, upstreams, configRefs);
      expect(files).toHaveLength(1);
      expect(files[0].role).toBe('reference');
      expect(files[0].volcAssetUri).toBe('Asset://Asset-2026-3');
    });
  });

  // ── 4. resolveMissingUpstream ────────────────────────────────────

  describe('resolveMissingUpstream', () => {
    it('throws for "block" strategy', () => {
      expect(() => resolveMissingUpstream('t', 'up', 'block')).toThrow(
        '上游节点 up 未产生输出',
      );
    });

    it('returns null for "skip" strategy', () => {
      expect(resolveMissingUpstream('t', 'up', 'skip')).toBeNull();
    });

    it('returns config fallback for "use-config" strategy', () => {
      expect(resolveMissingUpstream('t', 'up', 'use-config', 'fallback')).toBe('fallback');
    });

    it('returns null for "use-config" with no fallback', () => {
      expect(resolveMissingUpstream('t', 'up', 'use-config')).toBeNull();
    });
  });

  // ── 5. getStaleDownstreamNodes ───────────────────────────────────

  describe('getStaleDownstreamNodes', () => {
    it('returns all transitive downstream nodes', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'image-generator'),
        makeNode('c', 'output'),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'b', 'c'),
      ];
      const stale = getStaleDownstreamNodes('a', nodes, edges);
      expect(stale).toEqual(new Set(['b', 'c']));
    });

    it('returns empty set for a leaf node', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'output'),
      ];
      const edges = [makeEdge('e1', 'a', 'b')];
      const stale = getStaleDownstreamNodes('b', nodes, edges);
      expect(stale).toEqual(new Set());
    });

    it('handles diamond graph (a→b,a→c,b→d,c→d)', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'image-generator'),
        makeNode('c', 'image-generator'),
        makeNode('d', 'output'),
      ];
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'c'),
        makeEdge('e3', 'b', 'd'),
        makeEdge('e4', 'c', 'd'),
      ];
      const stale = getStaleDownstreamNodes('a', nodes, edges);
      expect(stale).toEqual(new Set(['b', 'c', 'd']));
    });

    it('stale propagation ignores nodes not in the node list', () => {
      const nodes = [
        makeNode('a', 'text-input'),
        makeNode('b', 'output'),
      ];
      // Edge to a non-existent node 'z'
      const edges = [
        makeEdge('e1', 'a', 'b'),
        makeEdge('e2', 'a', 'z'),
      ];
      const stale = getStaleDownstreamNodes('a', nodes, edges);
      expect(stale).toEqual(new Set(['b']));
      expect(stale.has('z')).toBe(false);
    });
  });
});
