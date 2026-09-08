// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * useWorkspaceImageUrl — 把参考图引用解析为 <img> 可用的 URL。
 *
 * - `workspace-image://<relPath>` → 通过工作区 FS 读取二进制图片并转为 data URL（异步）
 * - `data:` / `http(s):` / 其他 → 原样返回
 * - 读取失败 / 无工作区 → null
 */
import { useEffect, useState } from "react";
import { workspaceImagePath } from "@/lib/storyboard/storyboard-file-service";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";

export function useWorkspaceImageUrl(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(null);
  const workspaceRoot = useScriptWorkspaceStore((s) => s.workspaceRoot);

  const rel = url ? workspaceImagePath(url) : null;
  const isWorkspaceImage = rel !== null;

  useEffect(() => {
    if (!isWorkspaceImage) {
      setResolved(null);
      return;
    }
    const fs = getScriptWorkspaceFs();
    if (!fs?.readImage || !workspaceRoot || !rel) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    fs.readImage(workspaceRoot, rel)
      .then((dataUrl) => {
        if (!cancelled) setResolved(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isWorkspaceImage, rel, workspaceRoot]);

  if (!url) return null;
  if (!isWorkspaceImage) return url; // data: / http: 等直接显示
  return resolved;
}
