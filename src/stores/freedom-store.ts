// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// ==================== Types ====================

export type StudioMode = 'image' | 'video' | 'cinema';

/** 视频工作室功能模式 */
export type VideoFeatureMode = 'text-to-video' | 'image-to-video' | 'multi-reference';

/** 图生视频子模式 */
export type ImageToVideoSubMode = 'first-frame' | 'first-last-frame';

export interface HistoryEntry {
  id: string;
  prompt: string;
  model: string;
  resultUrl: string;
  thumbnailUrl?: string;
  params: Record<string, any>;
  createdAt: number;
  mediaId?: string;
  type: 'image' | 'video';
}

export type ActiveTaskStatus = 'running' | 'cancelling' | 'done' | 'error' | 'cancelled';

/** 视频工作室上传素材（首帧/尾帧/单图/多参考） */
export interface VideoUploadAsset {
  id: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
}

/** 多功能参考素材类型 */
export type MultiRefAssetType = 'video' | 'image' | 'audio';

/** 多功能参考模式素材 */
export interface VideoMultiRefAsset {
  id: string;
  dataUrl: string;
  fileName: string;
  mimeType: string;
  assetType: MultiRefAssetType;
  /** 音频时长（秒），仅 audio 类型有值 */
  audioDuration?: number;
}

/**
 * 进行中的生成任务（运行时状态，不持久化）。
 * AbortController 用于支持任务卡片上的"取消"按钮。
 */
export interface ActiveTask {
  id: string;
  type: 'image' | 'video' | 'cinema';
  prompt: string;
  model: string;
  status: ActiveTaskStatus;
  percent: number;
  message: string;
  createdAt: number;
  thumbnailUrl?: string;
  resultUrl?: string;
  error?: string;
  /** AbortController 引用，仅运行时存在；序列化时被 partialize 跳过 */
  controller?: AbortController;
}

interface FreedomState {
  // Studio mode
  activeStudio: StudioMode;
  
  // Image studio
  imagePrompt: string;
  selectedImageModel: string;
  imageAspectRatio: string;
  imageResolution: string;
  imageExtraParams: Record<string, any>;
  imageReferenceImages: string[];
  imageResult: string | null;
  imageGenerating: boolean;
  
  // Video studio
  videoPrompt: string;
  selectedVideoModel: string;
  videoAspectRatio: string;
  videoDuration: number;
  videoResolution: string;
  videoResult: string | null;
  videoGenerating: boolean;
  videoFeatureMode: VideoFeatureMode;
  videoI2VSubMode: ImageToVideoSubMode;
  /** 视频工作室上传素材（跨 Tab 保留，不持久化到 localStorage 以避免 dataUrl 撑爆） */
  videoSingleUpload: VideoUploadAsset | null;
  videoFirstFrameUpload: VideoUploadAsset | null;
  videoLastFrameUpload: VideoUploadAsset | null;
  videoReferenceUploads: VideoUploadAsset[];
  videoMultiRefAssets: VideoMultiRefAsset[];
  
  // Cinema studio
  cinemaPrompt: string;
  selectedCamera: string;
  selectedLens: string;
  selectedFocalLength: number;
  selectedAperture: string;
  cinemaResult: string | null;
  cinemaGenerating: boolean;
  
  // History
  imageHistory: HistoryEntry[];
  videoHistory: HistoryEntry[];
  cinemaHistory: HistoryEntry[];

  // 进行中的任务（运行时状态，不入持久化）
  activeTasks: ActiveTask[];
}

interface FreedomActions {
  setActiveStudio: (studio: StudioMode) => void;
  
  // Image studio actions
  setImagePrompt: (prompt: string) => void;
  setSelectedImageModel: (model: string) => void;
  setImageAspectRatio: (ratio: string) => void;
  setImageResolution: (resolution: string) => void;
  setImageExtraParams: (params: Record<string, any>) => void;
  setImageReferenceImages: (images: string[]) => void;
  setImageResult: (url: string | null) => void;
  setImageGenerating: (generating: boolean) => void;
  
  // Video studio actions
  setVideoPrompt: (prompt: string) => void;
  setSelectedVideoModel: (model: string) => void;
  setVideoAspectRatio: (ratio: string) => void;
  setVideoDuration: (duration: number) => void;
  setVideoResolution: (resolution: string) => void;
  setVideoResult: (url: string | null) => void;
  setVideoGenerating: (generating: boolean) => void;
  setVideoFeatureMode: (mode: VideoFeatureMode) => void;
  setVideoI2VSubMode: (mode: ImageToVideoSubMode) => void;
  setVideoSingleUpload: (asset: VideoUploadAsset | null) => void;
  setVideoFirstFrameUpload: (asset: VideoUploadAsset | null) => void;
  setVideoLastFrameUpload: (asset: VideoUploadAsset | null) => void;
  setVideoReferenceUploads: (assets: VideoUploadAsset[] | ((prev: VideoUploadAsset[]) => VideoUploadAsset[])) => void;
  setVideoMultiRefAssets: (assets: VideoMultiRefAsset[] | ((prev: VideoMultiRefAsset[]) => VideoMultiRefAsset[])) => void;
  clearVideoUploads: () => void;
  
  // Cinema studio actions
  setCinemaPrompt: (prompt: string) => void;
  setSelectedCamera: (camera: string) => void;
  setSelectedLens: (lens: string) => void;
  setSelectedFocalLength: (fl: number) => void;
  setSelectedAperture: (aperture: string) => void;
  setCinemaResult: (url: string | null) => void;
  setCinemaGenerating: (generating: boolean) => void;
  
  // History actions
  addHistoryEntry: (entry: HistoryEntry) => void;
  removeHistoryEntry: (id: string) => void;
  clearHistory: (type: 'image' | 'video' | 'cinema') => void;

  // Active task actions
  addActiveTask: (task: ActiveTask) => void;
  updateActiveTask: (id: string, patch: Partial<ActiveTask>) => void;
  removeActiveTask: (id: string) => void;
  cancelActiveTask: (id: string) => void;
}

type FreedomStore = FreedomState & FreedomActions;

// ==================== Constants ====================

const MAX_HISTORY = 50;

const initialState: FreedomState = {
  activeStudio: 'image',
  
  imagePrompt: '',
  selectedImageModel: '',
  imageAspectRatio: '16:9',
  imageResolution: '',
  imageExtraParams: {},
  imageReferenceImages: [],
  imageResult: null,
  imageGenerating: false,
  
  videoPrompt: '',
  selectedVideoModel: '',
  videoAspectRatio: '16:9',
  videoDuration: 5,
  videoResolution: '720p',
  videoResult: null,
  videoGenerating: false,
  videoFeatureMode: 'text-to-video',
  videoI2VSubMode: 'first-frame',
  videoSingleUpload: null,
  videoFirstFrameUpload: null,
  videoLastFrameUpload: null,
  videoReferenceUploads: [],
  videoMultiRefAssets: [],
  
  cinemaPrompt: '',
  selectedCamera: 'Modular 8K Digital',
  selectedLens: 'Fast Prime Cine',
  selectedFocalLength: 35,
  selectedAperture: 'f/2.8',
  cinemaResult: null,
  cinemaGenerating: false,
  
  imageHistory: [],
  videoHistory: [],
  cinemaHistory: [],

  activeTasks: [],
};

// ==================== Store ====================

export const useFreedomStore = create<FreedomStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      setActiveStudio: (studio) => set({ activeStudio: studio }),

      // Image studio
      setImagePrompt: (prompt) => set({ imagePrompt: prompt }),
      setSelectedImageModel: (model) => set({ selectedImageModel: model }),
      setImageAspectRatio: (ratio) => set({ imageAspectRatio: ratio }),
      setImageResolution: (resolution) => set({ imageResolution: resolution }),
      setImageExtraParams: (params) => set({ imageExtraParams: params }),
      setImageReferenceImages: (images) => set({ imageReferenceImages: images.slice(0, 10) }),
      setImageResult: (url) => set({ imageResult: url }),
      setImageGenerating: (generating) => set({ imageGenerating: generating }),

      // Video studio
      setVideoPrompt: (prompt) => set({ videoPrompt: prompt }),
      setSelectedVideoModel: (model) => set({ selectedVideoModel: model }),
      setVideoAspectRatio: (ratio) => set({ videoAspectRatio: ratio }),
      setVideoDuration: (duration) => set({ videoDuration: duration }),
      setVideoResolution: (resolution) => set({ videoResolution: resolution }),
      setVideoResult: (url) => set({ videoResult: url }),
      setVideoGenerating: (generating) => set({ videoGenerating: generating }),
      setVideoFeatureMode: (mode) => set({ videoFeatureMode: mode }),
      setVideoI2VSubMode: (mode) => set({ videoI2VSubMode: mode }),
      setVideoSingleUpload: (asset) => set({ videoSingleUpload: asset }),
      setVideoFirstFrameUpload: (asset) => set({ videoFirstFrameUpload: asset }),
      setVideoLastFrameUpload: (asset) => set({ videoLastFrameUpload: asset }),
      setVideoReferenceUploads: (assets) => set((state) => ({
        videoReferenceUploads: typeof assets === 'function' ? assets(state.videoReferenceUploads) : assets,
      })),
      setVideoMultiRefAssets: (assets) => set((state) => ({
        videoMultiRefAssets: typeof assets === 'function' ? assets(state.videoMultiRefAssets) : assets,
      })),
      clearVideoUploads: () => set({
        videoSingleUpload: null,
        videoFirstFrameUpload: null,
        videoLastFrameUpload: null,
        videoReferenceUploads: [],
        videoMultiRefAssets: [],
      }),

      // Cinema studio
      setCinemaPrompt: (prompt) => set({ cinemaPrompt: prompt }),
      setSelectedCamera: (camera) => set({ selectedCamera: camera }),
      setSelectedLens: (lens) => set({ selectedLens: lens }),
      setSelectedFocalLength: (fl) => set({ selectedFocalLength: fl }),
      setSelectedAperture: (aperture) => set({ selectedAperture: aperture }),
      setCinemaResult: (url) => set({ cinemaResult: url }),
      setCinemaGenerating: (generating) => set({ cinemaGenerating: generating }),

      // History
      addHistoryEntry: (entry) => {
        const historyKey = entry.type === 'image'
          ? 'imageHistory'
          : entry.type === 'video'
          ? 'videoHistory'
          : 'cinemaHistory';
        set((state) => {
          const current = state[historyKey as keyof FreedomState] as HistoryEntry[];
          const updated = [entry, ...current].slice(0, MAX_HISTORY);
          return { [historyKey]: updated };
        });
      },

      removeHistoryEntry: (id) => {
        set((state) => ({
          imageHistory: state.imageHistory.filter(h => h.id !== id),
          videoHistory: state.videoHistory.filter(h => h.id !== id),
          cinemaHistory: state.cinemaHistory.filter(h => h.id !== id),
        }));
      },

      clearHistory: (type) => {
        const key = type === 'image'
          ? 'imageHistory'
          : type === 'video'
          ? 'videoHistory'
          : 'cinemaHistory';
        set({ [key]: [] });
      },

      // Active tasks
      addActiveTask: (task) => {
        set((state) => ({ activeTasks: [task, ...state.activeTasks].slice(0, 20) }));
      },
      updateActiveTask: (id, patch) => {
        set((state) => ({
          activeTasks: state.activeTasks.map((t) =>
            t.id === id ? { ...t, ...patch } : t,
          ),
        }));
      },
      removeActiveTask: (id) => {
        set((state) => ({
          activeTasks: state.activeTasks.filter((t) => t.id !== id),
        }));
      },
      cancelActiveTask: (id) => {
        const task = get().activeTasks.find((t) => t.id === id);
        if (task?.controller && !task.controller.signal.aborted) {
          try { task.controller.abort(); } catch {}
        }
        set((state) => ({
          activeTasks: state.activeTasks.map((t) =>
            t.id === id ? { ...t, status: 'cancelling', message: '正在取消…' } : t,
          ),
        }));
      },
    }),
    {
      name: 'moyin-freedom',
      version: 2,
      // 仅持久化用户配置/历史，运行时状态（生成中标志、临时结果）不入库，
      // 避免上次任务异常中断后 imageGenerating 卡为 true 导致页面无法生图
      partialize: (state) => ({
        activeStudio: state.activeStudio,
        imagePrompt: state.imagePrompt,
        selectedImageModel: state.selectedImageModel,
        imageAspectRatio: state.imageAspectRatio,
        imageResolution: state.imageResolution,
        imageExtraParams: state.imageExtraParams,
        imageReferenceImages: state.imageReferenceImages,
        videoPrompt: state.videoPrompt,
        selectedVideoModel: state.selectedVideoModel,
        videoAspectRatio: state.videoAspectRatio,
        videoDuration: state.videoDuration,
        videoResolution: state.videoResolution,
        videoFeatureMode: state.videoFeatureMode,
        videoI2VSubMode: state.videoI2VSubMode,
        cinemaPrompt: state.cinemaPrompt,
        selectedCamera: state.selectedCamera,
        selectedLens: state.selectedLens,
        selectedFocalLength: state.selectedFocalLength,
        selectedAperture: state.selectedAperture,
        imageHistory: state.imageHistory,
        videoHistory: state.videoHistory,
        cinemaHistory: state.cinemaHistory,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          // 双重保险：恢复后强制重置所有 generating 标志
          state.imageGenerating = false;
          state.videoGenerating = false;
          state.cinemaGenerating = false;
          // 运行时任务列表不持久化，强制清空（防止旧版本残留）
          state.activeTasks = [];
        }
      },
      migrate: (persistedState: any, version) => {
        // 从 v1 升级：丢弃旧的 generating / result 字段
        if (version < 2 && persistedState) {
          delete persistedState.imageGenerating;
          delete persistedState.videoGenerating;
          delete persistedState.cinemaGenerating;
          delete persistedState.imageResult;
          delete persistedState.videoResult;
          delete persistedState.cinemaResult;
        }
        return persistedState;
      },
    }
  )
);
