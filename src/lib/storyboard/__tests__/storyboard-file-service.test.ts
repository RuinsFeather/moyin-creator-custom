// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import {
  hashScriptContent,
  pickImportableScripts,
  resolveImportStrategy,
} from "../script-importer";
import { renderStoryboardMarkdown } from "../storyboard-file-service";
import type { StoryboardDocument } from "@/types/storyboard";

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