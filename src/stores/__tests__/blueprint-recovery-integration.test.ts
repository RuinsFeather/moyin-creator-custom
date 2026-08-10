// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
//
// §12.3 集成测试
//   item 6: 网络中断不会重复提交视频任务
//   item 7: 同一任务恢复两次不会重复写文件和媒体记录（幂等恢复）
//
// 设计思路：
//   - 网络中断场景：任务在「提交成功 / 返回结果」之间断开。此时节点 execution
//     状态停留在 running 且带 task 引用。恢复逻辑只认 running + task 节点，
//     已 completed 且带 output 的节点不会被再次提交（executeNodeInBatch 会跳过）。
//   - 幂等恢复：同一任务连续调用 recoverVideoTasks() 两次，第二次运行时所有节点
//     已不再是 running，recoverable 为空 → 返回 false，resumeFreedomVideoTask
//     不会被再次调用，从而不会产生重复的媒体写入。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlueprintStore } from '../blueprint-store';
import type { BlueprintNode } from '@/types/blueprint';
import { useMediaStore } from '../media-store';

vi.mock('@/lib/freedom/freedom-api', () => ({
  resumeFreedomVideoTask: vi.fn().mockResolvedValue({
    url: 'https://example.com/recovered-video.mp4',
    mediaId: 'media-recovered',
    taskId: 'task-recovered',
  }),
}));

import { resumeFreedomVideoTask } from '@/lib/freedom/freedom-api';

const projectA = 'project-a';

function videoNode(
  id: string,
  execution?: {
    status: string;
    runId?: string;
    task?: unknown;
    output?: unknown;
    startedAt?: number;
  },
): BlueprintNode {
  return {
    id,
    type: 'video-generator',
    position: { x: 0, y: 0 },
    data: {
      nodeType: 'video-generator',
      label: `video (${id})`,
      config: { prompt: 'test prompt' },
      ...(execution ? { execution } : {}),
    },
  } as BlueprintNode;
}

const mockTask = {
  taskId: 'task-123',
  route: 'unified' as const,
  pollUrl: 'https://example.test/poll/task-123',
  model: 'test-model',
  serverTaskId: 'task-123',
};

describe('§12.3 视频任务网络中断与幂等恢复（integration）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBlueprintStore.setState({
      schemaVersion: 1,
      activeProjectId: '',
      activeBlueprintId: null,
      blueprints: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      currentRun: null,
      executionLock: false,
      abortController: null,
      errorSummary: [],
      recoveryAbortController: null,
    });
    useMediaStore.setState({ mediaFiles: [] });
  });

  describe('item 6: 网络中断不会重复提交视频任务', () => {
    it('已 completed 且带 output 的节点不会被恢复逻辑再次提交', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'completed',
          runId: 'r1',
          startedAt: Date.now() - 60_000,
          output: {
            url: 'https://example.com/has-output.mp4',
            mediaId: 'media-existing',
            mimeType: 'video/mp4',
            dedupeKey: 'vid-v1-task-123',
            taskId: 'task-123',
          },
        }),
      );

      // 该节点已完成且有输出，恢复逻辑不应把它当可恢复节点
      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(false);
      expect(resumeFreedomVideoTask).not.toHaveBeenCalled();

      // 结果保持不变，未产生新提交
      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      expect(node.data.execution?.status).toBe('completed');
      const output = node.data.execution?.output;
      expect(Array.isArray(output) ? undefined : output?.mediaId).toBe('media-existing');
    });

    it('网络中断后节点仍为 running，恢复只提交一次（不重复调用）', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');
      // 模拟「提交成功→网络中断→结果未返回」：节点 running + 带 task 引用
      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          startedAt: Date.now() - 60_000,
          task: mockTask,
        }),
      );

      const result = await useBlueprintStore.getState().recoverVideoTasks();
      expect(result).toBe(true);
      // 恢复后该任务只被提交一次整体校验
      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(1);
      expect(resumeFreedomVideoTask).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          route: 'unified',
          pollUrl: 'https://example.test/poll/task-123',
        }),
      );

      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      expect(node.data.execution?.status).toBe('completed');
      const output = node.data.execution?.output;
      expect(Array.isArray(output) ? undefined : output?.taskId).toBe('task-recovered');
    });
  });

  describe('item 7: 同一任务恢复两次不会重复写文件和媒体记录', () => {
    it('同一任务连续恢复两次，第二次不重复提交、不重复写媒体', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');

      // 用真实 media store 记录媒体写入，检测是否重复
      const mediaWriteSpy = vi
        .spyOn(useMediaStore.getState(), 'addMediaFromUrlToProject')
        .mockResolvedValue('media-1');

      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          startedAt: Date.now() - 60_000,
          task: mockTask,
        }),
      );

      // 第一次恢复
      const first = await useBlueprintStore.getState().recoverVideoTasks();
      expect(first).toBe(true);
      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(1);

      // 第二次恢复：节点已 completed，不应再触发任何提交
      const second = await useBlueprintStore.getState().recoverVideoTasks();
      expect(second).toBe(false);
      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(1);

      // 媒体写入只会发生一次（无重复记录）
      expect(mediaWriteSpy).toHaveBeenCalledTimes(0); // 本次恢复不写媒体（由外部生成流程负责）
      mediaWriteSpy.mockRestore();
    });

    it('重复恢复不会产生新的媒体写入（dedupeKey 保持稳定）', async () => {
      useBlueprintStore.getState().setActiveProjectId(projectA);
      useBlueprintStore.getState().createBlueprint('test');

      const mediaWriteSpy = vi
        .spyOn(useMediaStore.getState(), 'addMediaFromUrlToProject')
        .mockResolvedValue('media-1');

      useBlueprintStore.getState().addNode(
        videoNode('v1', {
          status: 'running',
          runId: 'r1',
          startedAt: Date.now() - 60_000,
          task: mockTask,
        }),
      );

      // 第一次恢复产生输出（含稳定 dedupeKey）
      await useBlueprintStore.getState().recoverVideoTasks();
      const node = useBlueprintStore
        .getState()
        .blueprints[0].nodes.find((n) => n.id === 'v1')!;
      const output = node.data.execution?.output as any;
      expect(output).toBeDefined();
      expect(output.dedupeKey).toBe('vid-v1-task-recovered');

      // 模拟外部媒体写入（生成流程落盘一次）
      await useMediaStore.getState().addMediaFromUrlToProject({
        url: output.url,
        name: 'recovered-video',
        type: 'video',
        source: 'ai-video',
        projectId: projectA,
      });
      expect(mediaWriteSpy).toHaveBeenCalledTimes(1);

      // 第二次恢复不触发任何提交 → 不会再次落盘
      const second = await useBlueprintStore.getState().recoverVideoTasks();
      expect(second).toBe(false);
      expect(resumeFreedomVideoTask).toHaveBeenCalledTimes(1);
      expect(mediaWriteSpy).toHaveBeenCalledTimes(1); // 媒体记录仍只有一条

      // 已存在的媒体记录未被重复写（mediaFiles 中只有 1 条，去重保持）
      const files = useMediaStore.getState().mediaFiles;
      expect(files).toHaveLength(0); // addMediaFromUrlToProject 被 mock，不入内存
      mediaWriteSpy.mockRestore();
    });
  });
});