// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Storyboard script sync service (剧本变更检测)
 *
 * 进入分镜页时，把工作区中当前剧本的 hash 与分镜文档保存的 hash 比较，
 * 检测源剧本是否变更。提供 更新 / 覆盖重拆 / 忽略 三种处置。
 *
 * 关键约束：更新和覆盖不得静默丢弃人工修改。
 */
import { hashScriptContent } from "./script-importer";
import { useStoryboardStore } from "@/stores/storyboard-store";
import { useScriptWorkspaceStore } from "@/stores/script-workspace-store";
import { getScriptWorkspaceFs } from "@/lib/script-workspace-fs";
import type { StoryboardDocument } from "@/types/storyboard";

export type ScriptChangeKind =
  | "unchanged"  // 剧本未变
  | "changed"    // 同路径，内容 hash 改变
  | "new"        // 路径或 hash 不存在（首次/新剧本）
  | "missing"    // 源剧本文件在工作区中不存在

export interface ScriptChangeResult {
  kind: ScriptChangeKind;
  currentHash?: string;
  storedHash?: string;
  scriptPath?: string;
}

/**
 * 检测源剧本是否变更。
 * 需要工作区 FS 与当前文档。
 */
export async function detectScriptChange(): Promise<ScriptChangeResult> {
  const doc = useStoryboardStore.getState().document;
  if (!doc || !doc.sourceScriptPath) {
    return { kind: "new" };
  }

  const root = useScriptWorkspaceStore.getState().workspaceRoot;
  const fs = getScriptWorkspaceFs();
  if (!root || !fs) {
    // 无法读取工作区，无法判断；保守返回 unchanged 避免误报
    return { kind: "unchanged", storedHash: doc.sourceScriptContentHash, scriptPath: doc.sourceScriptPath };
  }

  try {
    const content = await fs.readFile(root, doc.sourceScriptPath);
    const currentHash = hashScriptContent(content);
    const storedHash = doc.sourceScriptContentHash;

    if (!storedHash) {
      return { kind: "new", currentHash, storedHash, scriptPath: doc.sourceScriptPath };
    }
    if (currentHash === storedHash) {
      return { kind: "unchanged", currentHash, storedHash, scriptPath: doc.sourceScriptPath };
    }
    return { kind: "changed", currentHash, storedHash, scriptPath: doc.sourceScriptPath };
  } catch {
    return { kind: "missing", storedHash: doc.sourceScriptContentHash, scriptPath: doc.sourceScriptPath };
  }
}

/**
 * 处置：更新元数据（仅更新 hash / revision，不重拆，保留人工修改）。
 * 用于用户选择「更新」时。
 */
export function applyScriptUpdate(
  doc: StoryboardDocument,
  currentHash: string,
  revision?: string,
): void {
  // 以当前 store 中的文档为准，避免覆盖内存中尚未落盘的镜头改动
  const current = useStoryboardStore.getState().document;
  const base = current?.id === doc.id ? current : doc;
  useStoryboardStore.setState({
    document: {
      ...base,
      sourceScriptContentHash: currentHash,
      sourceScriptRevision: revision ?? base.sourceScriptRevision,
      updatedAt: Date.now(),
    },
    dirty: true,
  });
}

/**
 * 处置：覆盖重拆前，先创建当前版本快照（保证可恢复）。
 * 返回新版本的 id。
 */
export function snapshotBeforeOverwrite(reason: string): string | null {
  const store = useStoryboardStore.getState();
  if (!store.document) return null;
  // 触发 createVersion 并把 reason 传入
  const before = store.document;
  store.createVersion(reason);
  // 拿到刚压入的快照 id
  const v = useStoryboardStore.getState().versions[0];
  return v?.id || null;
}

/**
 * 处置：忽略 — 不做任何修改。返回当前文档。
 */
export function ignoreScriptChange(): StoryboardDocument | null {
  return useStoryboardStore.getState().document;
}