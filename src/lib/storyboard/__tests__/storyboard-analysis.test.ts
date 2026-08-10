// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import {
  extractJsonArray,
  parseStoryboardResponse,
} from "../storyboard-response-parser";
import {
  validateShotBatch,
  validateShotContent,
} from "../storyboard-validator";

describe("storyboard-response-parser", () => {
  it("extracts a plain JSON array", () => {
    const text = '[{"content":{"summary":"进入"}}]';
    expect(extractJsonArray(text)).toBe(text);
  });

  it("extracts JSON array from fenced code block", () => {
    const text = "```json\n[{\"content\":{\"summary\":\"进入\"}}]\n```";
    expect(extractJsonArray(text)).toBe('[{"content":{"summary":"进入"}}]');
  });

  it("extracts JSON array with surrounding prose", () => {
    const text = "以下是拆镜结果：\n[{\"content\":{\"summary\":\"进入\"}}]\n请查收";
    expect(extractJsonArray(text)).toBe('[{"content":{"summary":"进入"}}]');
  });

  it("returns null when no array present", () => {
    expect(extractJsonArray("没有数组")).toBeNull();
  });

  it("parses shots with content and references", () => {
    const text = JSON.stringify([
      {
        content: {
          summary: "林夏进入咖啡馆",
          scene: "日间咖啡馆",
          action: "推门进入",
          dialogue: "你好",
          shotSize: "中景",
          cameraMovement: "移",
          durationSeconds: 3,
        },
        references: { characters: ["林夏"], scenes: ["咖啡馆"] },
        sourceText: "林夏推门进入",
      },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    expect(result.shots).toHaveLength(1);
    expect(result.shots[0].content.summary).toBe("林夏进入咖啡馆");
    expect(result.shots[0].references?.characters).toEqual(["林夏"]);
    expect(result.shots[0].sourceText).toBe("林夏推门进入");
  });

  it("handles flat content (no nested content object)", () => {
    const text = JSON.stringify([
      { summary: "进入", scene: "室内", action: "走", shotSize: "近景", cameraMovement: "固定" },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    expect(result.shots[0].content.summary).toBe("进入");
  });

  it("returns error for invalid JSON", () => {
    const result = parseStoryboardResponse("not json");
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe("storyboard-validator", () => {
  it("accepts a valid shot content", () => {
    const r = validateShotContent(
      { summary: "进入", scene: "室内", action: "走", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
      0,
    );
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("rejects shot with empty summary and action", () => {
    const r = validateShotContent(
      { summary: "", scene: "室内", action: "", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
      0,
    );
    expect(r.valid).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("accepts a valid batch", () => {
    const r = validateShotBatch([
      { content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" } },
    ]);
    expect(r.valid).toBe(true);
    expect(r.shotCount).toBe(1);
  });

  it("rejects a batch containing forbidden fields", () => {
    const r = validateShotBatch([
      { content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" }, imagePrompt: "xxx" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes("imagePrompt"))).toBe(true);
  });

  it("rejects non-array input", () => {
    const r = validateShotBatch({ not: "array" });
    expect(r.valid).toBe(false);
    expect(r.error).toBeTruthy();
  });
});