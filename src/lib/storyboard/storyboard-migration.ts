// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard migration (分镜旧数据迁移)
 *
 * 从旧 `SplitScene` 数据迁移到新分镜模型（StoryboardDocument/StoryboardShot）。
 * 迁移规则：
 *   - 提取：场景（sceneName + sceneLocation）、动作（actionSummary）、对白（dialogue）、
 *     景别（shotSize）、时长（duration）、镜头运动（cameraMovement）。
 *   - 映射：角色（characterIds → references.characters）、场景（sceneLibraryId → references.scenes）。
 *   - 迁移：备注（notes 相关字段）和可用参考图（sceneReferenceImage）。
 *   - 丢弃：首尾帧（imageDataUrl/imageHttpUrl/endFrame*）、提示词（*Prompt*）、
 *     视频状态（videoStatus/videoUrl/videoError）、needsEndFrame。
 *
 * 本模块是**纯函数**，不依赖 director-store / sclass-store，保持依赖边界清晰。
 */
import type {
  StoryboardDocument,
  StoryboardShot,
  StoryboardShotContent,
  StoryboardReferences,
  StoryboardReferenceItem,
  StoryboardReferenceImage,
} from "@/types/storyboard";

/** 旧服装变体的最小参考图信息（用于迁移服装参考图） */
export interface LegacyCostumeReferenceImageInput {
  variationId: string;
  /** 变体主参考图 */
  referenceImage?: string;
  /** 用户上传的服装/服饰参考图 */
  clothingReferenceImages?: string[];
}

// ==================== Legacy input types ====================

/**
 * 旧 SplitScene 中用于迁移的最小子集。
 * 字段名与 director-store 的 SplitScene 镜像，但不 import director-store，
 * 以保持蓝图/迁移边界（generation-chain-boundary）干净。
 */
export interface LegacySplitSceneMigrationInput {
  id: number | string;
  sceneName: string;
  sceneLocation?: string;
  actionSummary?: string;
  dialogue?: string;
  shotSize?: string | null;
  duration?: number | string;
  cameraMovement?: string;
  characterIds?: string[];
  /** 角色服装变体映射（charId → variationId），迁移为 references.costumes */
  characterVariationMap?: Record<string, string>;
  /** 服装变体参考图（variationId → 图片），迁移为参考图 */
  costumeReferenceImages?: Record<string, LegacyCostumeReferenceImageInput>;
  sceneLibraryId?: string;
  sceneReferenceImage?: string;
  notes?: string;
  row?: number;
  col?: number;
}

export interface LegacyStoryboardMigrationInput {
  /** 旧项目分镜数组 */
  splitScenes: LegacySplitSceneMigrationInput[];
  /** 目标项目 ID */
  projectId: string;
  /** 分镜文档标题（默认取第一个场景名或"旧分镜迁移"） */
  title?: string;
  /** 场景名 → 场景引用（用于反向映射场景参考项） */
  sceneNameMap?: Record<string, string>;
  /** 角色名 → 角色引用（用于把 characterIds 映射为可读名称） */
  characterNameMap?: Record<string, string>;
  /** 服装变体名 → 服装引用（用于把 characterVariationMap 映射为可读名称） */
  costumeNameMap?: Record<string, string>;
}

export interface StoryboardMigrationResult {
  /** 迁移产出的分镜文档；无任何可迁移镜头时为 null */
  document: StoryboardDocument | null;
  /** 成功迁移的镜头数 */
  migratedCount: number;
  /** 被丢弃的首尾帧/提示词/视频字段数（仅统计，便于审计） */
  discardedFields: number;
  /** 迁移说明（用于 toast / 日志） */
  message: string;
}

// ==================== Helpers ====================

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() || `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDuration(duration: number | string | undefined): number | undefined {
  if (duration === undefined || duration === null) return undefined;
  const n = typeof duration === "number" ? duration : Number(duration);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n);
}

function normalizeShotSize(shotSize: string | null | undefined): string {
  if (!shotSize) return "";
  return String(shotSize).trim();
}

function buildReference(
  id: string,
  name: string,
  source: StoryboardReferenceItem["source"],
): StoryboardReferenceItem {
  return { id: id || makeId(), name: name || id || "未命名", source };
}

function buildSceneRef(
  input: LegacySplitSceneMigrationInput,
  sceneNameMap?: Record<string, string>,
): StoryboardReferenceItem | null {
  const distId = input.sceneLibraryId;
  if (distId) {
    return buildReference(distId, input.sceneName || distId, "library");
  }
  // 无稳定 ID 时按场景名匹配场景库
  const name = input.sceneName?.trim();
  if (!name) return null;
  const libId = sceneNameMap?.[name];
  return buildReference(libId || name, name, libId ? "library" : "manual");
}

function buildCharacterRefs(
  input: LegacySplitSceneMigrationInput,
  characterNameMap?: Record<string, string>,
): StoryboardReferenceItem[] {
  const ids = input.characterIds ?? [];
  return ids.map((id) => {
    const name = characterNameMap?.[id] || id;
    return buildReference(id, name, "library");
  });
}

function buildCostumeRefs(
  input: LegacySplitSceneMigrationInput,
  costumeNameMap?: Record<string, string>,
): StoryboardReferenceItem[] {
  const map = input.characterVariationMap ?? {};
  return Object.entries(map)
    .filter(([, variationId]) => variationId)
    .map(([characterId, variationId]) => {
      const name = costumeNameMap?.[variationId] || variationId;
      return buildReference(variationId, name, "library");
    });
}

function buildReferenceImages(
  input: LegacySplitSceneMigrationInput,
): StoryboardReferenceImage[] {
  const images: StoryboardReferenceImage[] = [];
  if (input.sceneReferenceImage) {
    images.push({
      id: makeId(),
      sourceType: "scene",
      localUrl: input.sceneReferenceImage,
      relatedReferenceId: input.sceneLibraryId,
      label: "场景参考图",
    });
  }
  // 迁移服装变体参考图（charVariationMap 指向的变体）
  const variationMap = input.characterVariationMap ?? {};
  const costumeImages = input.costumeReferenceImages ?? {};
  for (const variationId of Object.values(variationMap)) {
    if (!variationId) continue;
    const entry = costumeImages[variationId];
    if (!entry) continue;
    const urls = [
      entry.referenceImage,
      ...(entry.clothingReferenceImages ?? []),
    ].filter((u): u is string => Boolean(u));
    for (const url of urls) {
      images.push({
        id: makeId(),
        sourceType: "costume",
        localUrl: url,
        relatedReferenceId: variationId,
        label: "服装参考图",
      });
    }
  }
  return images;
}

function buildContent(input: LegacySplitSceneMigrationInput): StoryboardShotContent {
  return {
    summary: input.actionSummary || "",
    scene: [input.sceneName, input.sceneLocation].filter(Boolean).join("，"),
    action: input.actionSummary || "",
    dialogue: input.dialogue || "",
    shotSize: normalizeShotSize(input.shotSize),
    durationSeconds: normalizeDuration(input.duration),
    cameraMovement: input.cameraMovement || "",
  };
}

function buildShot(
  input: LegacySplitSceneMigrationInput,
  index: number,
  ctx: {
    sceneNameMap?: Record<string, string>;
    characterNameMap?: Record<string, string>;
    costumeNameMap?: Record<string, string>;
  },
): StoryboardShot {
  const content = buildContent(input);
  const references: StoryboardReferences = {
    characters: buildCharacterRefs(input, ctx.characterNameMap),
    costumes: buildCostumeRefs(input, ctx.costumeNameMap),
    scenes: (() => {
      const sceneRef = buildSceneRef(input, ctx.sceneNameMap);
      return sceneRef ? [sceneRef] : [];
    })(),
  };
  const now = Date.now();
  return {
    id: String(input.id) || makeId(),
    order: index,
    shotNumber: String(index + 1),
    content,
    references,
    notes: input.notes || "",
    referenceImages: buildReferenceImages(input),
    origin: "imported",
    reviewStatus: "pending",
    createdAt: now,
    updatedAt: now,
  };
}

// ==================== Main ====================

/**
 * 将旧 SplitScene 数据迁移为新的分镜文档。
 *
 * @returns 迁移文档；若没有任何有效镜头则返回 null。
 */
export function migrateStoryboardFromLegacy(
  input: LegacyStoryboardMigrationInput,
): StoryboardMigrationResult {
  const scenes = input.splitScenes ?? [];
  const validScenes = scenes.filter(
    (s) => s.sceneName?.trim() || s.actionSummary?.trim() || s.dialogue?.trim(),
  );

  const ctx = {
    sceneNameMap: input.sceneNameMap,
    characterNameMap: input.characterNameMap,
    costumeNameMap: input.costumeNameMap,
  };

  const shots = validScenes.map((s, i) => buildShot(s, i, ctx));

  // 统计被丢弃的 legacy 字段（仅用于审计）
  let discardedFields = 0;
  for (const s of scenes) {
    if (s) {
      // 首尾帧 / 提示词 / 视频状态 / needsEndFrame 等字段在此不迁移
      // 通过类型层面的排除已保证不进入新模型；这里仅统计数量便于日志
      const legacyKeys = [
        "imageDataUrl", "imageHttpUrl", "imageStatus", "imagePrompt", "imagePromptZh",
        "endFrameImageUrl", "endFrameHttpUrl", "endFramePrompt", "endFramePromptZh",
        "endFrameStatus", "needsEndFrame",
        "videoPrompt", "videoPromptZh", "videoStatus", "videoUrl", "videoError",
      ] as const;
      for (const k of legacyKeys) {
        if (k in (s as unknown as Record<string, unknown>)) discardedFields += 1;
      }
    }
  }

  if (shots.length === 0) {
    return {
      document: null,
      migratedCount: 0,
      discardedFields,
      message: "没有可迁移的旧分镜数据",
    };
  }

  const now = Date.now();
  const document: StoryboardDocument = {
    id: makeId(),
    projectId: input.projectId,
    title: input.title || shots[0].content.scene || "旧分镜迁移",
    sourceScriptPath: "",
    version: 1,
    status: "draft",
    shots,
    createdAt: now,
    updatedAt: now,
    sourceScriptContentHash: undefined,
  };

  return {
    document,
    migratedCount: shots.length,
    discardedFields,
    message: `已从旧分镜迁移 ${shots.length} 个镜头`,
  };
}