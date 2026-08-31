// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useStoryboardStore,
  createEmptyShot,
} from "../storyboard-store";
import { useProjectStore } from "../project-store";
import type { StoryboardDocument } from "@/types/storyboard";

const mockLoadFromWorkspace = vi.fn();
vi.mock("@/lib/storyboard/storyboard-file-service", () => ({
  saveStoryboardToWorkspace: vi.fn(),
  persistReferenceImagesToWorkspace: vi.fn(),
  loadStoryboardFromWorkspace: (...args: unknown[]) => mockLoadFromWorkspace(...args),
}));

const projectA = "project-a";

describe("storyboard store", () => {
  beforeEach(() => {
    useStoryboardStore.setState({
      document: null,
      selectedShotId: null,
      selectedShotIds: [],
      analysisJob: null,
      importDialogOpen: false,
      dirty: false,
      versions: [],
    });
    useProjectStore.setState({ activeProjectId: projectA });
  });

  it("creates a single storyboard document tied to the active project", () => {
    const docId = useStoryboardStore
      .getState()
      .initDocument({ title: "咖啡馆初遇", sourceScriptPath: "script.md" });
    const doc = useStoryboardStore.getState().document;
    expect(doc).not.toBeNull();
    expect(doc?.id).toBe(docId);
    expect(doc?.projectId).toBe(projectA);
    expect(doc?.title).toBe("咖啡馆初遇");
    expect(doc?.sourceScriptPath).toBe("script.md");
    expect(doc?.version).toBe(1);
    expect(doc?.shots).toEqual([]);
    expect(useStoryboardStore.getState().dirty).toBe(true);
  });

  it("adds, updates, duplicates and deletes shots with reindexing", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();

    let shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2", "3"]);

    // update content
    const firstId = shots[0].id;
    useStoryboardStore
      .getState()
      .updateShotContent(firstId, { action: "林夏推门进入", shotSize: "中景" });
    let updated = useStoryboardStore.getState().document!.shots[0];
    expect(updated.content.action).toBe("林夏推门进入");
    expect(updated.content.shotSize).toBe("中景");

    // duplicate
    useStoryboardStore.getState().duplicateShot(firstId);
    shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(4);
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2", "3", "4"]);
    expect(shots[1].content.action).toBe("林夏推门进入");

    // delete
    useStoryboardStore.getState().deleteShot(shots[1].id);
    shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(3);
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2", "3"]);
  });

  it("reorders shots and renumbers shotNumbers", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    // 0,1,2 -> move index 2 to 0: [2,0,1]
    useStoryboardStore.getState().reorderShots(2, 0);
    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2", "3"]);
    expect(shots[0].order).toBe(0);
    expect(shots[1].order).toBe(1);
    expect(shots[2].order).toBe(2);
  });

  it("splits a shot into two", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    const shotId = useStoryboardStore.getState().document!.shots[0].id;
    useStoryboardStore
      .getState()
      .updateShotContent(shotId, { action: "林夏推门进入咖啡馆，环顾四周" });
    useStoryboardStore.getState().splitShot(shotId);
    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(2);
    expect(shots.map((s) => s.shotNumber)).toEqual(["1", "2"]);
  });

  it("merges multiple shots into one", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    const [a, b] = useStoryboardStore.getState().document!.shots;
    useStoryboardStore.getState().updateShotContent(a.id, { action: "动作A" });
    useStoryboardStore.getState().updateShotContent(b.id, { action: "动作B" });
    useStoryboardStore.getState().mergeShots([a.id, b.id]);
    const shots = useStoryboardStore.getState().document!.shots;
    expect(shots).toHaveLength(1);
    expect(shots[0].content.action).toContain("动作A");
    expect(shots[0].content.action).toContain("动作B");
  });

  it("manages references and reference images per shot", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    const shotId = useStoryboardStore.getState().document!.shots[0].id;
    useStoryboardStore
      .getState()
      .setShotReferences(shotId, {
        characters: [{ id: "c1", name: "林夏", source: "library", libraryItemId: "lib-1" }],
      });
    let shot = useStoryboardStore.getState().document!.shots[0];
    expect(shot.references.characters).toHaveLength(1);
    expect(shot.references.characters[0].name).toBe("林夏");

    useStoryboardStore
      .getState()
      .addReferenceImage(shotId, { sourceType: "upload", localUrl: "local-image://x" });
    shot = useStoryboardStore.getState().document!.shots[0];
    expect(shot.referenceImages).toHaveLength(1);
    const imgId = shot.referenceImages[0].id;

    useStoryboardStore.getState().removeReferenceImage(shotId, imgId);
    shot = useStoryboardStore.getState().document!.shots[0];
    expect(shot.referenceImages).toHaveLength(0);
  });

  it("creates and restores versions", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    const v1 = useStoryboardStore.getState().document!.version;
    useStoryboardStore.getState().createVersion("切换前快照");
    expect(useStoryboardStore.getState().document!.version).toBe(v1 + 1);
    // 版本快照已被记录
    expect(useStoryboardStore.getState().versions).toHaveLength(1);
    expect(useStoryboardStore.getState().versions[0].reason).toBe("切换前快照");
    expect(useStoryboardStore.getState().versions[0].document.shots).toHaveLength(1);

    const restored = useStoryboardStore.getState().document!;
    useStoryboardStore.getState().restoreVersion(restored);
    expect(useStoryboardStore.getState().document?.id).toBe(restored.id);
    expect(useStoryboardStore.getState().document?.shots).toHaveLength(1);

    // 删除版本
    const vid = useStoryboardStore.getState().versions[0].id;
    useStoryboardStore.getState().deleteVersion(vid);
    expect(useStoryboardStore.getState().versions).toHaveLength(0);
  });

  it("tracks analysis job progress", () => {
    useStoryboardStore.getState().setAnalysisJob({
      id: "job-1",
      status: "running",
      progress: 0,
      startedAt: Date.now(),
    });
    useStoryboardStore.getState().setAnalysisProgress({ progress: 50, message: "拆分中" });
    const job = useStoryboardStore.getState().analysisJob;
    expect(job?.progress).toBe(50);
    expect(job?.message).toBe("拆分中");
    useStoryboardStore
      .getState()
      .setAnalysisProgress({ status: "succeeded", progress: 100, finishedAt: Date.now() });
    expect(useStoryboardStore.getState().analysisJob?.status).toBe("succeeded");
  });

  it("createEmptyShot produces a manual shot with correct fields", () => {
    const shot = createEmptyShot(4);
    expect(shot.order).toBe(4);
    expect(shot.shotNumber).toBe("5");
    expect(shot.origin).toBe("manual");
    expect(shot.reviewStatus).toBe("pending");
    expect(shot.references).toEqual({ characters: [], costumes: [], scenes: [] });
  });

  it("toggles multiple shot selections for sending to blueprint", () => {
    useStoryboardStore.getState().initDocument({ title: "t" });
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    useStoryboardStore.getState().addShot();
    const ids = useStoryboardStore.getState().document!.shots.map((s) => s.id);

    expect(useStoryboardStore.getState().selectedShotIds).toEqual([]);

    useStoryboardStore.getState().toggleShotSelection(ids[0]);
    useStoryboardStore.getState().toggleShotSelection(ids[1]);
    expect(useStoryboardStore.getState().selectedShotIds).toEqual([ids[0], ids[1]]);

    // 再次点击取消
    useStoryboardStore.getState().toggleShotSelection(ids[0]);
    expect(useStoryboardStore.getState().selectedShotIds).toEqual([ids[1]]);

    useStoryboardStore.getState().setSelectedShots([ids[0], ids[1], ids[2]]);
    expect(useStoryboardStore.getState().selectedShotIds).toHaveLength(3);

    useStoryboardStore.getState().clearShotSelection();
    expect(useStoryboardStore.getState().selectedShotIds).toEqual([]);
  });

  it("loadFromWorkspace 打开已保存文档：无旧文档时不产生版本快照", async () => {
    mockLoadFromWorkspace.mockResolvedValue({
      id: "loaded-1",
      projectId: projectA,
      title: "工作区文档",
      sourceScriptPath: "script.md",
      version: 1,
      status: "review",
      shots: [],
      createdAt: 1,
      updatedAt: 2,
    });
    const loaded = await useStoryboardStore.getState().loadFromWorkspace();
    expect(loaded?.title).toBe("工作区文档");
    const doc = useStoryboardStore.getState().document!;
    expect(doc.id).toBe("loaded-1");
    expect(useStoryboardStore.getState().versions).toHaveLength(0);
    expect(useStoryboardStore.getState().dirty).toBe(true);
  });

  it("loadFromWorkspace 有旧分镜时自动快照（覆盖前可恢复）", async () => {
    // 先建立旧文档 + 一个镜头
    useStoryboardStore.getState().initDocument({ title: "旧分镜" });
    useStoryboardStore.getState().addShot();
    const oldId = useStoryboardStore.getState().document!.id;

    mockLoadFromWorkspace.mockResolvedValue({
      id: "loaded-2",
      projectId: projectA,
      title: "新文档",
      sourceScriptPath: "script.md",
      version: 2,
      status: "review",
      shots: [],
      createdAt: 1,
      updatedAt: 2,
    } as StoryboardDocument);
    const loaded = await useStoryboardStore.getState().loadFromWorkspace();
    expect(loaded?.id).toBe("loaded-2");
    // 旧文档被版本快照记录（1 个版本）
    expect(useStoryboardStore.getState().versions).toHaveLength(1);
    expect(useStoryboardStore.getState().versions[0].document.id).toBe(oldId);
    expect(useStoryboardStore.getState().versions[0].reason).toBe("打开工作区分镜前快照");
    // 当前文档已被覆盖
    expect(useStoryboardStore.getState().document!.id).toBe("loaded-2");
  });

  it("loadFromWorkspace 返回 null（无文件）时不改变当前文档", async () => {
    useStoryboardStore.getState().initDocument({ title: "保留我" });
    mockLoadFromWorkspace.mockResolvedValue(null);
    const loaded = await useStoryboardStore.getState().loadFromWorkspace();
    expect(loaded).toBeNull();
    expect(useStoryboardStore.getState().document!.title).toBe("保留我");
    expect(useStoryboardStore.getState().versions).toHaveLength(0);
  });
});