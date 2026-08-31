// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import { migrateStoryboardFromLegacy } from "../storyboard-migration";
import type { LegacySplitSceneMigrationInput } from "../storyboard-migration";

function legacyScene(overrides: Partial<LegacySplitSceneMigrationInput> = {}): LegacySplitSceneMigrationInput {
  return {
    id: 1,
    sceneName: "咖啡馆",
    sceneLocation: "室内",
    actionSummary: "林夏推门进入。",
    dialogue: "你好。",
    shotSize: "中景",
    duration: 4,
    cameraMovement: "跟拍",
    characterIds: ["char_1"],
    sceneLibraryId: "scene_lib_1",
    sceneReferenceImage: "local-image://ref1",
    ...overrides,
  };
}

describe("migrateStoryboardFromLegacy", () => {
  it("extracts scene, action, dialogue, shotSize, duration, cameraMovement", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [legacyScene()],
    });
    expect(result.document).not.toBeNull();
    const shot = result.document!.shots[0];
    expect(shot.content.scene).toBe("咖啡馆，室内");
    expect(shot.content.action).toBe("林夏推门进入。");
    expect(shot.content.dialogue).toBe("你好。");
    expect(shot.content.shotSize).toBe("中景");
    expect(shot.content.durationSeconds).toBe(4);
    expect(shot.content.cameraMovement).toBe("跟拍");
  });

  it("maps characters and scenes to references", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [legacyScene()],
      characterNameMap: { char_1: "洛蓝" },
    });
    const shot = result.document!.shots[0];
    expect(shot.references.characters[0].id).toBe("char_1");
    expect(shot.references.characters[0].name).toBe("洛蓝");
    expect(shot.references.characters[0].source).toBe("library");
    expect(shot.references.scenes[0].id).toBe("scene_lib_1");
    expect(shot.references.scenes[0].name).toBe("咖啡馆");
    expect(shot.references.scenes[0].source).toBe("library");
    expect(shot.references.costumes).toEqual([]);
  });

  it("migrates notes and reference images but discards legacy fields", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [
        legacyScene({
          notes: "注意连续性",
          imageDataUrl: "data:image/png;base64,xxx",
          imageHttpUrl: "https://example.com/frame.png",
          imageStatus: "completed",
          imagePrompt: "a cafe",
          endFrameImageUrl: "data:...",
          endFramePrompt: "end",
          videoStatus: "completed",
          videoUrl: "https://example.com/v.mp4",
          videoPrompt: "pan in",
        } as unknown as LegacySplitSceneMigrationInput),
      ],
    });
    const shot = result.document!.shots[0];
    expect(shot.notes).toBe("注意连续性");
    expect(shot.referenceImages[0].localUrl).toBe("local-image://ref1");
    // legacy 字段不进入新模型
    expect("imagePrompt" in shot).toBe(false);
    expect("videoUrl" in shot).toBe(false);
    // discarded 字段被统计
    expect(result.discardedFields).toBeGreaterThan(0);
  });

  it("returns null document when nothing to migrate", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [{ id: 1, sceneName: "", actionSummary: "", dialogue: "" }],
    });
    expect(result.document).toBeNull();
    expect(result.migratedCount).toBe(0);
  });

  it("orders shots by index and assigns shotNumber", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [
        legacyScene({ id: 10, sceneName: "A" }),
        legacyScene({ id: 11, sceneName: "B" }),
      ],
    });
    expect(result.migratedCount).toBe(2);
    expect(result.document!.shots[0].shotNumber).toBe("1");
    expect(result.document!.shots[0].order).toBe(0);
    expect(result.document!.shots[1].shotNumber).toBe("2");
    expect(result.document!.shots[1].order).toBe(1);
  });

  it("matches scene by name when no library id", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [legacyScene({ sceneLibraryId: undefined, sceneName: "咖啡馆" })],
      sceneNameMap: { 咖啡馆: "scene_lib_kf" },
    });
    const sceneRef = result.document!.shots[0].references.scenes[0];
    expect(sceneRef.id).toBe("scene_lib_kf");
    expect(sceneRef.source).toBe("library");
  });

  it("migrates characterVariationMap to references.costumes with readable names", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [
        legacyScene({
          characterVariationMap: { char_1: "var_1", char_2: "var_2" },
        }),
      ],
      costumeNameMap: { var_1: "日常装", var_2: "战斗装" },
    });
    const shot = result.document!.shots[0];
    expect(shot.references.costumes).toHaveLength(2);
    expect(shot.references.costumes[0].id).toBe("var_1");
    expect(shot.references.costumes[0].name).toBe("日常装");
    expect(shot.references.costumes[0].source).toBe("library");
    expect(shot.references.costumes[1].id).toBe("var_2");
    expect(shot.references.costumes[1].name).toBe("战斗装");
  });

  it("migrates costume variation reference images", () => {
    const result = migrateStoryboardFromLegacy({
      projectId: "proj1",
      splitScenes: [
        legacyScene({
          characterVariationMap: { char_1: "var_1" },
          costumeReferenceImages: {
            var_1: {
              variationId: "var_1",
              referenceImage: "local://outfit-main",
              clothingReferenceImages: ["local://outfit-1", "local://outfit-2"],
            },
          },
        }),
      ],
    });
    const shot = result.document!.shots[0];
    const costumeImgs = shot.referenceImages.filter((i) => i.sourceType === "costume");
    expect(costumeImgs).toHaveLength(3);
    expect(costumeImgs[0].localUrl).toBe("local://outfit-main");
    expect(costumeImgs[0].relatedReferenceId).toBe("var_1");
    expect(costumeImgs[1].localUrl).toBe("local://outfit-1");
    expect(costumeImgs[2].localUrl).toBe("local://outfit-2");
  });
});