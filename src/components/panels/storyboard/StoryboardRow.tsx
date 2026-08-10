// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";
import { useStoryboardStore } from "@/stores/storyboard-store";
import type { StoryboardShot } from "@/types/storyboard";
import { TableRow, TableCell } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Copy, Trash2, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  shot: StoryboardShot;
}

export function StoryboardRow({ shot }: Props) {
  const selectedShotId = useStoryboardStore((s) => s.selectedShotId);
  const setSelectedShot = useStoryboardStore((s) => s.setSelectedShot);
  const selectedShotIds = useStoryboardStore((s) => s.selectedShotIds);
  const toggleShotSelection = useStoryboardStore((s) => s.toggleShotSelection);
  const duplicateShot = useStoryboardStore((s) => s.duplicateShot);
  const deleteShot = useStoryboardStore((s) => s.deleteShot);

  const selected = selectedShotId === shot.id;
  const checked = selectedShotIds.includes(shot.id);
  const c = shot.content;

  const refCount =
    shot.references.characters.length +
    shot.references.costumes.length +
    shot.references.scenes.length;

  return (
    <TableRow
      className={cn("cursor-pointer", selected && "bg-accent/50")}
      onClick={() => setSelectedShot(selected ? null : shot.id)}
    >
      <TableCell onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={checked} onCheckedChange={() => toggleShotSelection(shot.id)} />
      </TableCell>
      <TableCell className="font-mono text-xs">{shot.shotNumber}</TableCell>
      <TableCell>
        <div className="text-xs font-medium">{c.summary || "—"}</div>
        {c.action && <div className="text-[11px] text-muted-foreground mt-0.5">{c.action}</div>}
        {(c.shotSize || c.cameraMovement) && (
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {[c.shotSize, c.cameraMovement].filter(Boolean).join(" · ") || ""}
            {c.durationSeconds ? ` · ${c.durationSeconds}s` : ""}
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {shot.references.characters.slice(0, 2).map((r) => (
            <Badge key={r.id} variant="secondary" className="text-[10px]">角:{r.name}</Badge>
          ))}
          {shot.references.scenes.slice(0, 1).map((r) => (
            <Badge key={r.id} variant="outline" className="text-[10px]">场:{r.name}</Badge>
          ))}
          {refCount > 3 && <Badge variant="outline" className="text-[10px]">+{refCount - 3}</Badge>}
          {refCount === 0 && <span className="text-[10px] text-muted-foreground">—</span>}
        </div>
      </TableCell>
      <TableCell>
        <span className="text-[11px] text-muted-foreground line-clamp-2">{shot.notes || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-[11px] text-muted-foreground">{shot.referenceImages.length ? `${shot.referenceImages.length} 张` : "—"}</span>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" title="复制镜头" onClick={() => duplicateShot(shot.id)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" title="删除镜头" onClick={() => deleteShot(shot.id)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}