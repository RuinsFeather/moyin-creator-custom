// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// §12.3 集成测试
//   item 8: 100 / 300 / 1000 节点性能
//
// 设计思路：
//   - 用纯函数（topologicalSort / scheduleGraph）在 100/300/1000 节点规模的
//     DAG 上验证拓扑排序与调度能在宽松时间预算内完成，且层级/顺序正确。
//   - 用 runBlueprint 在 100 节点规模上验证端到端批量执行正确完成
//     （video-generator 链：video 输出 → reference-media 输入，形成有效深 DAG）。
//   - 为避免 CI 抖动，时间断言使用非常宽松的上限，主要以「正确性 + 是否卡死」为准。

import { describe, expect, it, vi } from 'vitest';
import type { BlueprintNode, BlueprintEdge } from '@/types/blueprint';
import {
  topologicalSort,
  scheduleGraph,
} from '../dag-traversal';
import {
  runBlueprint,
  type NodeExecutionUpdater,
} from '../execution-engine';
import { createEmptyBlueprintProject } from '../blueprint-schema';

vi.mock('@/lib/freedom/freedom-api', () => ({
  generateFreedomVideo: vi.fn().mockResolvedValue({
    url: 'https://example.com/perf-vid.mp4',
    mediaId: 'media-perf-vid',
    taskId: 'task-perf-vid',
    metadata: {},
  }),
  generateFreedomImage: vi.fn().mockResolvedValue({
    url: 'https://example.com/perf-img.png',
    mediaId: 'media-perf-img',
    taskId: 'task-perf-img',
    metadata: {},
  }),
}));

// ── Test helpers ─────────────────────────────────────────────────────────

function makeNode(id: string): BlueprintNode {
  return {
    id,
    type: 'video-generator',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'video-generator',
      label: id,
      config: { prompt: `prompt ${id}`, model: 'perf-model' },
    },
  } as BlueprintNode;
}

function makeEdge(id: string, source: string, target: string): BlueprintEdge {
  return {
    id,
    source,
    target,
    sourceHandle: 'video',
    targetHandle: 'reference-media',
    type: 'blueprint',
    data: { dataType: 'video' },
  };
}

/**
 * 构造一个分层 DAG：每 10 个节点为一层，层内互不依赖，下一层节点依赖
 * 上一层的全部节点（反向小扇出）。规模为 count 时约形成 count / 10 层。
 * 使用 video-generator 链（video 输出 → reference-media 输入），满足
 * 图校验（端口/数据类型均兼容）。
 */
function buildLayeredDag(count: number): { nodes: BlueprintNode[]; edges: BlueprintEdge[] } {
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  const layerSize = 10;

  for (let i = 0; i < count; i++) {
    nodes.push(makeNode(`n${i}`));
  }

  for (let i = layerSize; i < count; i++) {
    const source = i - layerSize;
    edges.push(makeEdge(`e${source}-${i}`, `n${source}`, `n${i}`));
  }

  return { nodes, edges };
}

describe('§12.3 大规模图性能（integration）', () => {
  describe('item 8: topologicalSort 在 100/300/1000 节点下正确且高效', () => {
    it.each([100, 300, 1000])('%d 节点：拓扑排序无环且层级顺序正确', (count) => {
      const { nodes, edges } = buildLayeredDag(count);

      const started = Date.now();
      const order = topologicalSort(nodes, edges);
      const elapsed = Date.now() - started;

      expect(order.hasCycle).toBe(false);
      expect(order.cycleNodes).toEqual([]);
      expect(order.ordered).toHaveLength(count);
      // 每一个节点只出现一次
      expect(new Set(order.ordered).size).toBe(count);
      // 层级数 ≈ count / 10
      expect(order.levels.length).toBe(Math.ceil(count / 10));
      // 宽松时间预算：避免 CI 抖动
      expect(elapsed).toBeLessThan(5000);
    });

    it('调度结果中的批次数与节点总数一致（无遗漏）', () => {
      const { nodes, edges } = buildLayeredDag(300);
      const scheduled = scheduleGraph(nodes, edges, { concurrencyLimit: 4 })!;

      let total = 0;
      for (const level of scheduled) {
        for (const batch of level.batches) total += batch.length;
      }
      expect(total).toBe(300);
    });
  });

  describe('item 8: runBlueprint 端到端批量执行', () => {
    it('100 节点链条能在合理时间内完整执行', async () => {
      const count = 100;
      const { nodes, edges } = buildLayeredDag(count);
      const project = createEmptyBlueprintProject('project-x', 'bp-x', '性能蓝图', 100);
      project.nodes = nodes;
      project.edges = edges;

      const statuses = new Map<string, string>();
      const onUpdateNode: NodeExecutionUpdater = (nodeId, update) => {
        if (update?.status) statuses.set(nodeId, update.status);
      };

      const started = Date.now();
      const result = await runBlueprint({
        project,
        mode: 'all',
        concurrencyLimit: 4,
        onUpdateNode,
      });
      const elapsed = Date.now() - started;

      expect(result.completedCount).toBe(count);
      expect(result.failedCount).toBe(0);
      expect(result.cancelledCount).toBe(0);
      expect(result.blockedCount).toBe(0);
      expect(statuses.size).toBe(count);
      for (const status of statuses.values()) {
        expect(status).not.toBe('failed');
      }
      // 宽松时间预算
      expect(elapsed).toBeLessThan(10000);
    });
  });
});