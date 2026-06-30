// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { fileStorage } from '@/lib/indexed-db-storage';

export type PersistedFreedomTaskStatus = 'submitting' | 'polling' | 'done' | 'error' | 'cancelled' | 'unknown';

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
}

interface FreedomTaskState {
  tasks: PersistedFreedomTask[];
  upsertTask: (task: PersistedFreedomTask) => void;
  updateTask: (id: string, patch: Partial<PersistedFreedomTask>) => void;
  removeTask: (id: string) => void;
  getPendingTasks: (type?: 'image' | 'video') => PersistedFreedomTask[];
}

const PENDING_STATUSES: PersistedFreedomTaskStatus[] = ['submitting', 'polling', 'unknown'];

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
    }),
    {
      name: 'moyin-freedom-tasks',
      version: 1,
      storage: createJSONStorage(() => fileStorage),
    },
  ),
);
