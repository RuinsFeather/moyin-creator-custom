// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  hashScriptContent,
  pickImportableScripts,
  resolveImportStrategy,
} from "../script-importer";
import {
  renderStoryboardMarkdown,
  saveStoryboardToWorkspace,
  loadStoryboardFromWorkspace,
  normalizeStoryboardDocument,
  STORYBOARD_JSON_FILE,
  STORYBOARD_MD_FILE,
} from "../storyboard-file-service";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import type { StoryboardDocument } from "@/types/storyboard";

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
vi.mock("@/lib/script-workspace-fs", () => ({
  getScriptWorkspaceFs: vi.fn(() => ({ writeFile: mockWriteFile, readFile: mockReadFile })),
}));
const mockedGetFs = vi.mocked(getScriptWorkspaceFs);

beforeEach(() => {
  vi.clearAllMocks();
  useScriptWorkspaceStore.getState().setWorkspaceRoot("/work");
  mockedGetFs.mockReturnValue({ writeFile: mockWriteFile, readFile: mockReadFile } as any);
});

describe("script-importer", () => {
  it("produces a stable hash for identical content", () => {
    const a = hashScriptContent("林夏推门进入咖啡馆。");
    const b = hashScriptContent("林夏推门进入咖啡馆。");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("produces different hashes for different content", () => {
    const a = hashScriptContent("林夏推门进入。");
    const b = hashScriptContent("林夏推门离开。");
    expect(a).not.toBe(b);
  });

  it("picks markdown and script files with content", () => {
    const files = [
      { path: "a.md", name: "a.md", content: "有内容", type: "markdown" },
      { path: "b.txt", name: "b.txt", content: "不是剧本", type: "other" },
      { path: "c.md", name: "c.md", content: "   ", type: "markdown" },
      { path: "d.script.md", name: "d.script.md", content: "剧本", type: "script" },
    ];
    const picked = pickImportableScripts(files);
    expect(picked.map((f) => f.path)).toEqual(["a.md", "d.script.md"]);
  });

  it("resolves import strategy first-import when no current doc", () => {
    expect(resolveImportStrategy(undefined, undefined, "a.md", "hash1").strategy).toBe("first-import");
  });

  it("resolves update when same path and same hash", () => {
    expect(resolveImportStrategy("a.md", "hash1", "a.md", "hash1").strategy).toBe("update");
  });

  it("resolves overwrite when same path but different hash", () => {
    expect(resolveImportStrategy("a.md", "hash1", "a.md", "hash2").strategy).toBe("overwrite");
  });

  it("resolves create-version when different path", () => {
    expect(resolveImportStrategy("a.md", "hash1", "b.md", "hash2").strategy).toBe("create-version");
  });
});

describe("storyboard-file-service (pure)", () => {
  it("renders a markdown table from a document", () => {
    const doc: StoryboardDocument = {
      id: "doc-1",
      projectId: "p-1",
      title: "咖啡馆初遇",
      sourceScriptPath: "script.md",
      sourceScriptContentHash: "abc12345",
      version: 2,
      status: "review",
      shots: [
        {
          id: "shot-1",
          order: 0,
          shotNumber: "1",
          content: {
            summary: "林夏进入咖啡馆",
            scene: "日间咖啡馆",
            action: "推门进入",
            dialogue: "你好",
            shotSize: "中景",
            durationSeconds: 3,
            cameraMovement: "跟随",
          },
          references: { characters: [], costumes: [], scenes: [] },
          notes: "注意视线连续",
          referenceImages: [],
          origin: "ai",
          reviewStatus: "confirmed",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    const md = renderStoryboardMarkdown(doc);
    expect(md).toContain("# 咖啡馆初遇");
    expect(md).toContain("v2");
    expect(md).toContain("| 1 | 林夏进入咖啡馆 |");
    expect(md).toContain("注意视线连续");
  });
});

describe("storyboard-file-service (workspace 写入)", () => {
  const doc: StoryboardDocument = {
    id: "doc-1",
    projectId: "p-1",
    title: "咖啡馆初遇",
    sourceScriptPath: "script.md",
    sourceScriptContentHash: "abc12345",
    version: 2,
    status: "review",
    shots: [],
    createdAt: 1,
    updatedAt: 2,
  };

  it("写入 storyboard.json 并可反序列化读取", async () => {
    const result = await saveStoryboardToWorkspace(doc);
    expect(result.jsonPath).toBe(STORYBOARD_JSON_FILE);
    expect(result.mdPath).toBeUndefined();

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [root, relPath, content] = mockWriteFile.mock.calls[0];
    expect(root).toBe("/work");
    expect(relPath).toBe(STORYBOARD_JSON_FILE);

    // 反序列化后保持一致（权威结构化数据，蓝图消费）
    const parsed = JSON.parse(content) as StoryboardDocument;
    expect(parsed.id).toBe("doc-1");
    expect(parsed.title).toBe("咖啡馆初遇");
    expect(parsed.version).toBe(2);
    expect(parsed.shots).toEqual([]);
  });

  it("includeMarkdown 时同时写入 storyboard.md", async () => {
    const result = await saveStoryboardToWorkspace(doc, { includeMarkdown: true });
    expect(result.mdPath).toBe(STORYBOARD_MD_FILE);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    const mdCall = mockWriteFile.mock.calls[1];
    expect(mdCall[1]).toBe(STORYBOARD_MD_FILE);
    expect(mdCall[2]).toContain("# 咖啡馆初遇");
  });

  it("工作区 FS 不可用时抛出错误", async () => {
    mockedGetFs.mockReturnValue(null as any);
    await expect(saveStoryboardToWorkspace(doc)).rejects.toThrow();
  });

  it("未选择工作区根目录时抛出错误", async () => {
    useScriptWorkspaceStore.getState().setWorkspaceRoot(null);
    await expect(saveStoryboardToWorkspace(doc)).rejects.toThrow(/根目录/);
  });
});

describe("storyboard-file-service (工作区打开)", () => {
  const savedJson = JSON.stringify({
    id: "doc-9",
    projectId: "p-9",
    title: "工作区保存的分镜",
    sourceScriptPath: "script.md",
    sourceScriptContentHash: "hash1234",
    version: 3,
    status: "review",
    shots: [
      {
        id: "shot-1",
        order: 99,
        shotNumber: "99",
        content: {
          summary: "林夏推门",
          scene: "咖啡馆",
          action: "推门进入",
          dialogue: "你好",
          shotSize: "中景",
          cameraMovement: "推",
          durationSeconds: 3,
        },
        references: { characters: ["林夏"], costumes: [], scenes: [] },
        notes: "",
        referenceImages: [],
        origin: "ai",
        reviewStatus: "confirmed",
        createdAt: 10,
        updatedAt: 11,
      },
    ],
    createdAt: 9,
    updatedAt: 11,
  });

  it("读取并解析工作区 storyboard.json，重建镜头顺序索引", async () => {
    mockReadFile.mockResolvedValue(savedJson);
    const loaded = await loadStoryboardFromWorkspace();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("doc-9");
    expect(loaded!.title).toBe("工作区保存的分镜");
    expect(loaded!.version).toBe(3);
    // 重建顺序索引：不信任文件里的 order/shotNumber（原为 99）
    expect(loaded!.shots).toHaveLength(1);
    expect(loaded!.shots[0].order).toBe(0);
    expect(loaded!.shots[0].shotNumber).toBe("1");
    const [root, relPath] = mockReadFile.mock.calls[0];
    expect(root).toBe("/work");
    expect(relPath).toBe(STORYBOARD_JSON_FILE);
  });

  it("文件不存在时返回 null（readFile 抛错）", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    const loaded = await loadStoryboardFromWorkspace();
    expect(loaded).toBeNull();
  });

  it("JSON 解析失败时抛出错误", async () => {
    mockReadFile.mockResolvedValue("{{{ 不是 JSON");
    await expect(loadStoryboardFromWorkspace()).rejects.toThrow(/解析失败/);
  });

  it("不是合法分镜 JSON（缺 shots）时返回 null", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ id: "x", title: "不是分镜" }));
    const loaded = await loadStoryboardFromWorkspace();
    expect(loaded).toBeNull();
  });

  it("工作区 FS 不可用时抛出错误", async () => {
    mockedGetFs.mockReturnValue(null as any);
    await expect(loadStoryboardFromWorkspace()).rejects.toThrow();
  });

  it("未选择工作区根目录时抛出错误", async () => {
    useScriptWorkspaceStore.getState().setWorkspaceRoot(null);
    await expect(loadStoryboardFromWorkspace()).rejects.toThrow(/根目录/);
  });
});

describe("normalizeStoryboardDocument", () => {
  it("缺省字段补默认值，非法镜头被丢弃", () => {
    const normalized = normalizeStoryboardDocument({
      id: "d1",
      shots: [
        { id: "s1", content: { summary: "ok", action: "走", scene: "室内" }, references: null },
        { id: 42 }, // 非法镜头（content 缺失）→ 仍可归一化（content 补空）
        null, // 直接被丢弃
        "字符串", // 被丢弃
      ],
      title: "",
    });
    expect(normalized).not.toBeNull();
    expect(normalized!.title).toBe("未命名分镜");
    expect(normalized!.projectId).toBe("unknown");
    expect(normalized!.status).toBe("draft");
    expect(normalized!.shots).toHaveLength(2);
    expect(normalized!.shots.map((s) => s.shotNumber)).toEqual(["1", "2"]);
    expect(normalized!.shots[0].references.characters).toEqual([]);
    // 非法镜头 content 补空后默认
    expect(normalized!.shots[1].content.summary).toBe("");
    expect(normalized!.shots[1].origin).toBe("manual");
    expect(normalized!.shots[1].reviewStatus).toBe("pending");
    expect(normalized!.shots[1].referenceImages).toEqual([]);
  });

  it("非对象 / 缺 id / 缺 shots 返回 null", () => {
    expect(normalizeStoryboardDocument(null)).toBeNull();
    expect(normalizeStoryboardDocument("x")).toBeNull();
    expect(normalizeStoryboardDocument({ title: "无 id" })).toBeNull();
    expect(normalizeStoryboardDocument({ id: "x", shots: "不是数组" })).toBeNull();
  });

  it("origin / reviewStatus 只接受合法值", () => {
    const normalized = normalizeStoryboardDocument({
      id: "d1",
      shots: [
        { id: "s1", origin: "ai", reviewStatus: "confirmed", content: {} },
        { id: "s2", origin: "hacker", reviewStatus: "weird", content: {} },
      ],
    });
    expect(normalized!.shots[0].origin).toBe("ai");
    expect(normalized!.shots[0].reviewStatus).toBe("confirmed");
    expect(normalized!.shots[1].origin).toBe("manual");
    expect(normalized!.shots[1].reviewStatus).toBe("pending");
  });
});