// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * StoryboardTable — 分镜镜头表格
 *
 * 列：选择 / 镜号 / 画面内容描述 / 参考项 / 备注 / 参考图 / 操作
 * 不含首帧、尾帧、提示词、视频相关列。
 */
import { useStoryboardStore, useActiveStoryboardDocument } from "@/stores/storyboard-store";
import { StoryboardRow } from "./StoryboardRow";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";

export function StoryboardTable() {
  const document = useActiveStoryboardDocument();
  const selectedShotIds = useStoryboardStore((s) => s.selectedShotIds);
  const setSelectedShots = useStoryboardStore((s) => s.setSelectedShots);
  if (!document) return null;

  const allSelected = document.shots.length > 0 && selectedShotIds.length === document.shots.length;
  const handleHeaderToggle = (checked: boolean) => {
    setSelectedShots(checked ? document.shots.map((s) => s.id) : []);
  };

  return (
    <ScrollArea className="flex-1 min-h-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8">
              <Checkbox checked={allSelected} onCheckedChange={(v) => handleHeaderToggle(Boolean(v))} />
            </TableHead>
            <TableHead className="w-12">镜号</TableHead>
            <TableHead className="min-w-[220px]">画面内容描述</TableHead>
            <TableHead className="min-w-[140px]">参考项</TableHead>
            <TableHead className="min-w-[120px]">备注</TableHead>
            <TableHead className="w-24">参考图</TableHead>
            <TableHead className="w-24">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {document.shots.map((shot) => (
            <StoryboardRow key={shot.id} shot={shot} />
          ))}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}