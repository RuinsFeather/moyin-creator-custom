// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * StoryboardDetailPanel — 选中镜头详情
 * 编辑画面内容、参考项、备注、参考图。
 */
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { ShotContentEditor } from "./ShotContentEditor";
import { ReferenceItemsEditor } from "./ReferenceItemsEditor";
import { ReferenceImageField } from "./ReferenceImageField";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

export function StoryboardDetailPanel() {
  const document = useActiveStoryboardDocument();
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);

  const shot = document?.shots.find((s) => s.id === selectedShotId) || null;

  if (!shot) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">
        选择左侧镜头以编辑详情
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="p-3 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-medium">镜头 {shot.shotNumber}</h4>
          <Badge variant="outline" className="text-[10px]">{shot.origin}</Badge>
        </div>

        <ShotContentEditor shot={shot} />
        <ReferenceItemsEditor shot={shot} />
        <ReferenceImageField shot={shot} />
      </div>
    </ScrollArea>
  );
}