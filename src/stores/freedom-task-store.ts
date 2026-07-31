// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/indexed-db-storage';

/**
 * `interrupted`：网络中断/查询链断开，但任务**已提交到上游且很可能已完成**。
 * 与 `error`（终态失败）区分：interrupted 会被自动恢复流程接续，也可手动重新查询。
 */
export type PersistedFreedomTaskStatus =
  | 'submitting'
  | 'polling'
  | 'interrupted'
  | 'done'
  | 'error'
  | 'cancelled'
  | 'unknown';

export interface PersistedFreedomTask {
  id: string;
  projectId?: string;
  type: 'image' | 'video';
  status: PersistedFreedomTaskStatus;
  prompt: string;
  model: string;
  params: Record<string, any>;
  serverTaskId?: string;
  pollUrl?: string;
  createdAt: number;
  updatedAt: number;
  startedAt: number;
  durationMs?: number;
  resultUrl?: string;
  mediaId?: string;
  error?: string;
  /** 自动恢复尝试次数，避免同一任务被无限重试 */
  recoverAttempts?: number;
  /** 最近一次自动恢复的时间戳，用于节流 */
  lastRecoverAt?: number;
}

interface FreedomTaskState {
  tasks: PersistedFreedomTask[];
  upsertTask: (task: PersistedFreedomTask) => void;
  updateTask: (id: string, patch: Partial<PersistedFreedomTask>) => void;
  removeTask: (id: string) => void;
  getPendingTasks: (type?: 'image' | 'video') => PersistedFreedomTask[];
  /** 可恢复任务：待完成 + 网络中断，且保留了 serverTaskId/pollUrl 查询入口 */
  getRecoverableTasks: (type?: 'image' | 'video') => PersistedFreedomTask[];
}

const PENDING_STATUSES: PersistedFreedomTaskStatus[] = ['submitting', 'polling', 'unknown', 'interrupted'];

/** 自动恢复的最大尝试次数，超过后仅允许用户手动重新查询 */
export const MAX_AUTO_RECOVER_ATTEMPTS = 5;

export const useFreedomTaskStore = create<FreedomTaskState>()(
  persist(
    (set, get) => ({
      tasks: [],
      upsertTask: (task) => set((state) => ({
        tasks: [
          { ...task, updatedAt: Date.now() },
          ...state.tasks.filter((item) => item.id !== task.id),
        ].slice(0, 100),
      })),
      updateTask: (id, patch) => set((state) => ({
        tasks: state.tasks.map((task) => (
          task.id === id ? { ...task, ...patch, updatedAt: Date.now() } : task
        )),
      })),
      removeTask: (id) => set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
      })),
      getPendingTasks: (type) => get().tasks.filter((task) => (
        PENDING_STATUSES.includes(task.status) && (!type || task.type === type)
      )),
      getRecoverableTasks: (type) => get().tasks.filter((task) => (
        PENDING_STATUSES.includes(task.status)
        && (!type || task.type === type)
        && !!task.serverTaskId
        && !!task.pollUrl
        && (task.recoverAttempts || 0) < MAX_AUTO_RECOVER_ATTEMPTS
      )),
    }),
    {
      name: 'moyin-freedom-tasks',
      version: 1,
      storage: createJSONStorage(() => fileStorage),
    },
  ),
);
