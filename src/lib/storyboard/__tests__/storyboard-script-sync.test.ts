// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  applyScriptUpdate,
  detectScriptChange,
  ignoreScriptChange,
  snapshotBeforeOverwrite,
} from "../storyboard-script-sync";
import { hashScriptContent } from "../script-importer";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import type { StoryboardDocument } from "@/types/storyboard";

const FIXED_CONTENT = "林夏推门进入咖啡馆。";
const OTHER_CONTENT = "林夏推门离开咖啡馆。";

// 模拟工作区 FS 桥
const mockReadFile = vi.fn();
vi.mock("@/lib/script-workspace-fs", () => ({
  getScriptWorkspaceFs: vi.fn(() => ({ readFile: mockReadFile })),
}));
const mockedGetFs = vi.mocked(getScriptWorkspaceFs);

function seedDocument(): StoryboardDocument {
  const store = useStoryboardStore.getState();
  store.clearDocument();
  store.initDocument({
    title: "单集剧本分镜",
    sourceScriptPath: "scenes/ep1/剧本.md",
    sourceScriptContentHash: hashScriptContent(FIXED_CONTENT),
  });
  return useStoryboardStore.getState().document!;
}

beforeEach(() => {
  vi.clearAllMocks();
  useStoryboardStore.getState().clearDocument();
  useScriptWorkspaceStore.getState().setWorkspaceRoot(null);
  // 默认：无工作区桥 → 返回 null
  mockedGetFs.mockReturnValue(null as any);
});

describe("detectScriptChange", () => {
  it("returns new when no document or no source script path", async () => {
    const res = await detectScriptChange();
    expect(res.kind).toBe("new");
  });

  it("returns unchanged when workspace fs unavailable", async () => {
    seedDocument();
    const res = await detectScriptChange();
    expect(res.kind).toBe("unchanged");
  });

  it("returns changed when content hash differs", async () => {
    seedDocument();
    useScriptWorkspaceStore.getState().setWorkspaceRoot("/work");
    mockedGetFs.mockReturnValue({ readFile: mockReadFile } as any);
    mockReadFile.mockResolvedValue(OTHER_CONTENT);
    const res = await detectScriptChange();
    expect(res.kind).toBe("changed");
    expect(res.currentHash).toBe(hashScriptContent(OTHER_CONTENT));
    expect(res.storedHash).toBe(hashScriptContent(FIXED_CONTENT));
  });

  it("returns unchanged when content hash matches", async () => {
    seedDocument();
    useScriptWorkspaceStore.getState().setWorkspaceRoot("/work");
    mockedGetFs.mockReturnValue({ readFile: mockReadFile } as any);
    mockReadFile.mockResolvedValue(FIXED_CONTENT);
    const res = await detectScriptChange();
    expect(res.kind).toBe("unchanged");
  });

  it("returns missing when readFile throws", async () => {
    seedDocument();
    useScriptWorkspaceStore.getState().setWorkspaceRoot("/work");
    mockedGetFs.mockReturnValue({ readFile: mockReadFile } as any);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const res = await detectScriptChange();
    expect(res.kind).toBe("missing");
  });
});

describe("applyScriptUpdate", () => {
  it("updates hash and revision without touching shots", () => {
    const doc = seedDocument();
    useStoryboardStore.getState().addShot();
    const shotsBefore = useStoryboardStore.getState().document!.shots.length;

    applyScriptUpdate(doc, hashScriptContent(OTHER_CONTENT), "rev-2");

    const after = useStoryboardStore.getState().document!;
    expect(after.sourceScriptContentHash).toBe(hashScriptContent(OTHER_CONTENT));
    expect(after.sourceScriptRevision).toBe("rev-2");
    expect(after.shots).toHaveLength(shotsBefore);
    expect(useStoryboardStore.getState().dirty).toBe(true);
  });
});

describe("snapshotBeforeOverwrite", () => {
  it("creates a snapshot version and returns its id", () => {
    seedDocument();
    useStoryboardStore.getState().addShot();
    const shotsBefore = useStoryboardStore.getState().document!.shots.length;

    const vid = snapshotBeforeOverwrite("覆盖重拆前");

    expect(vid).toBeTruthy();
    const versions = useStoryboardStore.getState().versions;
    expect(versions).toHaveLength(1);
    expect(versions[0].id).toBe(vid);
    expect(versions[0].reason).toBe("覆盖重拆前");
    expect(versions[0].document.shots).toHaveLength(shotsBefore);
    // 版本号 +1
    expect(useStoryboardStore.getState().document!.version).toBe(2);
  });

  it("returns null when no document", () => {
    useStoryboardStore.getState().clearDocument();
    expect(snapshotBeforeOverwrite("x")).toBeNull();
  });
});

describe("ignoreScriptChange", () => {
  it("returns the current document unchanged", () => {
    const doc = seedDocument();
    const res = ignoreScriptChange();
    expect(res?.id).toBe(doc.id);
  });
});