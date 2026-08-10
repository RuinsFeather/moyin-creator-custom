// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard → Blueprint 转换（勾选分镜发送到蓝图）
 *
 * 把勾选的若干分镜镜头组合成一段结构化文本，在蓝图中心创建一个
 * `text-input` 节点。文本按以下格式书写：
 *
 *   角色1<洛蓝>
 *   角色2<翼兽>
 *   场景
 *   **镜头1：** 跟拍。高空中，<洛蓝> 骑在 <翼兽> 背部…
 *
 *   不需要单独映射服装或其他参考项，只把镜头文本内容映射过来。
 */
import { generateUUID } from "@/lib/utils";
import type { BlueprintNode, BlueprintSourceRef } from "@/types/blueprint";
import type { StoryboardShot } from "@/types/storyboard";

export interface StoryboardToBlueprintInput {
  shots: StoryboardShot[];
  /** 蓝图来源引用（保留分镜 ID 作为来源追踪） */
  sourceRef?: BlueprintSourceRef;
}

export interface StoryboardToBlueprintResult {
  text: string;
  node: BlueprintNode;
  /** 参与组合的镜头 id（按顺序） */
  shotIds: string[];
}

/** 收集镜头中出现的角色名（去重、保序） */
function collectCharacters(shots: StoryboardShot[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const shot of shots) {
    for (const ref of shot.references.characters) {
      if (!seen.has(ref.name)) {
        seen.add(ref.name);
        names.push(ref.name);
      }
    }
  }
  return names;
}

/** 收集镜头中出现的场景名（去重、保序） */
function collectScenes(shots: StoryboardShot[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const shot of shots) {
    const name = shot.content.scene?.trim();
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

/** 把单个镜头内容映射为 "镜头N：…" 的文本段落 */
function formatShotBlock(shot: StoryboardShot, index: number): string {
  const c = shot.content;
  const parts: string[] = [];

  // 镜头运动 / 景别 作为开头
  const lead = [c.cameraMovement, c.shotSize].filter((s) => s && s.trim()).join("，");
  if (lead.trim()) parts.push(`${lead}。`);

  // 动作 / 摘要
  const narrative = [c.action, c.summary, c.additionalDescription]
    .map((s) => s?.trim())
    .filter(Boolean);
  if (narrative.length) parts.push(narrative.join("。"));

  // 对白
  if (c.dialogue && c.dialogue.trim()) {
    parts.push(`对白：{${c.dialogue.trim()}}`);
  }

  const body = parts.join("").replace(/。。/g, "。");
  return `**镜头${index + 1}：** ${body || "…"}`;
}

/**
 * 组合选中镜头为蓝图文本节点。
 * 返回完整文本与可按需插入蓝图的节点对象。
 */
export function composeStoryboardToBlueprint(
  input: StoryboardToBlueprintInput,
): StoryboardToBlueprintResult {
  const { shots, sourceRef } = input;
  const ordered = [...shots].sort((a, b) => a.order - b.order);

  const characters = collectCharacters(ordered);
  const scenes = collectScenes(ordered);

  const lines: string[] = [];
  characters.forEach((name, i) => lines.push(`角色${i + 1}<${name}>`));
  // 场景作为标题行，接场景名（如有）
  lines.push(scenes.length ? `场景：${scenes.join("、")}` : "场景");
  ordered.forEach((shot, i) => lines.push(formatShotBlock(shot, i)));

  const text = lines.join("\n");

  const node: BlueprintNode = {
    id: generateUUID(),
    type: "text-input",
    position: { x: 0, y: 0 }, // 由 store 中心放置
    data: {
      nodeType: "text-input",
      label: `分镜 ${ordered.length} 镜`,
      config: { text },
      sourceRef,
    },
  };

  return {
    text,
    node,
    shotIds: ordered.map((s) => s.id),
  };
}