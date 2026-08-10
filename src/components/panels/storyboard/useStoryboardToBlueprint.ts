// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";
/**
 * useStoryboardToBlueprint — 把勾选的分镜镜头组合成文本并发送到蓝图
 *
 * 在蓝图中心附近创建一个 text-input 文本节点，内容按指定格式组合：
 *   角色1<洛蓝>
 *   角色2<翼兽>
 *   场景：…
 *   **镜头1：** …
 *
 * 不单独映射服装或其他参考项，仅映射镜头文本内容。
 */
import { useCallback } from "react";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useBlueprintStore } from "@/stores/blueprint-store";
import { useMediaPanelStore } from "@/stores/media-panel-store";
import { composeStoryboardToBlueprint } from "@/lib/blueprint/storyboard-to-blueprint";
import { toast } from "sonner";

export function useStoryboardToBlueprint() {
  const document = useStoryboardStore((s) => s.document);
  const selectedShotIds = useStoryboardStore((s) => s.selectedShotIds);
  const clearShotSelection = useStoryboardStore((s) => s.clearShotSelection);
  const ensureBlueprint = useBlueprintStore((s) => s.createBlueprint);
  const addNodeInCenter = useBlueprintStore((s) => s.addNodeInCenter);
  const setActiveTab = useMediaPanelStore((s) => s.setActiveTab);

  const sendToBlueprint = useCallback(() => {
    const doc = document;
    if (!doc) {
      toast.warning("没有分镜文档");
      return;
    }
    if (selectedShotIds.length === 0) {
      toast.warning("请先勾选要发送到蓝图的分镜镜头");
      return;
    }

    // 按勾选顺序取镜头
    const shots = doc.shots.filter((s) => selectedShotIds.includes(s.id));
    if (shots.length === 0) {
      toast.warning("勾选的镜头不存在");
      return;
    }

    const { node } = composeStoryboardToBlueprint({
      shots,
      sourceRef: {
        kind: "shot",
        id: shots.map((s) => s.id).join(","),
        sourceVersion: `v${doc.version}`,
      },
    });

    // 确保有一个活动蓝图（若没有则创建一个）
    const blueprintStore = useBlueprintStore.getState();
    let activeId = blueprintStore.activeBlueprintId;
    if (!activeId) {
      try {
        const bp = ensureBlueprint(`分镜 ${doc.title || "未命名"}`);
        activeId = bp.id;
      } catch {
        toast.error("创建蓝图失败，请先选择项目");
        return;
      }
    }

    addNodeInCenter(node);
    setActiveTab("blueprint");
    clearShotSelection();
    toast.success(`已发送 ${shots.length} 个镜头到蓝图`);
  }, [document, selectedShotIds, ensureBlueprint, addNodeInCenter, setActiveTab, clearShotSelection]);

  return { sendToBlueprint, selectedCount: selectedShotIds.length };
}