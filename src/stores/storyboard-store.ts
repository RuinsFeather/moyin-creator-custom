// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard Store (分镜)
 *
 * 一个项目只维护一份当前分镜文档（document），使用项目级持久化：
 *   createProjectScopedStorage('storyboard')
 *
 * 不建立集、场层级，不包含 selectedEpisodeId / selectedSceneId。
 * 图片/视频生成与提示词统一由蓝图或自由模块处理，本 Store 不涉及。
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createProjectScopedStorage } from "@/lib/project-storage";
import { useProjectStore } from "@/stores/project-store";
import type {
  StoryboardDocument,
  StoryboardShot,
  StoryboardShotContent,
  StoryboardReferences,
  StoryboardReferenceImage,
  StoryboardAnalysisJob,
  StoryboardPersistedState,
  StoryboardVersion,
} from "@/types/storyboard";

// ==================== Factory ====================

function createId(): string {
  return globalThis.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptyShotContent(): StoryboardShotContent {
  return {
    summary: "",
    scene: "",
    action: "",
    dialogue: "",
    shotSize: "",
    cameraMovement: "",
  };
}

function emptyReferences(): StoryboardReferences {
  return { characters: [], costumes: [], scenes: [] };
}

/** 生成一个全新的分镜镜头 */
export function createEmptyShot(index: number): StoryboardShot {
  const now = Date.now();
  return {
    id: createId(),
    order: index,
    shotNumber: String(index + 1),
    content: emptyShotContent(),
    references: emptyReferences(),
    notes: "",
    referenceImages: [],
    origin: "manual",
    reviewStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

/** 重新按顺序编号（order + shotNumber） */
function reindexShots(shots: StoryboardShot[]): StoryboardShot[] {
  return shots
    .map((shot, i) => ({
      ...shot,
      order: i,
      shotNumber: String(i + 1),
      updatedAt: Date.now(),
    }));
}

// ==================== Store ====================

interface StoryboardActions {
  // document lifecycle
  initDocument: (partial: Partial<Pick<StoryboardDocument, "title" | "sourceScriptPath" | "sourceScriptRevision" | "sourceScriptContentHash">>) => string;
  setTitle: (title: string) => void;
  setStatus: (status: StoryboardDocument["status"]) => void;
  markDirty: (dirty?: boolean) => void;
  clearDocument: () => void;

  // shot CRUD
  addShot: (index?: number) => void;
  duplicateShot: (shotId: string) => void;
  updateShot: (shotId: string, updates: Partial<StoryboardShot>) => void;
  updateShotContent: (shotId: string, updates: Partial<StoryboardShotContent>) => void;
  deleteShot: (shotId: string) => void;
  deleteShots: (shotIds: string[]) => void;
  reorderShots: (fromIndex: number, toIndex: number) => void;
  splitShot: (shotId: string, atIndex?: number) => void;
  mergeShots: (shotIds: string[]) => void;

  // references
  setShotReferences: (shotId: string, references: Partial<StoryboardReferences>) => void;
  addReferenceImage: (shotId: string, image: Omit<StoryboardReferenceImage, "id">) => void;
  removeReferenceImage: (shotId: string, imageId: string) => void;
  reorderReferenceImages: (shotId: string, fromIndex: number, toIndex: number) => void;

  // selection
  setSelectedShot: (shotId: string | null) => void;
  toggleShotSelection: (shotId: string) => void;
  setSelectedShots: (shotIds: string[]) => void;
  clearShotSelection: () => void;

  // analysis job
  setAnalysisJob: (job: StoryboardAnalysisJob | null) => void;
  setAnalysisProgress: (updates: Partial<Pick<StoryboardAnalysisJob, "progress" | "message" | "status" | "error" | "finishedAt">>) => void;

  // versions
  createVersion: (reason?: string) => void;
  restoreVersion: (document: StoryboardDocument) => void;
  deleteVersion: (versionId: string) => void;
  clearVersions: () => void;

  // import dialog
  setImportDialogOpen: (open: boolean) => void;

  // persistence
  saveToWorkspace: () => Promise<{ jsonPath: string; mdPath?: string }>;
}

type StoryboardStore = StoryboardPersistedState & StoryboardActions;

const initialState: StoryboardPersistedState = {
  document: null,
  selectedShotId: null,
  selectedShotIds: [],
  analysisJob: null,
  importDialogOpen: false,
  dirty: false,
  versions: [],
};

export const useStoryboardStore = create<StoryboardStore>()(
  persist(
    (set, get) => ({
      ...initialState,

      initDocument: (partial) => {
        const now = Date.now();
        const activeProjectId = useProjectStore.getState().activeProjectId;
        const newDoc: StoryboardDocument = {
          id: createId(),
          projectId: activeProjectId || "unknown",
          title: partial.title || "未命名分镜",
          sourceScriptPath: partial.sourceScriptPath || "",
          sourceScriptRevision: partial.sourceScriptRevision,
          sourceScriptContentHash: partial.sourceScriptContentHash,
          version: 1,
          status: "draft",
          shots: [],
          createdAt: now,
          updatedAt: now,
        };
        set({
          document: newDoc,
          selectedShotId: null,
          dirty: true,
        });
        return newDoc.id;
      },

      setTitle: (title) =>
        set((state) => {
          if (!state.document) return state;
          return {
            document: { ...state.document, title, updatedAt: Date.now() },
            dirty: true,
          };
        }),

      setStatus: (status) =>
        set((state) => {
          if (!state.document) return state;
          return { document: { ...state.document, status, updatedAt: Date.now() } };
        }),

      markDirty: (dirty = true) => set({ dirty }),

      clearDocument: () => set({ document: null, selectedShotId: null, selectedShotIds: [], versions: [] }),

      addShot: (index) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const at = index ?? shots.length;
          const nw = createEmptyShot(0);
          const next = [...shots.slice(0, at), nw, ...shots.slice(at)];
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            selectedShotId: nw.id,
            dirty: true,
          };
        }),

      duplicateShot: (shotId) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const idx = shots.findIndex((s) => s.id === shotId);
          if (idx < 0) return state;
          const src = shots[idx];
          const now = Date.now();
          const copy: StoryboardShot = {
            ...src,
            id: createId(),
            createdAt: now,
            updatedAt: now,
            reviewStatus: "pending",
            referenceImages: src.referenceImages.map((img) => ({ ...img, id: createId() })),
          };
          const next = [...shots.slice(0, idx + 1), copy, ...shots.slice(idx + 1)];
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            selectedShotId: copy.id,
            dirty: true,
          };
        }),

      updateShot: (shotId, updates) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) =>
            s.id === shotId
              ? { ...s, ...updates, id: s.id, updatedAt: Date.now() }
              : s,
          );
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      updateShotContent: (shotId, updates) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) =>
            s.id === shotId
              ? { ...s, content: { ...s.content, ...updates }, updatedAt: Date.now() }
              : s,
          );
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      deleteShot: (shotId) =>
        set((state) => {
          if (!state.document) return state;
          const next = state.document.shots.filter((s) => s.id !== shotId);
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            selectedShotId: state.selectedShotId === shotId ? null : state.selectedShotId,
            dirty: true,
          };
        }),

      deleteShots: (shotIds) =>
        set((state) => {
          if (!state.document) return state;
          const del = new Set(shotIds);
          const next = state.document.shots.filter((s) => !del.has(s.id));
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            selectedShotId: state.selectedShotId && del.has(state.selectedShotId) ? null : state.selectedShotId,
            dirty: true,
          };
        }),

      reorderShots: (fromIndex, toIndex) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          if (fromIndex < 0 || fromIndex >= shots.length || toIndex < 0 || toIndex >= shots.length) return state;
          const next = [...shots];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() }, dirty: true };
        }),

      splitShot: (shotId, atIndex) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const idx = shots.findIndex((s) => s.id === shotId);
          if (idx < 0) return state;
          const src = shots[idx];
          const now = Date.now();
          const contentText =
            src.content.action || src.content.summary || "";
          const splitAt = atIndex && atIndex > 0 && atIndex < contentText.length
            ? atIndex
            : Math.floor(contentText.length / 2);
          const partA = contentText.slice(0, splitAt).trim();
          const partB = contentText.slice(splitAt).trim();
          // 后半段作为新镜头
          const second: StoryboardShot = {
            ...src,
            id: createId(),
            order: 0,
            content: {
              ...src.content,
              action: partB,
              summary: partB,
              dialogue: "",
            },
            createdAt: now,
            updatedAt: now,
            reviewStatus: "pending",
            referenceImages: [],
          };
          const first: StoryboardShot = {
            ...src,
            content: { ...src.content, action: partA, summary: partA },
            updatedAt: now,
          };
          const next = [...shots.slice(0, idx), first, second, ...shots.slice(idx + 1)];
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            dirty: true,
          };
        }),

      mergeShots: (shotIds) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const del = new Set(shotIds);
          const targets = shots.filter((s) => del.has(s.id));
          if (targets.length === 0) return state;
          const kept = targets[0];
          const now = Date.now();
          const merged: StoryboardShot = {
            ...kept,
            content: {
              ...kept.content,
              action: targets.map((t) => t.content.action).filter(Boolean).join("\n"),
              dialogue: targets.map((t) => t.content.dialogue).filter(Boolean).join("\n"),
              summary: targets.map((t) => t.content.summary).filter(Boolean).join(" / "),
            },
            notes: targets.map((t) => t.notes).filter(Boolean).join("\n"),
            referenceImages: targets.flatMap((t) => t.referenceImages),
            updatedAt: now,
          };
          const next = shots.filter((s) => !del.has(s.id));
          next[shots.findIndex((s) => s.id === kept.id)] = merged;
          return {
            document: { ...state.document, shots: reindexShots(next), updatedAt: Date.now() },
            dirty: true,
          };
        }),

      setShotReferences: (shotId, references) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) =>
            s.id === shotId
              ? { ...s, references: { ...s.references, ...references }, updatedAt: Date.now() }
              : s,
          );
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      addReferenceImage: (shotId, image) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) => {
            if (s.id !== shotId) return s;
            return {
              ...s,
              referenceImages: [...s.referenceImages, { ...image, id: createId() }],
              updatedAt: Date.now(),
            };
          });
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      removeReferenceImage: (shotId, imageId) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) =>
            s.id === shotId
              ? { ...s, referenceImages: s.referenceImages.filter((i) => i.id !== imageId), updatedAt: Date.now() }
              : s,
          );
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      reorderReferenceImages: (shotId, fromIndex, toIndex) =>
        set((state) => {
          if (!state.document) return state;
          const { shots } = state.document;
          const next = shots.map((s) => {
            if (s.id !== shotId) return s;
            const imgs = [...s.referenceImages];
            if (fromIndex < 0 || fromIndex >= imgs.length || toIndex < 0 || toIndex >= imgs.length) return s;
            const [moved] = imgs.splice(fromIndex, 1);
            imgs.splice(toIndex, 0, moved);
            return { ...s, referenceImages: imgs, updatedAt: Date.now() };
          });
          return { document: { ...state.document, shots: next, updatedAt: Date.now() }, dirty: true };
        }),

      setSelectedShot: (selectedShotId) => set({ selectedShotId }),

      toggleShotSelection: (shotId) =>
        set((state) => {
          const selectedShotIds = state.selectedShotIds.includes(shotId)
            ? state.selectedShotIds.filter((id) => id !== shotId)
            : [...state.selectedShotIds, shotId];
          return { selectedShotIds };
        }),

      setSelectedShots: (selectedShotIds) => set({ selectedShotIds }),

      clearShotSelection: () => set({ selectedShotIds: [] }),

      setAnalysisJob: (analysisJob) => set({ analysisJob }),

      setAnalysisProgress: (updates) =>
        set((state) => {
          if (!state.analysisJob) return state;
          return { analysisJob: { ...state.analysisJob, ...updates } };
        }),

      createVersion: (reason) =>
        set((state) => {
          if (!state.document) return state;
          const now = Date.now();
          const snapshot: StoryboardVersion = {
            id: createId(),
            version: state.document.version,
            label: reason,
            reason,
            document: state.document,
            createdAt: now,
          };
          return {
            versions: [snapshot, ...state.versions],
            document: { ...state.document, version: state.document.version + 1, updatedAt: now },
            dirty: true,
          };
        }),

      restoreVersion: (document) =>
        set((state) => ({
          document: { ...document, id: state.document?.id || document.id, updatedAt: Date.now() },
          selectedShotId: null,
          dirty: true,
        })),

      deleteVersion: (versionId) =>
        set((state) => ({
          versions: state.versions.filter((v) => v.id !== versionId),
        })),

      clearVersions: () => set({ versions: [] }),

      setImportDialogOpen: (importDialogOpen) => set({ importDialogOpen }),

      saveToWorkspace: async () => {
        const state = get();
        if (!state.document) throw new Error("没有可分镜文档");
        // 实际文件保存由 script-workspace-fs 提供，见 storyboard-file-service
        // 这里仅标记保存状态
        set({ dirty: false });
        return { jsonPath: "storyboard.json" };
      },
    }),
    {
      name: "moyin-storyboard-store",
      storage: createJSONStorage(() => createProjectScopedStorage("storyboard")),
      partialize: (state) => ({
        document: state.document,
        selectedShotId: state.selectedShotId,
        selectedShotIds: state.selectedShotIds,
        analysisJob: state.analysisJob,
        importDialogOpen: state.importDialogOpen,
        dirty: state.dirty,
        versions: state.versions,
      }),
    },
  ),
);

/** 获取当前项目分镜文档（默认一份） */
export function useActiveStoryboardDocument(): StoryboardDocument | null {
  return useStoryboardStore((state) => state.document);
}