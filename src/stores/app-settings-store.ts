// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { fileStorage } from "@/lib/indexed-db-storage";

export interface ResourceSharingSettings {
  shareCharacters: boolean;
  shareScenes: boolean;
  shareMedia: boolean;
}

export interface StoragePathSettings {
  basePath: string;
}

export interface CacheSettings {
  autoCleanEnabled: boolean;
  autoCleanDays: number;
}
export interface UpdateSettings {
  autoCheckEnabled: boolean;
  ignoredVersion: string;
}

/** 蓝图灰度设置（P1-4）。 */
export interface BlueprintConfigSettings {
  /** 是否允许执行付费生成任务（图片/视频生成节点）。关闭时视为灰度渐进，拒绝提交付费任务。 */
  allowPaidExecution: boolean;
}

interface AppSettingsState {
  resourceSharing: ResourceSharingSettings;
  storagePaths: StoragePathSettings;
  cacheSettings: CacheSettings;
  updateSettings: UpdateSettings;
  blueprintConfig: BlueprintConfigSettings;
}

interface AppSettingsActions {
  setResourceSharing: (settings: Partial<ResourceSharingSettings>) => void;
  setStoragePaths: (paths: Partial<StoragePathSettings>) => void;
  setCacheSettings: (settings: Partial<CacheSettings>) => void;
  setUpdateSettings: (settings: Partial<UpdateSettings>) => void;
  setBlueprintConfig: (settings: Partial<BlueprintConfigSettings>) => void;
}

const defaultState: AppSettingsState = {
  resourceSharing: {
    shareCharacters: true,
    shareScenes: true,
    shareMedia: true,
  },
  storagePaths: {
    basePath: "",
  },
  cacheSettings: {
    autoCleanEnabled: false,
    autoCleanDays: 30,
  },
  updateSettings: {
    autoCheckEnabled: true,
    ignoredVersion: "",
  },
  blueprintConfig: {
    allowPaidExecution: true,
  },
};

export const useAppSettingsStore = create<AppSettingsState & AppSettingsActions>()(
  persist(
    (set) => ({
      ...defaultState,
      setResourceSharing: (settings) =>
        set((state) => ({
          resourceSharing: { ...state.resourceSharing, ...settings },
        })),
      setStoragePaths: (paths) =>
        set((state) => ({
          storagePaths: { ...state.storagePaths, ...paths },
        })),
      setCacheSettings: (settings) =>
        set((state) => ({
          cacheSettings: { ...state.cacheSettings, ...settings },
        })),
      setUpdateSettings: (settings) =>
        set((state) => ({
          updateSettings: { ...state.updateSettings, ...settings },
        })),
      setBlueprintConfig: (settings) =>
        set((state) => ({
          blueprintConfig: { ...state.blueprintConfig, ...settings },
        })),
    }),
    {
      name: "moyin-app-settings",
      storage: createJSONStorage(() => fileStorage),
    }
  )
);
