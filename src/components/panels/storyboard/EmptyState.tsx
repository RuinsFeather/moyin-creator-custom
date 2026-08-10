// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";
import { Button } from "@/components/ui/button";
import { Clapperboard, FileUp } from "lucide-react";

interface Props {
  hasDocument: boolean;
  onImport: () => void;
}

export function EmptyState({ hasDocument, onImport }: Props) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center h-full text-center px-6">
      <div className="rounded-full bg-muted p-4 mb-4">
        <Clapperboard className="h-10 w-10 text-muted-foreground" />
      </div>
      <h3 className="text-sm font-medium mb-1">
        {hasDocument ? "当前分镜没有镜头" : "还没有分镜"}
      </h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-4">
        {hasDocument
          ? "点击「AI 拆分」根据当前剧本生成镜头，或手动新增镜头。"
          : "从当前项目导入一份剧本，即可开始 AI 拆镜和人工整理。"}
      </p>
      <div className="flex items-center gap-2">
        {!hasDocument && (
          <Button onClick={onImport} size="sm">
            <FileUp className="h-4 w-4 mr-1" />
            从项目导入剧本
          </Button>
        )}
      </div>
    </div>
  );
}