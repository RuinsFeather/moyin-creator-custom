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
  STORYBOARD_JSON_SCHEMA,
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

describe("storyboard-response-parser 字段标准化（§12）", () => {
  it("durationSeconds 字符串转为数字，additionalDescription 保留", () => {
    const text = JSON.stringify([
      {
        content: {
          summary: "进入",
          scene: "室内",
          action: "走",
          dialogue: "",
          shotSize: "中景",
          cameraMovement: "固定",
          durationSeconds: "3.5",
          additionalDescription: "光线昏暗",
        },
      },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    const content = result.shots[0].content;
    expect(content.durationSeconds).toBe(3.5);
    expect(content.additionalDescription).toBe("光线昏暗");
  });

  it("数字字段（summary/action 等）转为字符串", () => {
    const text = JSON.stringify([
      { content: { summary: 42, scene: 1, action: 7, dialogue: 0, shotSize: "中景", cameraMovement: "固定" } },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    const content = result.shots[0].content;
    expect(content.summary).toBe("42");
    expect(content.scene).toBe("1");
    expect(content.action).toBe("7");
  });

  it("references 嵌套在 content 下也可解析", () => {
    const text = JSON.stringify([
      {
        content: {
          summary: "进入",
          scene: "室内",
          action: "走",
          dialogue: "",
          shotSize: "中景",
          cameraMovement: "固定",
          references: { characters: ["林夏"], scenes: ["咖啡馆"] },
        },
      },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    expect(result.shots[0].references?.characters).toEqual(["林夏"]);
    expect(result.shots[0].references?.scenes).toEqual(["咖啡馆"]);
  });

  it("无 references 时该字段为 undefined", () => {
    const text = JSON.stringify([
      { content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" } },
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.shots[0].references).toBeUndefined();
  });

  it("非法项（非对象）被跳过", () => {
    const text = JSON.stringify([
      { content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" } },
      "bad",
      null,
      42,
    ]);
    const result = parseStoryboardResponse(text);
    expect(result.ok).toBe(true);
    expect(result.shots).toHaveLength(1);
  });
});

describe("storyboard-validator（§12 非法字段与空镜头拒绝）", () => {
  it("拒绝 集/场 层级字段", () => {
    const r = validateShotBatch([
      { content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" }, sourceEpisodeId: "ep-1" },
    ]);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes("sourceEpisodeId"))).toBe(true);
  });

  it("拒绝首尾帧/提示词/视频字段", () => {
    const r = validateShotBatch([
      {
        content: { summary: "a", scene: "s", action: "x", dialogue: "", shotSize: "中景", cameraMovement: "固定" },
        imagePrompt: "x",
        videoUrl: "https://x/v.mp4",
      },
    ]);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes("imagePrompt"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("videoUrl"))).toBe(true);
  });

  it("拒绝缺少 content 对象的镜头", () => {
    const r = validateShotBatch([{ summary: "缺 content" }]);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.message.includes("content"))).toBe(true);
  });

  it("严格 JSON Schema 描述镜头数组结构", () => {
    expect(STORYBOARD_JSON_SCHEMA.type).toBe("array");
    expect(STORYBOARD_JSON_SCHEMA.items.properties.content.required).toContain("summary");
    // 不包含任何禁止字段（集/场/提示词）
    const props = Object.keys(STORYBOARD_JSON_SCHEMA.items.properties);
    expect(props).not.toContain("imagePrompt");
    expect(props).not.toContain("sourceEpisodeId");
  });
});