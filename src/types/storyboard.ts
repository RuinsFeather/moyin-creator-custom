// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard domain types (分镜)
 *
 * 一个项目只维护一份当前分镜文档，代表当前项目中一份单集、单场剧本的
 * AI 拆镜和人工整理结果。不包含集、场层级，不负责生成图片或视频。
 *
 * 明确不包含的字段（历史 SplitScene 遗留）：
 *   - sourceEpisodeId / sourceSceneId / selectedEpisodeId / selectedSceneId
 *   - imagePrompt* / endFramePrompt* / videoPrompt*
 *   - imageDataUrl / imageHttpUrl / endFrameImageUrl / endFrameHttpUrl
 *   - imageStatus / endFrameStatus / videoStatus / videoUrl
 *   - needsEndFrame
 */

// ==================== References ====================

/** 参考项（角色 / 服装 / 场景）——语义引用，不等同于参考图 */
export interface StoryboardReferenceItem {
  id: string;
  name: string;
  libraryItemId?: string;
  source: 'library' | 'ai-suggestion' | 'manual';
}

export interface StoryboardReferences {
  characters: StoryboardReferenceItem[];
  costumes: StoryboardReferenceItem[];
  scenes: StoryboardReferenceItem[];
}

/** 参考图——只用于信息整理和后续蓝图消费，不触发任何生成任务 */
export interface StoryboardReferenceImage {
  id: string;
  sourceType: 'asset' | 'character' | 'costume' | 'scene' | 'upload';
  assetId?: string;
  relatedReferenceId?: string;
  localUrl?: string;
  thumbnailUrl?: string;
  label?: string;
}

// ==================== Shot ====================

export interface StoryboardShotContent {
  summary: string;
  scene: string;
  action: string;
  dialogue: string;
  shotSize: string;
  durationSeconds?: number;
  cameraMovement: string;
  additionalDescription?: string;
}

export interface StoryboardShot {
  id: string;

  sourceText?: string;
  sourceTextRange?: {
    start: number;
    end: number;
  };

  order: number;
  shotNumber: string;

  content: StoryboardShotContent;
  references: StoryboardReferences;
  notes: string;
  referenceImages: StoryboardReferenceImage[];

  origin: 'ai' | 'manual' | 'imported';
  reviewStatus: 'pending' | 'confirmed' | 'modified';
  createdAt: number;
  updatedAt: number;
}

// ==================== Document ====================

export type StoryboardStatus = 'draft' | 'analyzing' | 'review' | 'confirmed';

export interface StoryboardDocument {
  id: string;
  projectId: string;
  title: string;

  sourceScriptPath: string;
  sourceScriptRevision?: string;
  sourceScriptContentHash?: string;

  version: number;
  status: StoryboardStatus;
  shots: StoryboardShot[];

  createdAt: number;
  updatedAt: number;
}

// ==================== Analysis Job ====================

export type StoryboardAnalysisStatus =
  | 'idle'
  | 'running'
  | 'cancelled'
  | 'failed'
  | 'succeeded';

export interface StoryboardAnalysisJob {
  id: string;
  status: StoryboardAnalysisStatus;
  progress: number; // 0 - 100
  message?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  // pre-analysis snapshot: store the document before applying AI results
  snapshot?: StoryboardDocument | null;
}

// ==================== Store state ====================

/** 分镜版本快照（用于版本历史 / 切换 / 恢复） */
export interface StoryboardVersion {
  id: string;
  version: number;
  label?: string;
  reason?: string;
  document: StoryboardDocument;
  createdAt: number;
}

export interface StoryboardPersistedState {
  document: StoryboardDocument | null;
  /** 详情面板当前选中的镜头（单选） */
  selectedShotId: string | null;
  /** 批量勾选的一组镜头（用于发送到蓝图等操作） */
  selectedShotIds: string[];
  analysisJob: StoryboardAnalysisJob | null;
  importDialogOpen: boolean;
  dirty: boolean;
  /** 版本历史（不含当前），按时间倒序 */
  versions: StoryboardVersion[];
}