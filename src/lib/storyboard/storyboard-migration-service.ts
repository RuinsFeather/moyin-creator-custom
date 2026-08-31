// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard migration service (分镜旧数据迁移入口)
 *
 * 阶段7：把旧 `SplitScene` 数据迁移到新分镜模型。
 * 本模块是新分镜与旧 director-store 之间的**唯一运行时桥**：
 *   - 读取旧 director-store 的 splitScenes（只读，不修改）。
 *   - 用角色库/场景库把原始 ID 映射为可读名称。
 *   - 调用 `migrateStoryboardFromLegacy` 产出新文档。
 *   - 仅在「新分镜还没有 document / 旧数据确实有分镜」时才迁移，避免覆盖新数据。
 *
 * 迁移是**单向、一次性**的：迁完即在新 store，后续由新 store 持久化。
 */
import { useDirectorStore } from "@/stores/director-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useStoryboardStore } from "@/stores/storyboard-store";
import {
  migrateStoryboardFromLegacy,
  type LegacyCostumeReferenceImageInput,
  type LegacySplitSceneMigrationInput,
} from "./storyboard-migration";

/** 从旧 SplitScene 裁剪出迁移所需的最小子集（不 import director-store 类型） */
function toLegacyInputs(
  scenes: LegacySplitSceneMigrationInput[],
  costumeReferenceImages?: Record<string, LegacyCostumeReferenceImageInput>,
): LegacySplitSceneMigrationInput[] {
  return scenes.map((s) => ({
    id: (s.id as number | string) ?? 0,
    sceneName: (s.sceneName as string) ?? "",
    sceneLocation: (s.sceneLocation as string) ?? "",
    actionSummary: (s.actionSummary as string | undefined) ?? "",
    dialogue: (s.dialogue as string | undefined) ?? "",
    shotSize: (s.shotSize as string | null | undefined) ?? null,
    duration: (s.duration as number | string | undefined) ?? undefined,
    cameraMovement: (s.cameraMovement as string | undefined) ?? "",
    characterIds: (s.characterIds as string[] | undefined) ?? [],
    characterVariationMap: (s.characterVariationMap as
      | Record<string, string>
      | undefined),
    costumeReferenceImages,
    sceneLibraryId: (s.sceneLibraryId as string | undefined) ?? undefined,
    sceneReferenceImage: (s.sceneReferenceImage as string | undefined) ?? undefined,
    notes: (s.notes as string | undefined) ?? "",
  }));
}

/**
 * 对当前项目执行一次旧分镜迁移。
 *
 * @returns { migrated: boolean; message?: string }
 *   - migrated=true 表示本次确实迁移了镜头
 *   - migrated=false 表示无需迁移（新文档已存在 / 旧数据为空）
 */
export function migrateLegacyStoryboardForActiveProject(): {
  migrated: boolean;
  message?: string;
} {
  const storyboardDoc = useStoryboardStore.getState().document;
  // 新分镜已有文档时不重复迁移（保护新数据）
  if (storyboardDoc && storyboardDoc.shots.length > 0) {
    return { migrated: false, message: "新分镜已存在，跳过迁移" };
  }

  const directorProject = useDirectorStore.getState().projects[
    useDirectorStore.getState().activeProjectId || ""
  ];
  const splitScenes = directorProject?.splitScenes ?? [];
  if (!splitScenes || splitScenes.length === 0) {
    return { migrated: false, message: "没有可迁移的旧分镜数据" };
  }

  // 角色/场景名映射：把旧库 ID 解析为可读名称
  const characterNameMap: Record<string, string> = {};
  const costumeNameMap: Record<string, string> = {};
  const costumeReferenceImages: Record<string, LegacyCostumeReferenceImageInput> = {};
  for (const c of useCharacterLibraryStore.getState().characters) {
    characterNameMap[c.id] = c.name;
    for (const v of c.variations ?? []) {
      costumeNameMap[v.id] = v.name;
      if (v.referenceImage || (v.clothingReferenceImages?.length ?? 0) > 0) {
        costumeReferenceImages[v.id] = {
          variationId: v.id,
          referenceImage: v.referenceImage,
          clothingReferenceImages: v.clothingReferenceImages,
        };
      }
    }
  }
  const sceneNameMap: Record<string, string> = {};
  for (const s of useSceneStore.getState().scenes) {
    sceneNameMap[s.name] = s.id;
  }

  const activeProjectId = useDirectorStore.getState().activeProjectId || "";
  const result = migrateStoryboardFromLegacy({
    projectId: activeProjectId,
    title: directorProject?.storyboardConfig?.storyPrompt ? undefined : undefined,
    splitScenes: toLegacyInputs(
      splitScenes as unknown as LegacySplitSceneMigrationInput[],
      costumeReferenceImages,
    ),
    characterNameMap,
    costumeNameMap,
    sceneNameMap,
  });

  if (!result.document) {
    return { migrated: false, message: result.message };
  }

  useStoryboardStore.getState().applyMigratedDocument(result.document);
  return { migrated: true, message: result.message };
}