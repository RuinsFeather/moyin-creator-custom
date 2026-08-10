// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
import { describe, expect, it } from "vitest";
import { composeStoryboardToBlueprint } from "../storyboard-to-blueprint";
import type { StoryboardShot } from "@/types/storyboard";

function makeShot(overrides: Partial<StoryboardShot> = {}): StoryboardShot {
  return {
    id: `shot-${Math.random().toString(36).slice(2, 8)}`,
    order: 0,
    shotNumber: "1",
    content: {
      summary: "",
      scene: "",
      action: "",
      dialogue: "",
      shotSize: "",
      cameraMovement: "",
    },
    references: { characters: [], costumes: [], scenes: [] },
    notes: "",
    referenceImages: [],
    origin: "manual",
    reviewStatus: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("composeStoryboardToBlueprint", () => {
  it("composes characters, scene and shot blocks in the expected format", () => {
    const shot1 = makeShot({
      id: "s1",
      order: 0,
      shotNumber: "1",
      content: {
        summary: "林夏进入咖啡馆并观察室内。",
        scene: "咖啡馆",
        action: "林夏推门进入，停步扫视室内。",
        dialogue: "你好。",
        shotSize: "中景",
        cameraMovement: "跟拍",
      },
      references: {
        characters: [{ id: "c1", name: "洛蓝", source: "library" }],
        scenes: [{ id: "sc1", name: "咖啡馆", source: "library" }],
        costumes: [],
      },
    });
    const shot2 = makeShot({
      id: "s2",
      order: 1,
      shotNumber: "2",
      content: {
        summary: "翼兽收翅落地。",
        scene: "咖啡馆",
        action: "翼兽收拢双翅压低身形。",
        dialogue: "",
        shotSize: "全景",
        cameraMovement: "固定机位",
      },
      references: {
        characters: [
          { id: "c1", name: "洛蓝", source: "library" },
          { id: "c2", name: "翼兽", source: "library" },
        ],
        scenes: [{ id: "sc1", name: "咖啡馆", source: "library" }],
        costumes: [],
      },
    });

    const result = composeStoryboardToBlueprint({ shots: [shot1, shot2] });

    // 角色行
    expect(result.text).toContain("角色1<洛蓝>");
    expect(result.text).toContain("角色2<翼兽>");
    // 场景行
    expect(result.text).toContain("场景：咖啡馆");
    // 镜头块
    expect(result.text).toContain("**镜头1：**");
    expect(result.text).toContain("**镜头2：**");
    // 节点类型
    expect(result.node.type).toBe("text-input");
    expect(result.node.data.nodeType).toBe("text-input");
    expect((result.node.data.config as { text: string }).text).toBe(result.text);
    // 来源追踪
    expect(result.shotIds).toEqual(["s1", "s2"]);
  });

  it("orders shots by their order field regardless of input order", () => {
    const shotA = makeShot({ id: "a", order: 1, shotNumber: "2", content: { ...makeShot().content, action: "第二镜" } });
    const shotB = makeShot({ id: "b", order: 0, shotNumber: "1", content: { ...makeShot().content, action: "第一镜" } });
    const result = composeStoryboardToBlueprint({ shots: [shotA, shotB] });
    expect(result.shotIds).toEqual(["b", "a"]);
    expect(result.text.indexOf("**镜头1：** 第一镜")).toBeGreaterThan(-1);
    expect(result.text.indexOf("**镜头2：** 第二镜")).toBeGreaterThan(-1);
  });

  it("deduplicates characters and scenes", () => {
    const shot1 = makeShot({
      content: { ...makeShot().content, scene: "咖啡馆" },
      references: {
        characters: [{ id: "c1", name: "洛蓝", source: "library" }],
        scenes: [{ id: "sc1", name: "咖啡馆", source: "library" }],
        costumes: [],
      },
    });
    const shot2 = makeShot({
      content: { ...makeShot().content, scene: "咖啡馆" },
      references: {
        characters: [{ id: "c1", name: "洛蓝", source: "library" }],
        scenes: [{ id: "sc1", name: "咖啡馆", source: "library" }],
        costumes: [],
      },
    });
    const result = composeStoryboardToBlueprint({ shots: [shot1, shot2] });
    expect(result.text.match(/角色1<洛蓝>/g)).toHaveLength(1);
    // 场景名只出现在场景标题行一次（镜头块不重复场景）
    expect((result.text.match(/咖啡馆/g) || []).length).toBe(1);
  });
});