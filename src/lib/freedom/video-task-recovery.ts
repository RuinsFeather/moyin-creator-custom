// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

/**
 * 视频任务恢复的共享运行时状态与执行器。
 *
 * 为什么独立成模块：恢复逻辑需要在两个地方触发
 *   1. App 启动时的全局扫描（不依赖用户是否打开「自由 → 视频」标签页）
 *   2. VideoStudio 挂载 / 网络恢复 / 用户手动点「重新查询」
 * 两者必须共用同一份「进程内活跃轮询链」守卫，否则同一任务会被起两条链，
 * 导致重复保存文件、重复弹成功提示。
 */

import { toast } from 'sonner';
import {
  resumeFreedomVideoTask,
  FreedomCancelledError,
  FreedomNetworkInterruptedError,
} from '@/lib/freedom/freedom-api';
import { useFreedomTaskStore, type PersistedFreedomTask } from '@/stores/freedom-task-store';
import { useFreedomStore } from '@/stores/freedom-store';
import { useFreedomHistoryStore } from '@/stores/freedom-history-store';
import { notifyVideoGenerated } from '@/lib/notify';

/**
 * 当前进程内「已有活跃轮询链」的视频任务 ID。
 *
 * 必须是模块级单例：切换 Tab 时 VideoStudio 会被真正卸载，但生成链是脱离 React
 * 生命周期的后台任务，仍在继续轮询。守卫若随组件销毁，重新挂载时的恢复逻辑
 * 会对同一任务再起一条链。
 */
export const inFlightVideoTaskIds = new Set<string>();

/**
 * VideoStudio 是否已挂载。
 *
 * 挂载时由组件自己处理「网络恢复接续」，因为它能同步更新任务卡片等本地 UI；
 * 未挂载时才由 App 的全局监听兜底。避免两处同时抢守卫导致 UI 不同步。
 */
let videoStudioMounted = false;

export function setVideoStudioMounted(mounted: boolean): void {
  videoStudioMounted = mounted;
}

export function isVideoStudioMounted(): boolean {
  return videoStudioMounted;
}

/** 恢复某个任务时的可选 UI 回调（由 VideoStudio 提供，全局恢复时可省略） */
export interface RecoverVideoTaskHooks {
  /** 任务开始恢复时，用于在 UI 上补一张任务卡片 */
  onStart?: (task: PersistedFreedomTask) => void;
  /** 成功领取到结果 */
  onSuccess?: (task: PersistedFreedomTask, resultUrl: string, mediaId?: string) => void;
  /** 网络再次中断 */
  onInterrupted?: (task: PersistedFreedomTask, message: string) => void;
  /** 终态失败 */
  onError?: (task: PersistedFreedomTask, message: string) => void;
  /** 用户取消 */
  onCancelled?: (task: PersistedFreedomTask) => void;
}

/**
 * 用持久化的上游 taskId + pollUrl 接续一个未完成的视频任务。
 *
 * 幂等：同一任务在本进程内已有活跃链时直接返回 false，不会起第二条。
 * 结果落库由 freedom-api 的 `finalizeFreedomVideoResult` 去重缓存兜底。
 *
 * @returns 是否真的启动了一条恢复链
 */
export function recoverVideoTask(
  task: PersistedFreedomTask,
  hooks: RecoverVideoTaskHooks = {},
): boolean {
  if (!task.serverTaskId || !task.pollUrl) return false;
  if (inFlightVideoTaskIds.has(task.id)) return false;
  inFlightVideoTaskIds.add(task.id);

  useFreedomTaskStore.getState().updateTask(task.id, {
    status: 'polling',
    lastRecoverAt: Date.now(),
  });
  hooks.onStart?.(task);

  void (async () => {
    try {
      const result = await resumeFreedomVideoTask({
        taskId: task.serverTaskId!,
        route: (task.params?.resumeRoute || 'unified') as any,
        pollUrl: task.pollUrl!,
        model: task.model,
        prompt: task.prompt,
        projectId: task.projectId,
      });

      const durationMs = Date.now() - task.startedAt;
      useFreedomTaskStore.getState().updateTask(task.id, {
        status: 'done',
        resultUrl: result.url,
        mediaId: result.mediaId,
        durationMs,
        error: undefined,
      });

      // 写入历史（与 VideoStudio 内的恢复路径保持一致）
      useFreedomHistoryStore.getState().addHistoryEntry({
        id: task.id,
        projectId: task.projectId,
        prompt: task.prompt,
        model: task.model,
        resultUrl: result.url,
        params: task.params || {},
        createdAt: Date.now(),
        durationMs,
        mediaId: result.mediaId,
        type: 'video',
      }, task.projectId);

      hooks.onSuccess?.(task, result.url, result.mediaId);
    } catch (err: any) {
      inFlightVideoTaskIds.delete(task.id);

      if (err instanceof FreedomCancelledError || err?.name === 'AbortError') {
        useFreedomTaskStore.getState().updateTask(task.id, { status: 'cancelled' });
        hooks.onCancelled?.(task);
        return;
      }

      if (err instanceof FreedomNetworkInterruptedError) {
        const message = err.message || '网络中断，查询已暂停';
        useFreedomTaskStore.getState().updateTask(task.id, {
          status: 'interrupted',
          error: message,
          recoverAttempts: (task.recoverAttempts || 0) + 1,
          lastRecoverAt: Date.now(),
        });
        hooks.onInterrupted?.(task, message);
        return;
      }

      const message = err instanceof Error ? err.message : '恢复查询失败';
      useFreedomTaskStore.getState().updateTask(task.id, { status: 'error', error: message });
      hooks.onError?.(task, message);
    }
  })();

  return true;
}

/**
 * 全局恢复：扫描所有可恢复的视频任务并接续。
 *
 * 用于 App 启动与网络恢复事件。不依赖 VideoStudio 是否挂载，因此只做
 * 「持久层状态 + 素材库 + 系统通知」，不碰 VideoStudio 的本地 UI 状态；
 * 若 VideoStudio 恰好已挂载，它自己的守卫会让本函数直接跳过这些任务。
 *
 * @returns 实际启动的恢复链数量
 */
export function recoverAllPendingVideoTasks(options?: { silent?: boolean }): number {
  const recoverable = useFreedomTaskStore.getState().getRecoverableTasks('video');
  if (recoverable.length === 0) return 0;

  let started = 0;
  for (const task of recoverable) {
    const ok = recoverVideoTask(task, {
      onSuccess: (_task, resultUrl) => {
        toast.success('已找回上次未完成的视频生成结果，已保存到素材库', {
          id: `freedom-video-done-${task.id}`,
        });
        notifyVideoGenerated();
        // 主预览区当前空闲时顺便展示找回的结果
        useFreedomStore.setState((s) => (s.videoResult ? {} : { videoResult: resultUrl }));
      },
      onInterrupted: () => {
        toast.warning('网络仍不可用，未完成的视频任务已保留，可稍后在「自由 → 视频」中重新查询', {
          id: `freedom-video-interrupted-${task.id}`,
        });
      },
    });
    if (ok) started += 1;
  }

  if (started > 0 && !options?.silent) {
    toast.info(`正在接续 ${started} 个未完成的视频任务…`, {
      id: 'freedom-video-global-recover',
    });
  }
  return started;
}
