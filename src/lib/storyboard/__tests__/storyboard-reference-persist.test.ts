// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * §14 风险：参考图失效 → 上传的 Base64 参考图固化到工作区
 *
 * persistReferenceImagesToWorkspace 覆盖：
 *   - data URL 图片以二进制写入工作区 reference/，引用替换为 stable workspace-image://
 *   - 已稳定引用跳过（不重复写入）
 *   - 无工作区 FS / 无根目录时返回原文档不抛错
 *   - 非 upload 类型图片保持原样
 *   - dataUrlExt 按 MIME 推断扩展名
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dataUrlExt,
  isStableReferenceUrl,
  persistReferenceImagesToWorkspace,
  STORYBOARD_REFS_DIR,
  WORKSPACE_IMAGE_PREFIX,
  workspaceImagePath,
} from "../storyboard-file-service";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import type { StoryboardDocument, StoryboardReferenceImage } from "@/types/storyboard";

const mockWriteFile = vi.fn();
const mockWriteImage = vi.fn();
const mockCreateDirectory = vi.fn();
vi.mock("@/lib/script-workspace-fs", () => ({
  getScriptWorkspaceFs: vi.fn(() => ({
    writeFile: mockWriteFile,
    writeImage: mockWriteImage,
    createDirectory: mockCreateDirectory,
  })),
}));
const mockedGetFs = vi.mocked(getScriptWorkspaceFs);

beforeEach(() => {
  vi.clearAllMocks();
  useScriptWorkspaceStore.getState().setWorkspaceRoot("/work");
  mockedGetFs.mockReturnValue({
    writeFile: mockWriteFile,
    writeImage: mockWriteImage,
    createDirectory: mockCreateDirectory,
  } as any);
});

function makeImage(partial: Partial<StoryboardReferenceImage>): StoryboardReferenceImage {
  return {
    id: "img-1",
    sourceType: "upload",
    localUrl: "data:image/png;base64,iVBORw0KGgo=",
    thumbnailUrl: "data:image/png;base64,iVBORw0KGgo=",
    ...partial,
  };
}

function makeDoc(images: StoryboardReferenceImage[]): StoryboardDocument {
  return {
    id: "doc-1",
    projectId: "p-1",
    title: "测试",
    sourceScriptPath: "script.md",
    sourceScriptContentHash: "abc12345",
    version: 1,
    status: "draft",
    shots: images.map((img, i) => ({
      id: `shot-${i + 1}`,
      order: i,
      shotNumber: String(i + 1),
      content: {
        summary: "s",
        scene: "室内",
        action: "走",
        dialogue: "",
        shotSize: "中景",
        cameraMovement: "固定",
        durationSeconds: 3,
        additionalDescription: "",
      },
      references: { characters: [], costumes: [], scenes: [] },
      notes: "",
      referenceImages: [img],
      origin: "manual",
      reviewStatus: "pending",
      createdAt: 1,
      updatedAt: 2,
    })),
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("dataUrlExt / isStableReferenceUrl", () => {
  it("按 MIME 推断扩展名，未知默认 png", () => {
    expect(dataUrlExt("data:image/png;base64,x")).toBe(".png");
    expect(dataUrlExt("data:image/jpeg;base64,x")).toBe(".jpg");
    expect(dataUrlExt("data:image/jpg;base64,x")).toBe(".jpg");
    expect(dataUrlExt("data:image/webp;base64,x")).toBe(".webp");
    expect(dataUrlExt("data:image/gif;base64,x")).toBe(".gif");
    expect(dataUrlExt("data:text/plain;base64,x")).toBe(".png");
  });

  it("data: URL 视为不稳定，workspace-image:// 视为稳定", () => {
    expect(isStableReferenceUrl("data:image/png;base64,x")).toBe(false);
    expect(isStableReferenceUrl(undefined)).toBe(false);
    expect(isStableReferenceUrl("workspace-image://reference/a-b.png")).toBe(true);
    expect(isStableReferenceUrl("asset://abc")).toBe(true);
  });

  it("workspaceImagePath 解析 workspace-image:// 引用，其他前缀返回 null", () => {
    expect(workspaceImagePath("workspace-image://reference/shot-1-img.png")).toBe("reference/shot-1-img.png");
    expect(workspaceImagePath("data:image/png;base64,x")).toBeNull();
    expect(workspaceImagePath("local-image://reference/a.png")).toBeNull();
    expect(workspaceImagePath(undefined)).toBeNull();
    expect(workspaceImagePath("workspace-image://")).toBeNull();
  });
});

describe("persistReferenceImagesToWorkspace", () => {
  it("将 upload 的 Base64 图片以二进制写入工作区并替换为 workspace-image:// 稳定引用", async () => {
    const doc = makeDoc([
      makeImage({ id: "img-a", localUrl: "data:image/png;base64,AAAA", thumbnailUrl: "data:image/png;base64,AAAA" }),
    ]);
    const result = await persistReferenceImagesToWorkspace(doc);

    // 二进制写入 reference/ 目录（不调用文本 writeFile）
    expect(mockWriteImage).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
    const [root, relPath, base64] = mockWriteImage.mock.calls[0];
    expect(root).toBe("/work");
    expect(relPath.startsWith(`${STORYBOARD_REFS_DIR}/`)).toBe(true);
    expect(base64).toBe("AAAA");

    // 返回新文档（不修改入参），引用已替换为稳定 URL
    expect(result).not.toBe(doc);
    expect(doc.shots[0].referenceImages[0].localUrl).toBe("data:image/png;base64,AAAA"); // 原文档不变
    const img = result.shots[0].referenceImages[0];
    expect(img.localUrl).toBe(`${WORKSPACE_IMAGE_PREFIX}${STORYBOARD_REFS_DIR}/shot-1-img-a.png`);
    expect(img.thumbnailUrl).toBe(`${WORKSPACE_IMAGE_PREFIX}${STORYBOARD_REFS_DIR}/shot-1-img-a.png`);
    // 引用可反解析为工作区相对路径
    expect(workspaceImagePath(img.localUrl)).toBe(`${STORYBOARD_REFS_DIR}/shot-1-img-a.png`);
  });

  it("已是稳定引用的图片跳过（不写文件）", async () => {
    const doc = makeDoc([
      makeImage({ id: "img-a", localUrl: "workspace-image://reference/a.png", thumbnailUrl: "workspace-image://reference/a.png" }),
      makeImage({ id: "img-b", sourceType: "asset", assetId: "asset-1" }),
    ]);
    const result = await persistReferenceImagesToWorkspace(doc);
    expect(mockWriteImage).not.toHaveBeenCalled();
    expect(mockCreateDirectory).not.toHaveBeenCalled();
    expect(result).toBe(doc); // 无待固化图片 → 返回原文档
  });

  it("无工作区 FS 时返回原文档不抛错", async () => {
    mockedGetFs.mockReturnValue(null as any);
    const doc = makeDoc([makeImage({})]);
    const result = await persistReferenceImagesToWorkspace(doc);
    expect(result).toBe(doc);
    expect(mockWriteImage).not.toHaveBeenCalled();
  });

  it("未选择工作区根目录时返回原文档不抛错", async () => {
    useScriptWorkspaceStore.getState().setWorkspaceRoot(null);
    const doc = makeDoc([makeImage({})]);
    const result = await persistReferenceImagesToWorkspace(doc);
    expect(result).toBe(doc);
    expect(mockWriteImage).not.toHaveBeenCalled();
  });

  it("单个图片写入失败不阻塞整个保存（其他图片仍写入）", async () => {
    mockWriteImage.mockRejectedValueOnce(new Error("disk full"));
    const doc = makeDoc([
      makeImage({ id: "img-1", localUrl: "data:image/png;base64,AAA" }),
      makeImage({ id: "img-2", localUrl: "data:image/webp;base64,BBB" }),
    ]);
    const result = await persistReferenceImagesToWorkspace(doc);

    // 第二次写入成功
    expect(mockWriteImage).toHaveBeenCalledTimes(2);
    const [, relPath2] = mockWriteImage.mock.calls[1];
    expect(relPath2).toBe(`${STORYBOARD_REFS_DIR}/shot-2-img-2.webp`);
    // 失败的图片保持 data URL，成功的替换
    expect(result.shots[0].referenceImages[0].localUrl).toBe("data:image/png;base64,AAA");
    expect(result.shots[1].referenceImages[0].localUrl).toBe(`${WORKSPACE_IMAGE_PREFIX}${STORYBOARD_REFS_DIR}/shot-2-img-2.webp`);
  });

  it("writeImage 不可用（旧 preload 兼容）时退回文本写入并替换引用", async () => {
    mockedGetFs.mockReturnValue({
      writeFile: mockWriteFile,
      createDirectory: mockCreateDirectory,
    } as any);
    const doc = makeDoc([makeImage({ id: "img-1", localUrl: "data:image/png;base64,AAA" })]);
    const result = await persistReferenceImagesToWorkspace(doc);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockCreateDirectory).toHaveBeenCalledWith("/work", STORYBOARD_REFS_DIR);
    expect(result.shots[0].referenceImages[0].localUrl).toContain(WORKSPACE_IMAGE_PREFIX);
  });
});