// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard migration service（分镜旧数据迁移入口）测试
 *
 * 覆盖 §12 AI 流程"分析失败不覆盖已有分镜"同源的迁移保护原则：
 *   - 新分镜已有镜头时不覆盖（跳过迁移）
 *   - 旧数据为空时跳过
 *   - 正常迁移成功并应用文档
 */
import { beforeEach, describe, expect, it } from "vitest";
import { migrateLegacyStoryboardForActiveProject } from "../storyboard-migration-service";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useDirectorStore } from "@/stores/director-store";
import { useCharacterLibraryStore } from "@/stores/character-library-store";
import { useSceneStore } from "@/stores/scene-store";
import { useProjectStore } from "@/stores/project-store";

const projectA = "project-a";

beforeEach(() => {
  useProjectStore.setState({ activeProjectId: projectA });
  useStoryboardStore.setState({
    document: null,
    selectedShotId: null,
    selectedShotIds: [],
    analysisJob: null,
    importDialogOpen: false,
    dirty: false,
    versions: [],
  });
  useCharacterLibraryStore.setState({ characters: [] });
  useSceneStore.setState({ scenes: [] });
  // 重置 director store 的相关数据
  useDirectorStore.setState({
    activeProjectId: projectA,
    projects: {},
  } as any);
});

function seedLegacyScenes() {
  useDirectorStore.setState({
    activeProjectId: projectA,
    projects: {
      [projectA]: {
        splitScenes: [
          {
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
          },
        ],
        trailerScenes: [],
      },
    },
  } as any);
}

describe("migrateLegacyStoryboardForActiveProject", () => {
  it("新分镜已有镜头时不覆盖（保护新数据）", () => {
    useStoryboardStore.getState().initDocument({ title: "新分镜" });
    useStoryboardStore.getState().addShot();
    seedLegacyScenes();

    const result = migrateLegacyStoryboardForActiveProject();
    expect(result.migrated).toBe(false);
    // 文档保留新内容
    const doc = useStoryboardStore.getState().document!;
    expect(doc.shots).toHaveLength(1);
  });

  it("无旧数据时跳过迁移", () => {
    useStoryboardStore.getState().initDocument({ title: "空" });
    const result = migrateLegacyStoryboardForActiveProject();
    expect(result.migrated).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("正常迁移旧 SplitScene 数据并应用到新 store", () => {
    seedLegacyScenes();
    useCharacterLibraryStore.setState({
      characters: [
        {
          id: "char_1",
          name: "洛蓝",
          description: "",
          visualTraits: "",
          views: [],
          variations: [],
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    } as any);
    useSceneStore.setState({
      scenes: [
        {
          id: "scene_lib_1",
          name: "咖啡馆",
          location: "室内",
          time: "白天",
          atmosphere: "温馨",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    } as any);

    const result = migrateLegacyStoryboardForActiveProject();
    expect(result.migrated).toBe(true);

    const doc = useStoryboardStore.getState().document;
    expect(doc).not.toBeNull();
    expect(doc!.projectId).toBe(projectA);
    expect(doc!.shots).toHaveLength(1);
    const shot = doc!.shots[0];
    expect(shot.content.scene).toContain("咖啡馆");
    expect(shot.content.action).toBe("林夏推门进入。");
    expect(shot.references.characters[0]).toMatchObject({ id: "char_1", name: "洛蓝", source: "library" });
    expect(shot.references.scenes[0]).toMatchObject({ id: "scene_lib_1", name: "咖啡馆", source: "library" });
    // 迁移后置为选中/置 dirty
    expect(useStoryboardStore.getState().dirty).toBe(true);
  });
});