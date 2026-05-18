// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Freedom History Store —— 与项目绑定的"自由"工作室历史记录
 *
 * 与 `freedom-store` 拆分原因：
 *  - freedom-store 中的用户偏好（默认模型 / 比例 / 分辨率 / prompt 等）是
 *    全局的，跨项目共用；
 *  - 但生成历史应当与项目一一对应：切换项目时历史也应跟随切换，导出/导入
 *    项目时历史一并随项目走。
 *
 * 因此本 store 使用 `createProjectScopedStorage('freedom-history')`，
 * 数据实际写入 `_p/{activeProjectId}/freedom-history`。project-switcher
 * 会在切换项目后调用 `useFreedomHistoryStore.persist.rehydrate()`，使
 * 当前 store 重新从新项目的文件加载历史。
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createProjectScopedStorage } from '@/lib/project-storage';
import type { HistoryEntry } from './freedom-store';

export type { HistoryEntry } from './freedom-store';

// ==================== Types ====================

export interface FreedomHistoryState {
  imageHistory: HistoryEntry[];
  videoHistory: HistoryEntry[];
}

export interface FreedomHistoryActions {
  addHistoryEntry: (entry: HistoryEntry) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: (type: 'image' | 'video') => void;
}

export type FreedomHistoryStore = FreedomHistoryState & FreedomHistoryActions;

// ==================== Constants ====================

const MAX_HISTORY = 50;

const initialState: FreedomHistoryState = {
  imageHistory: [],
  videoHistory: [],
};

// ==================== Store ====================

export const useFreedomHistoryStore = create<FreedomHistoryStore>()(
  persist(
    (set) => ({
      ...initialState,

      addHistoryEntry: (entry) => {
        const historyKey: keyof FreedomHistoryState =
          entry.type === 'image' ? 'imageHistory' : 'videoHistory';
        set((state) => {
          const current = state[historyKey];
          const updated = [entry, ...current].slice(0, MAX_HISTORY);
          return { [historyKey]: updated } as Partial<FreedomHistoryState>;
        });
      },

      removeHistoryEntry: (id) => {
        set((state) => ({
          imageHistory: state.imageHistory.filter((h) => h.id !== id),
          videoHistory: state.videoHistory.filter((h) => h.id !== id),
        }));
      },

      clearHistory: (type) => {
        const key: keyof FreedomHistoryState =
          type === 'image' ? 'imageHistory' : 'videoHistory';
        set({ [key]: [] } as Partial<FreedomHistoryState>);
      },
    }),
    {
      name: 'moyin-freedom-history',
      version: 1,
      // 通过 project-scoped storage 把数据写入 `_p/{activeProjectId}/freedom-history`
      storage: createJSONStorage(() => createProjectScopedStorage('freedom-history')),
      partialize: (state) => ({
        imageHistory: state.imageHistory,
        videoHistory: state.videoHistory,
      }),
      // 切换项目时 rehydrate 会重新加载，但若新项目还没有任何历史文件，
      // 需要把当前 store 中残留的旧项目数据清空，避免"看似上一项目历史"
      // 跟着切过来。这里覆盖 merge：当 persistedState 为空时返回空历史。
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<FreedomHistoryState>;
        return {
          ...currentState,
          imageHistory: Array.isArray(persisted.imageHistory) ? persisted.imageHistory : [],
          videoHistory: Array.isArray(persisted.videoHistory) ? persisted.videoHistory : [],
        };
      },
    },
  ),
);
